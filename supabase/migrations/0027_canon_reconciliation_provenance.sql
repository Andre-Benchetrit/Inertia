-- Fase C do Reconciliador de Cânone.
-- Registra a origem de cada registro afetado por uma proposta aplicada.
-- A tabela de relações existente não possui relation_status; quando uma
-- proposta declara relation_status=former, o vínculo é arquivado sem apagar
-- seu histórico, funcionando como equivalente compatível.

create table if not exists public.canon_reconciliation_provenance (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  proposal_id uuid not null references public.canon_reconciliation_proposals(id) on delete cascade,
  run_id uuid not null references public.canon_reconciliation_runs(id) on delete cascade,
  record_type text not null check (record_type in ('entity', 'fact', 'relation', 'event', 'open_thread')),
  record_id uuid not null,
  operation text not null check (operation in ('create', 'update', 'resolve', 'merge', 'archive')),
  basis jsonb not null default '[]'::jsonb check (jsonb_typeof(basis) = 'array'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (proposal_id, record_type, record_id)
);

create index if not exists canon_reconciliation_provenance_record_idx
  on public.canon_reconciliation_provenance (book_id, record_type, record_id, created_at desc);

create index if not exists canon_reconciliation_provenance_run_idx
  on public.canon_reconciliation_provenance (run_id, created_at desc);

create or replace function public.record_canon_reconciliation_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  applied_item jsonb;
  candidate_id uuid;
  source_item jsonb;
  record_key text;
  record_type_value text;
begin
  if new.status <> 'applied' or old.status = 'applied' then
    return new;
  end if;

  for applied_item in
    select value from jsonb_array_elements(coalesce(new.applied_records, '[]'::jsonb))
  loop
    record_key := case new.proposal_kind
      when 'entity' then 'entity_id'
      when 'fact' then 'fact_id'
      when 'relation' then 'relation_id'
      when 'event' then 'event_id'
      when 'open_thread' then 'thread_id'
    end;
    record_type_value := new.proposal_kind;
    candidate_id := public.canon_reconciliation_uuid(applied_item->>record_key);

    if candidate_id is not null then
      insert into public.canon_reconciliation_provenance (
        book_id, proposal_id, run_id, record_type, record_id, operation,
        basis, created_by
      ) values (
        new.book_id, new.id, new.run_id, record_type_value, candidate_id,
        new.operation, new.basis, coalesce(new.applied_by, new.created_by)
      ) on conflict (proposal_id, record_type, record_id) do nothing;
    end if;

    if jsonb_typeof(applied_item->'source_record_ids') = 'array' then
      for source_item in select value from jsonb_array_elements(applied_item->'source_record_ids')
      loop
        candidate_id := public.canon_reconciliation_uuid(source_item #>> '{}');
        if candidate_id is null then continue; end if;
        insert into public.canon_reconciliation_provenance (
          book_id, proposal_id, run_id, record_type, record_id, operation,
          basis, created_by
        ) values (
          new.book_id, new.id, new.run_id, record_type_value, candidate_id,
          new.operation, new.basis, coalesce(new.applied_by, new.created_by)
        ) on conflict (proposal_id, record_type, record_id) do nothing;
      end loop;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists canon_reconciliation_provenance_after_apply
  on public.canon_reconciliation_proposals;
create trigger canon_reconciliation_provenance_after_apply
after update of status, applied_records on public.canon_reconciliation_proposals
for each row execute function public.record_canon_reconciliation_provenance();

create or replace function public.archive_former_relation_after_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  relation_id uuid;
begin
  if new.status <> 'applied' or old.status = 'applied' then
    return new;
  end if;
  if new.proposal_kind <> 'relation' or new.payload->>'relation_status' <> 'former' then
    return new;
  end if;

  relation_id := public.canon_reconciliation_uuid(
    coalesce(new.target->>'record_id', new.target->>'id')
  );
  if relation_id is null and jsonb_typeof(new.applied_records) = 'array' then
    select public.canon_reconciliation_uuid(item->>'relation_id')
      into relation_id
      from jsonb_array_elements(new.applied_records) item
     where public.canon_reconciliation_uuid(item->>'relation_id') is not null
     limit 1;
  end if;

  if relation_id is not null then
    update public.universe_relations
       set archived_at = coalesce(archived_at, now()),
           last_reconciliation_proposal_id = new.id
     where id = relation_id
       and book_id = new.book_id;
  end if;

  return new;
end;
$$;

drop trigger if exists canon_reconciliation_former_relation_after_apply
  on public.canon_reconciliation_proposals;
create trigger canon_reconciliation_former_relation_after_apply
after update of status, applied_records on public.canon_reconciliation_proposals
for each row execute function public.archive_former_relation_after_reconciliation();

alter table public.canon_reconciliation_provenance enable row level security;

drop policy if exists canon_reconciliation_provenance_select_members
  on public.canon_reconciliation_provenance;
create policy canon_reconciliation_provenance_select_members
on public.canon_reconciliation_provenance
for select to authenticated
using (public.is_book_member(book_id));

drop policy if exists canon_reconciliation_provenance_insert_members
  on public.canon_reconciliation_provenance;
create policy canon_reconciliation_provenance_insert_members
on public.canon_reconciliation_provenance
for insert to authenticated
with check (public.is_book_member(book_id) and created_by = auth.uid());

drop policy if exists canon_reconciliation_provenance_delete_owner
  on public.canon_reconciliation_provenance;
create policy canon_reconciliation_provenance_delete_owner
on public.canon_reconciliation_provenance
for delete to authenticated
using (public.is_book_owner(book_id));

grant select, insert, delete on public.canon_reconciliation_provenance to authenticated;
grant execute on function public.record_canon_reconciliation_provenance() to authenticated;
grant execute on function public.archive_former_relation_after_reconciliation() to authenticated;

comment on table public.canon_reconciliation_provenance is
  'Proveniência dos registros canônicos afetados por propostas de reconciliação aplicadas.';


create table if not exists public.canon_reconciliation_pending_sources (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  memory_proposal_id uuid not null references public.memory_proposals(id) on delete cascade,
  record_type text not null check (record_type in ('entity', 'fact', 'relation', 'event', 'open_thread')),
  record_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  unique (memory_proposal_id, record_type, record_id)
);

create index if not exists canon_reconciliation_pending_sources_book_idx
  on public.canon_reconciliation_pending_sources (book_id, consumed_at, created_at desc);

create or replace function public.mark_canon_reconciliation_pending_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  approved_item jsonb;
  candidate_id uuid;
  record_key text;
  record_type_value text;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  for approved_item in
    select value from jsonb_array_elements(coalesce(new.approved_records, '[]'::jsonb))
  loop
    for record_key, record_type_value in
      select * from (values
        ('entity_id', 'entity'),
        ('fact_id', 'fact'),
        ('relation_id', 'relation'),
        ('event_id', 'event'),
        ('thread_id', 'open_thread'),
        ('open_thread_id', 'open_thread')
      ) as record_keys(key_name, type_name)
    loop
      candidate_id := public.canon_reconciliation_uuid(approved_item->>record_key);
      if candidate_id is null then continue; end if;
      insert into public.canon_reconciliation_pending_sources (
        book_id, memory_proposal_id, record_type, record_id, created_by
      ) values (
        new.book_id, new.id, record_type_value, candidate_id,
        coalesce(new.reviewed_by, new.created_by)
      ) on conflict (memory_proposal_id, record_type, record_id) do nothing;
    end loop;
  end loop;

  return new;
end;
$$;

drop trigger if exists memory_proposal_mark_reconciliation_pending
  on public.memory_proposals;
create trigger memory_proposal_mark_reconciliation_pending
after update of status, approved_records on public.memory_proposals
for each row execute function public.mark_canon_reconciliation_pending_source();

alter table public.canon_reconciliation_pending_sources enable row level security;

drop policy if exists canon_reconciliation_pending_sources_select_members
  on public.canon_reconciliation_pending_sources;
create policy canon_reconciliation_pending_sources_select_members
on public.canon_reconciliation_pending_sources
for select to authenticated
using (public.is_book_member(book_id));

drop policy if exists canon_reconciliation_pending_sources_update_members
  on public.canon_reconciliation_pending_sources;
create policy canon_reconciliation_pending_sources_update_members
on public.canon_reconciliation_pending_sources
for update to authenticated
using (public.is_book_member(book_id))
with check (public.is_book_member(book_id));

grant select, update on public.canon_reconciliation_pending_sources to authenticated;
grant execute on function public.mark_canon_reconciliation_pending_source() to authenticated;

comment on table public.canon_reconciliation_pending_sources is
  'Registros canônicos criados por aprovação de memória e ainda disponíveis para um batch de reconciliação.';

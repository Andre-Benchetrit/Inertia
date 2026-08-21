-- Inertia Sprint 4 — fundação segura do Reconciliador de Cânone
-- Esta migration cria somente runs, fontes e propostas pendentes.
-- Nenhuma função desta etapa escreve diretamente no Universo canônico.

create table if not exists public.canon_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  trigger_kind text not null default 'manual' check (
    trigger_kind in ('manual', 'approved_memory', 'batch')
  ),
  requested_by uuid not null references auth.users(id) on delete restrict,
  model_name text not null check (char_length(btrim(model_name)) between 1 and 240),
  prompt_version text not null default 'canon-reconciliation-v1'
    check (char_length(btrim(prompt_version)) between 1 and 160),
  contract_version text not null default 'universe-proposal-v5'
    check (char_length(btrim(contract_version)) between 1 and 160),
  input_hash text not null check (char_length(btrim(input_hash)) between 1 and 160),
  status text not null default 'queued' check (
    status in ('queued', 'running', 'partial', 'completed', 'failed', 'cancelled')
  ),
  total_sources integer not null default 0 check (total_sources >= 0),
  processed_sources integer not null default 0
    check (processed_sources >= 0 and processed_sources <= total_sources),
  error_message text not null default '' check (char_length(error_message) <= 4000),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists canon_reconciliation_runs_book_idx
  on public.canon_reconciliation_runs (book_id, created_at desc);

create unique index if not exists canon_reconciliation_runs_active_book_idx
  on public.canon_reconciliation_runs (book_id)
  where status in ('queued', 'running');

create table if not exists public.canon_reconciliation_sources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.canon_reconciliation_runs(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  record_type text not null check (
    record_type in ('entity', 'fact', 'relation', 'event', 'open_thread')
  ),
  record_id uuid not null,
  source_role text not null default 'approved_input' check (
    source_role in ('approved_input', 'related_context')
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (run_id, record_type, record_id)
);

create index if not exists canon_reconciliation_sources_run_idx
  on public.canon_reconciliation_sources (run_id, record_type, created_at);

create index if not exists canon_reconciliation_sources_record_idx
  on public.canon_reconciliation_sources (record_type, record_id);

create table if not exists public.canon_reconciliation_proposals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.canon_reconciliation_runs(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  schema_version text not null default 'universe-proposal-v5'
    check (char_length(btrim(schema_version)) between 1 and 160),
  origin_kind text not null default 'canon_reconciliation' check (
    origin_kind in ('memory_analysis', 'canon_reconciliation', 'manual')
  ),
  proposal_kind text not null check (
    proposal_kind in ('entity', 'fact', 'relation', 'event', 'open_thread')
  ),
  operation text not null check (
    operation in ('create', 'update', 'resolve', 'merge', 'archive')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'superseded', 'archived')
  ),
  title text not null default '' check (char_length(title) <= 240),
  target jsonb not null default '{}'::jsonb check (jsonb_typeof(target) = 'object'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  basis jsonb not null default '[]'::jsonb check (jsonb_typeof(basis) = 'array'),
  evidence_kind text not null default 'canon_record' check (
    evidence_kind in ('story_quote', 'canon_record', 'author_input')
  ),
  evidence text not null default '' check (char_length(evidence) <= 10000),
  explanation text not null default '' check (char_length(explanation) <= 4000),
  certainty text not null default 'possible_inference' check (
    certainty in ('explicit_fact', 'direct_derivation', 'possible_inference', 'author_defined')
  ),
  confidence numeric(4,3) not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  source_anchor text not null default '' check (char_length(source_anchor) <= 2000),
  dedupe_key text not null check (char_length(btrim(dedupe_key)) between 1 and 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '' check (char_length(review_note) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, dedupe_key)
);

create index if not exists canon_reconciliation_proposals_book_status_idx
  on public.canon_reconciliation_proposals (book_id, status, created_at desc);

create index if not exists canon_reconciliation_proposals_run_status_idx
  on public.canon_reconciliation_proposals (run_id, status, created_at desc);

create index if not exists canon_reconciliation_proposals_dedupe_idx
  on public.canon_reconciliation_proposals (book_id, dedupe_key, status);

create or replace function public.validate_canon_reconciliation_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  run_book_id uuid;
  source_book_id uuid;
begin
  select r.book_id
    into run_book_id
    from public.canon_reconciliation_runs r
   where r.id = new.run_id;

  if run_book_id is null then
    raise exception 'Run de reconciliação não encontrado';
  end if;

  if run_book_id <> new.book_id then
    raise exception 'A fonte não pertence ao mesmo livro do run';
  end if;

  if new.record_type = 'entity' then
    select e.book_id into source_book_id
      from public.universe_entities e
     where e.id = new.record_id;
  elsif new.record_type = 'fact' then
    select f.book_id into source_book_id
      from public.canon_facts f
     where f.id = new.record_id;
  elsif new.record_type = 'relation' then
    select r.book_id into source_book_id
      from public.universe_relations r
     where r.id = new.record_id;
  elsif new.record_type = 'event' then
    select e.book_id into source_book_id
      from public.timeline_events e
     where e.id = new.record_id;
  elsif new.record_type = 'open_thread' then
    select t.book_id into source_book_id
      from public.open_threads t
     where t.id = new.record_id;
  end if;

  if source_book_id is null or source_book_id <> new.book_id then
    raise exception 'A fonte não existe ou pertence a outro livro';
  end if;

  return new;
end;
$$;

drop trigger if exists canon_reconciliation_sources_validate on public.canon_reconciliation_sources;
create trigger canon_reconciliation_sources_validate
before insert or update on public.canon_reconciliation_sources
for each row execute function public.validate_canon_reconciliation_source();

create or replace function public.validate_canon_reconciliation_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  run_book_id uuid;
begin
  select r.book_id
    into run_book_id
    from public.canon_reconciliation_runs r
   where r.id = new.run_id;

  if run_book_id is null or run_book_id <> new.book_id then
    raise exception 'A proposta não corresponde ao livro e run informados';
  end if;

  return new;
end;
$$;

drop trigger if exists canon_reconciliation_proposals_validate on public.canon_reconciliation_proposals;
create trigger canon_reconciliation_proposals_validate
before insert or update on public.canon_reconciliation_proposals
for each row execute function public.validate_canon_reconciliation_proposal();

create or replace function public.set_canon_reconciliation_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists canon_reconciliation_runs_updated_at on public.canon_reconciliation_runs;
create trigger canon_reconciliation_runs_updated_at
before update on public.canon_reconciliation_runs
for each row execute function public.set_canon_reconciliation_updated_at();

drop trigger if exists canon_reconciliation_proposals_updated_at on public.canon_reconciliation_proposals;
create trigger canon_reconciliation_proposals_updated_at
before update on public.canon_reconciliation_proposals
for each row execute function public.set_canon_reconciliation_updated_at();

create or replace function public.start_canon_reconciliation(
  target_book_id uuid,
  requested_trigger_kind text,
  requested_model text,
  requested_prompt_version text,
  requested_contract_version text,
  requested_input_hash text,
  requested_total_sources integer
)
returns public.canon_reconciliation_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.canon_reconciliation_runs;
begin
  if not public.is_book_member(target_book_id) then
    raise exception 'Livro não encontrado ou acesso negado';
  end if;

  if requested_trigger_kind not in ('manual', 'approved_memory', 'batch') then
    raise exception 'Tipo de gatilho de reconciliação inválido';
  end if;

  if char_length(btrim(coalesce(requested_model, ''))) = 0 then
    raise exception 'O modelo do Reconciliador é obrigatório';
  end if;

  if char_length(btrim(coalesce(requested_input_hash, ''))) = 0 then
    raise exception 'O hash de entrada do Reconciliador é obrigatório';
  end if;

  if requested_total_sources < 0 then
    raise exception 'A quantidade de fontes não pode ser negativa';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_book_id::text, 1));

  select *
    into result
    from public.canon_reconciliation_runs r
   where r.book_id = target_book_id
     and r.status in ('queued', 'running')
   order by r.created_at desc
   limit 1;

  if result.id is not null then
    return result;
  end if;

  insert into public.canon_reconciliation_runs (
    book_id,
    trigger_kind,
    requested_by,
    model_name,
    prompt_version,
    contract_version,
    input_hash,
    status,
    total_sources,
    processed_sources,
    started_at
  ) values (
    target_book_id,
    requested_trigger_kind,
    auth.uid(),
    btrim(requested_model),
    coalesce(nullif(btrim(requested_prompt_version), ''), 'canon-reconciliation-v1'),
    coalesce(nullif(btrim(requested_contract_version), ''), 'universe-proposal-v5'),
    btrim(requested_input_hash),
    'running',
    requested_total_sources,
    0,
    now()
  ) returning * into result;

  return result;
end;
$$;

create or replace function public.update_canon_reconciliation_progress(
  target_run_id uuid,
  requested_processed_sources integer,
  requested_status text default 'running',
  requested_error_message text default ''
)
returns public.canon_reconciliation_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.canon_reconciliation_runs;
begin
  if requested_status not in ('queued', 'running', 'partial', 'completed', 'failed', 'cancelled') then
    raise exception 'Status de reconciliação inválido';
  end if;

  update public.canon_reconciliation_runs r
     set processed_sources = least(greatest(requested_processed_sources, 0), r.total_sources),
         status = requested_status,
         error_message = left(coalesce(requested_error_message, ''), 4000),
         finished_at = case
           when requested_status in ('partial', 'completed', 'failed', 'cancelled') then now()
           else null
         end
   where r.id = target_run_id
     and public.is_book_member(r.book_id)
   returning r.* into result;

  if result.id is null then
    raise exception 'Run de reconciliação não encontrado ou acesso negado';
  end if;

  return result;
end;
$$;

alter table public.canon_reconciliation_runs enable row level security;
alter table public.canon_reconciliation_sources enable row level security;
alter table public.canon_reconciliation_proposals enable row level security;

drop policy if exists canon_reconciliation_runs_select_members on public.canon_reconciliation_runs;
create policy canon_reconciliation_runs_select_members on public.canon_reconciliation_runs
for select to authenticated
using (public.is_book_member(book_id));

drop policy if exists canon_reconciliation_runs_insert_members on public.canon_reconciliation_runs;
create policy canon_reconciliation_runs_insert_members on public.canon_reconciliation_runs
for insert to authenticated
with check (public.is_book_member(book_id) and requested_by = auth.uid());

drop policy if exists canon_reconciliation_runs_update_members on public.canon_reconciliation_runs;
create policy canon_reconciliation_runs_update_members on public.canon_reconciliation_runs
for update to authenticated
using (public.is_book_member(book_id))
with check (public.is_book_member(book_id));

drop policy if exists canon_reconciliation_runs_delete_owner on public.canon_reconciliation_runs;
create policy canon_reconciliation_runs_delete_owner on public.canon_reconciliation_runs
for delete to authenticated
using (public.is_book_owner(book_id));

drop policy if exists canon_reconciliation_sources_select_members on public.canon_reconciliation_sources;
create policy canon_reconciliation_sources_select_members on public.canon_reconciliation_sources
for select to authenticated
using (public.is_book_member(book_id));

drop policy if exists canon_reconciliation_sources_insert_members on public.canon_reconciliation_sources;
create policy canon_reconciliation_sources_insert_members on public.canon_reconciliation_sources
for insert to authenticated
with check (public.is_book_member(book_id) and created_by = auth.uid());

drop policy if exists canon_reconciliation_sources_delete_owner on public.canon_reconciliation_sources;
create policy canon_reconciliation_sources_delete_owner on public.canon_reconciliation_sources
for delete to authenticated
using (public.is_book_owner(book_id));

drop policy if exists canon_reconciliation_proposals_select_members on public.canon_reconciliation_proposals;
create policy canon_reconciliation_proposals_select_members on public.canon_reconciliation_proposals
for select to authenticated
using (public.is_book_member(book_id));

drop policy if exists canon_reconciliation_proposals_insert_members on public.canon_reconciliation_proposals;
create policy canon_reconciliation_proposals_insert_members on public.canon_reconciliation_proposals
for insert to authenticated
with check (public.is_book_member(book_id) and created_by = auth.uid());

drop policy if exists canon_reconciliation_proposals_update_members on public.canon_reconciliation_proposals;
create policy canon_reconciliation_proposals_update_members on public.canon_reconciliation_proposals
for update to authenticated
using (public.is_book_member(book_id))
with check (public.is_book_member(book_id));

drop policy if exists canon_reconciliation_proposals_delete_owner on public.canon_reconciliation_proposals;
create policy canon_reconciliation_proposals_delete_owner on public.canon_reconciliation_proposals
for delete to authenticated
using (public.is_book_owner(book_id));

grant select, insert, update, delete on public.canon_reconciliation_runs to authenticated;
grant select, insert, delete on public.canon_reconciliation_sources to authenticated;
grant select, insert, update, delete on public.canon_reconciliation_proposals to authenticated;
grant execute on function public.validate_canon_reconciliation_source() to authenticated;
grant execute on function public.validate_canon_reconciliation_proposal() to authenticated;
grant execute on function public.set_canon_reconciliation_updated_at() to authenticated;
grant execute on function public.start_canon_reconciliation(uuid, text, text, text, text, text, integer) to authenticated;
grant execute on function public.update_canon_reconciliation_progress(uuid, integer, text, text) to authenticated;

comment on table public.canon_reconciliation_runs is 'Execuções do Reconciliador; esta etapa não altera o cânone diretamente.';
comment on table public.canon_reconciliation_sources is 'Registros canônicos usados como entrada de uma execução do Reconciliador.';
comment on table public.canon_reconciliation_proposals is 'Propostas V5 do Reconciliador, sujeitas a aprovação humana.';

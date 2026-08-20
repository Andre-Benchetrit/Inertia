-- Inertia Sprint 3 — análise de memória e propostas pendentes
-- A IA pode sugerir mudanças, mas nunca grava diretamente no Universo canônico.

create table if not exists public.memory_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  version_id uuid not null references public.chapter_versions(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  model_name text not null check (char_length(btrim(model_name)) between 1 and 240),
  prompt_version text not null default 'memory-extraction-v1',
  source_hash text not null check (char_length(btrim(source_hash)) between 1 and 160),
  status text not null default 'queued' check (
    status in ('queued', 'running', 'partial', 'completed', 'failed', 'cancelled')
  ),
  total_blocks integer not null default 0 check (total_blocks >= 0),
  processed_blocks integer not null default 0 check (processed_blocks >= 0 and processed_blocks <= total_blocks),
  error_message text not null default '' check (char_length(error_message) <= 4000),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memory_analysis_runs_book_idx
  on public.memory_analysis_runs (book_id, created_at desc);

create index if not exists memory_analysis_runs_version_idx
  on public.memory_analysis_runs (version_id, created_at desc);

create unique index if not exists memory_analysis_runs_active_version_idx
  on public.memory_analysis_runs (version_id)
  where status in ('queued', 'running');

create table if not exists public.memory_proposals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.memory_analysis_runs(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  version_id uuid not null references public.chapter_versions(id) on delete cascade,
  proposal_kind text not null check (proposal_kind in ('entity', 'fact', 'relation')),
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'superseded')
  ),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  title text not null default '' check (char_length(title) <= 240),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  evidence text not null default '' check (char_length(evidence) <= 10000),
  explanation text not null default '' check (char_length(explanation) <= 4000),
  source_block integer check (source_block is null or source_block > 0),
  source_anchor text not null default '' check (char_length(source_anchor) <= 2000),
  dedupe_key text not null check (char_length(btrim(dedupe_key)) between 1 and 500),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '' check (char_length(review_note) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists memory_proposals_run_dedupe_idx
  on public.memory_proposals (run_id, dedupe_key);

create index if not exists memory_proposals_book_status_idx
  on public.memory_proposals (book_id, status, created_at desc);

create index if not exists memory_proposals_version_status_idx
  on public.memory_proposals (version_id, status, created_at desc);

create or replace function public.validate_memory_proposal_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  run_book_id uuid;
  run_chapter_id uuid;
  run_version_id uuid;
  version_chapter_id uuid;
  chapter_book_id uuid;
begin
  select r.book_id, r.chapter_id, r.version_id
    into run_book_id, run_chapter_id, run_version_id
    from public.memory_analysis_runs r
   where r.id = new.run_id;

  if run_book_id is null then
    raise exception 'Run de análise não encontrado';
  end if;

  select v.chapter_id
    into version_chapter_id
    from public.chapter_versions v
   where v.id = new.version_id;

  select c.book_id
    into chapter_book_id
    from public.chapters c
   where c.id = new.chapter_id;

  if run_book_id <> new.book_id
     or run_chapter_id <> new.chapter_id
     or run_version_id <> new.version_id
     or version_chapter_id is null
     or version_chapter_id <> new.chapter_id
     or chapter_book_id is null
     or chapter_book_id <> new.book_id then
    raise exception 'A proposta não corresponde ao livro, capítulo, versão e run informados';
  end if;

  return new;
end;
$$;

drop trigger if exists memory_proposals_validate_references on public.memory_proposals;
create trigger memory_proposals_validate_references
before insert or update on public.memory_proposals
for each row execute function public.validate_memory_proposal_references();

create or replace function public.set_memory_analysis_updated_at()
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

drop trigger if exists memory_analysis_runs_updated_at on public.memory_analysis_runs;
create trigger memory_analysis_runs_updated_at
before update on public.memory_analysis_runs
for each row execute function public.set_memory_analysis_updated_at();

drop trigger if exists memory_proposals_updated_at on public.memory_proposals;
create trigger memory_proposals_updated_at
before update on public.memory_proposals
for each row execute function public.set_memory_analysis_updated_at();

create or replace function public.start_memory_analysis(
  target_book_id uuid,
  target_chapter_id uuid,
  target_version_id uuid,
  requested_model text,
  requested_total_blocks integer,
  requested_source_hash text
)
returns public.memory_analysis_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.memory_analysis_runs;
  version_chapter_id uuid;
  chapter_book_id uuid;
  approved_version_id uuid;
begin
  if not public.is_book_member(target_book_id) then
    raise exception 'Livro não encontrado ou acesso negado';
  end if;

  select c.book_id, c.approved_version_id
    into chapter_book_id, approved_version_id
    from public.chapters c
   where c.id = target_chapter_id;

  select v.chapter_id
    into version_chapter_id
    from public.chapter_versions v
   where v.id = target_version_id;

  if chapter_book_id is null or chapter_book_id <> target_book_id then
    raise exception 'Capítulo não pertence ao livro';
  end if;
  if version_chapter_id is null or version_chapter_id <> target_chapter_id then
    raise exception 'Versão não pertence ao capítulo';
  end if;
  if approved_version_id is null or approved_version_id <> target_version_id then
    raise exception 'A análise de memória exige a versão aprovada do capítulo';
  end if;
  if requested_total_blocks < 1 then
    raise exception 'A análise precisa de pelo menos um bloco';
  end if;
  if char_length(btrim(coalesce(requested_source_hash, ''))) = 0 then
    raise exception 'O hash da Fonte é obrigatório';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_version_id::text, 0));

  select *
    into result
    from public.memory_analysis_runs r
   where r.version_id = target_version_id
     and r.status in ('queued', 'running')
   order by r.created_at desc
   limit 1;

  if result.id is not null then
    return result;
  end if;

  insert into public.memory_analysis_runs (
    book_id, chapter_id, version_id, requested_by, model_name,
    source_hash, status, total_blocks, processed_blocks, started_at
  ) values (
    target_book_id, target_chapter_id, target_version_id, auth.uid(),
    btrim(requested_model), btrim(requested_source_hash), 'running',
    requested_total_blocks, 0, now()
  ) returning * into result;

  update public.chapters
     set memory_status = 'stale'
   where id = target_chapter_id
     and memory_status = 'current';

  return result;
end;
$$;

create or replace function public.update_memory_analysis_progress(
  target_run_id uuid,
  requested_processed_blocks integer,
  requested_status text default 'running',
  requested_error_message text default ''
)
returns public.memory_analysis_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.memory_analysis_runs;
begin
  update public.memory_analysis_runs r
     set processed_blocks = least(greatest(requested_processed_blocks, 0), r.total_blocks),
         status = requested_status,
         error_message = left(coalesce(requested_error_message, ''), 4000),
         finished_at = case when requested_status in ('partial', 'completed', 'failed', 'cancelled') then now() else null end
   where r.id = target_run_id
     and public.is_book_member(r.book_id)
   returning r.* into result;

  if result.id is null then
    raise exception 'Run de análise não encontrado ou acesso negado';
  end if;

  if result.status = 'completed' then
    update public.chapters
       set memory_status = 'current'
     where id = result.chapter_id
       and approved_version_id = result.version_id;
  end if;

  return result;
end;
$$;

alter table public.memory_analysis_runs enable row level security;
alter table public.memory_proposals enable row level security;

drop policy if exists memory_analysis_runs_select_members on public.memory_analysis_runs;
create policy memory_analysis_runs_select_members on public.memory_analysis_runs
for select to authenticated
using (public.is_book_member(book_id));

drop policy if exists memory_analysis_runs_insert_members on public.memory_analysis_runs;
create policy memory_analysis_runs_insert_members on public.memory_analysis_runs
for insert to authenticated
with check (public.is_book_member(book_id) and requested_by = auth.uid());

drop policy if exists memory_analysis_runs_update_members on public.memory_analysis_runs;
create policy memory_analysis_runs_update_members on public.memory_analysis_runs
for update to authenticated
using (public.is_book_member(book_id))
with check (public.is_book_member(book_id));

drop policy if exists memory_analysis_runs_delete_owner on public.memory_analysis_runs;
create policy memory_analysis_runs_delete_owner on public.memory_analysis_runs
for delete to authenticated
using (public.is_book_owner(book_id));

drop policy if exists memory_proposals_select_members on public.memory_proposals;
create policy memory_proposals_select_members on public.memory_proposals
for select to authenticated
using (public.is_book_member(book_id));

drop policy if exists memory_proposals_insert_members on public.memory_proposals;
create policy memory_proposals_insert_members on public.memory_proposals
for insert to authenticated
with check (public.is_book_member(book_id));

drop policy if exists memory_proposals_update_members on public.memory_proposals;
create policy memory_proposals_update_members on public.memory_proposals
for update to authenticated
using (public.is_book_member(book_id))
with check (public.is_book_member(book_id));

drop policy if exists memory_proposals_delete_owner on public.memory_proposals;
create policy memory_proposals_delete_owner on public.memory_proposals
for delete to authenticated
using (public.is_book_owner(book_id));

grant select, insert, update, delete on public.memory_analysis_runs to authenticated;
grant select, insert, update, delete on public.memory_proposals to authenticated;
grant execute on function public.validate_memory_proposal_references() to authenticated;
grant execute on function public.set_memory_analysis_updated_at() to authenticated;
grant execute on function public.start_memory_analysis(uuid, uuid, uuid, text, integer, text) to authenticated;
grant execute on function public.update_memory_analysis_progress(uuid, integer, text, text) to authenticated;

comment on table public.memory_analysis_runs is 'Execuções de extração de memória a partir de uma versão aprovada; não alteram o Universo diretamente.';
comment on table public.memory_proposals is 'Propostas pendentes de memória, sujeitas a revisão e aprovação humana.';

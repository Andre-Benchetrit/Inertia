-- Inertia Sprint 2 — controle de revisões editoriais
-- Cada versão pode receber no máximo uma revisão concluída.
-- A Fonte e o conteúdo das versões existentes não são alterados.

alter table public.chapter_versions
  add column if not exists review_status text not null default 'not_reviewed',
  add column if not exists review_started_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_model_name text,
  add column if not exists review_blocks integer,
  add column if not exists review_suggestion_count integer;

alter table public.chapter_versions
  drop constraint if exists chapter_versions_review_status_check;

alter table public.chapter_versions
  add constraint chapter_versions_review_status_check
  check (review_status in ('not_reviewed', 'running', 'completed'));

create index if not exists chapter_versions_review_status_idx
  on public.chapter_versions(chapter_id, review_status);

create or replace function public.start_chapter_version_review(
  target_version_id uuid,
  requested_model text default null
)
returns table (
  acquired boolean,
  review_status text,
  review_started_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_version public.chapter_versions;
  stale_before timestamptz := now() - interval '15 minutes';
begin
  select v.* into target_version
    from public.chapter_versions v
   where v.id = target_version_id
     and public.is_chapter_member(v.chapter_id);

  if not found then
    raise exception 'Versão não encontrada ou acesso negado';
  end if;

  if target_version.review_status = 'completed' then
    return query select false, target_version.review_status, target_version.review_started_at;
    return;
  end if;

  if target_version.review_status = 'running'
     and target_version.review_started_at is not null
     and target_version.review_started_at > stale_before then
    return query select false, target_version.review_status, target_version.review_started_at;
    return;
  end if;

  update public.chapter_versions
     set review_status = 'running',
         review_started_at = now(),
         review_model_name = nullif(trim(requested_model), ''),
         reviewed_at = null,
         review_blocks = null,
         review_suggestion_count = null
   where id = target_version_id;

  return query
    select true, 'running'::text, now();
end;
$$;

grant execute on function public.start_chapter_version_review(uuid, text) to authenticated;

create or replace function public.complete_chapter_version_review(
  target_version_id uuid,
  processed_blocks integer,
  saved_suggestions integer,
  requested_model text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.chapter_versions v
     set review_status = 'completed',
         reviewed_at = now(),
         review_model_name = coalesce(nullif(trim(requested_model), ''), v.review_model_name),
         review_blocks = greatest(coalesce(processed_blocks, 0), 0),
         review_suggestion_count = greatest(coalesce(saved_suggestions, 0), 0)
   where v.id = target_version_id
     and public.is_chapter_member(v.chapter_id)
     and v.review_status = 'running';

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

grant execute on function public.complete_chapter_version_review(uuid, integer, integer, text) to authenticated;

create or replace function public.reset_chapter_version_review(
  target_version_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.chapter_versions v
     set review_status = 'not_reviewed',
         review_started_at = null,
         review_model_name = null,
         reviewed_at = null,
         review_blocks = null,
         review_suggestion_count = null
   where v.id = target_version_id
     and public.is_chapter_member(v.chapter_id)
     and v.review_status = 'running';

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

grant execute on function public.reset_chapter_version_review(uuid) to authenticated;

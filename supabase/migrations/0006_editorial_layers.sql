-- Inertia Sprint 2 — camadas editoriais
-- A Fonte continua em public.messages e nunca é escrita pela IA.

create table if not exists public.chapter_manuscripts (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null unique references public.chapters(id) on delete cascade,
  content text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chapter_versions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  content text not null,
  source_snapshot jsonb not null default '[]'::jsonb,
  compilation_provider text not null default 'manual' check (compilation_provider in ('manual', 'ollama')),
  model_name text,
  prompt_version text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (chapter_id, version_number)
);

create table if not exists public.chapter_suggestions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  version_id uuid references public.chapter_versions(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete set null,
  suggestion_type text not null check (suggestion_type in ('grammar', 'style', 'coherence', 'continuity', 'editorial')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'obsolete')),
  explanation text not null,
  original_text text,
  suggested_text text,
  anchor text,
  created_by uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chapter_versions_chapter_created_idx on public.chapter_versions(chapter_id, version_number desc);
create index if not exists chapter_suggestions_chapter_status_idx on public.chapter_suggestions(chapter_id, status);
create index if not exists chapter_suggestions_version_idx on public.chapter_suggestions(version_id);

create or replace function public.touch_editorial_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chapter_manuscripts_touch_updated_at on public.chapter_manuscripts;
create trigger chapter_manuscripts_touch_updated_at before update on public.chapter_manuscripts
for each row execute function public.touch_editorial_updated_at();

drop trigger if exists chapter_suggestions_touch_updated_at on public.chapter_suggestions;
create trigger chapter_suggestions_touch_updated_at before update on public.chapter_suggestions
for each row execute function public.touch_editorial_updated_at();

create or replace function public.ensure_chapter_manuscript(target_chapter_id uuid)
returns public.chapter_manuscripts
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.chapter_manuscripts;
begin
  if not public.is_chapter_member(target_chapter_id) then
    raise exception 'Capítulo não encontrado ou acesso negado';
  end if;

  insert into public.chapter_manuscripts (chapter_id)
  values (target_chapter_id)
  on conflict (chapter_id) do nothing;

  select * into result from public.chapter_manuscripts where chapter_id = target_chapter_id;
  return result;
end;
$$;

grant execute on function public.ensure_chapter_manuscript(uuid) to authenticated;

create or replace function public.create_chapter_version(
  target_chapter_id uuid,
  version_content text,
  version_source_snapshot jsonb default '[]'::jsonb,
  version_provider text default 'manual',
  version_model text default null,
  version_prompt text default null
)
returns public.chapter_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.chapter_versions;
  next_number integer;
begin
  if not public.is_chapter_member(target_chapter_id) then
    raise exception 'Capítulo não encontrado ou acesso negado';
  end if;
  if char_length(coalesce(version_content, '')) > 2000000 then
    raise exception 'O manuscrito excede o limite permitido';
  end if;
  if version_provider not in ('manual', 'ollama') then
    raise exception 'Provedor de compilação inválido';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_chapter_id::text, 0));
  select coalesce(max(version_number), 0) + 1 into next_number
    from public.chapter_versions
   where chapter_id = target_chapter_id;

  insert into public.chapter_versions (
    chapter_id, version_number, content, source_snapshot,
    compilation_provider, model_name, prompt_version, created_by
  ) values (
    target_chapter_id, next_number, coalesce(version_content, ''), coalesce(version_source_snapshot, '[]'::jsonb),
    version_provider, version_model, version_prompt, auth.uid()
  ) returning * into result;

  insert into public.chapter_manuscripts (chapter_id, content, updated_by)
  values (target_chapter_id, coalesce(version_content, ''), auth.uid())
  on conflict (chapter_id) do update set content = excluded.content, updated_by = excluded.updated_by;

  return result;
end;
$$;

grant execute on function public.create_chapter_version(uuid, text, jsonb, text, text, text) to authenticated;

alter table public.chapter_manuscripts enable row level security;
alter table public.chapter_versions enable row level security;
alter table public.chapter_suggestions enable row level security;

drop policy if exists chapter_manuscripts_select_members on public.chapter_manuscripts;
create policy chapter_manuscripts_select_members on public.chapter_manuscripts
for select to authenticated using (public.is_chapter_member(chapter_id));

drop policy if exists chapter_manuscripts_insert_members on public.chapter_manuscripts;
create policy chapter_manuscripts_insert_members on public.chapter_manuscripts
for insert to authenticated with check (public.is_chapter_member(chapter_id));

drop policy if exists chapter_manuscripts_update_members on public.chapter_manuscripts;
create policy chapter_manuscripts_update_members on public.chapter_manuscripts
for update to authenticated using (public.is_chapter_member(chapter_id)) with check (public.is_chapter_member(chapter_id));

drop policy if exists chapter_versions_select_members on public.chapter_versions;
create policy chapter_versions_select_members on public.chapter_versions
for select to authenticated using (public.is_chapter_member(chapter_id));

drop policy if exists chapter_versions_insert_members on public.chapter_versions;
create policy chapter_versions_insert_members on public.chapter_versions
for insert to authenticated with check (public.is_chapter_member(chapter_id) and created_by = auth.uid());

drop policy if exists chapter_suggestions_select_members on public.chapter_suggestions;
create policy chapter_suggestions_select_members on public.chapter_suggestions
for select to authenticated using (public.is_chapter_member(chapter_id));

drop policy if exists chapter_suggestions_insert_members on public.chapter_suggestions;
create policy chapter_suggestions_insert_members on public.chapter_suggestions
for insert to authenticated with check (public.is_chapter_member(chapter_id) and created_by = auth.uid());

drop policy if exists chapter_suggestions_update_members on public.chapter_suggestions;
create policy chapter_suggestions_update_members on public.chapter_suggestions
for update to authenticated using (public.is_chapter_member(chapter_id)) with check (public.is_chapter_member(chapter_id));

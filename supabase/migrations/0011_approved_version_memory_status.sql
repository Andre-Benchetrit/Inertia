-- Inertia Sprint 3 — versão aprovada e estado da memória
-- A versão aprovada é um snapshot imutável de chapter_versions.
-- A Fonte (public.messages) continua fora deste fluxo e nunca é alterada pela IA.

alter table public.chapters
  add column if not exists approved_version_id uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists memory_status text not null default 'never_analyzed';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'chapters_approved_version_id_fkey'
       and conrelid = 'public.chapters'::regclass
  ) then
    alter table public.chapters
      add constraint chapters_approved_version_id_fkey
      foreign key (approved_version_id)
      references public.chapter_versions(id)
      on delete set null;
  end if;
end;
$$;

alter table public.chapters
  drop constraint if exists chapters_memory_status_check;

alter table public.chapters
  add constraint chapters_memory_status_check
  check (memory_status in ('never_analyzed', 'current', 'stale'));

create index if not exists chapters_approved_version_idx
  on public.chapters(approved_version_id);

create index if not exists chapters_memory_status_idx
  on public.chapters(book_id, memory_status);

create or replace function public.set_chapter_approved_version(
  target_chapter_id uuid,
  target_version_id uuid default null
)
returns public.chapters
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.chapters;
  target_version_chapter_id uuid;
begin
  if not public.is_chapter_member(target_chapter_id) then
    raise exception 'Capítulo não encontrado ou acesso negado';
  end if;

  if target_version_id is not null then
    select v.chapter_id
      into target_version_chapter_id
      from public.chapter_versions v
     where v.id = target_version_id;

    if target_version_chapter_id is null then
      raise exception 'Versão não encontrada';
    end if;

    if target_version_chapter_id <> target_chapter_id then
      raise exception 'A versão não pertence a este capítulo';
    end if;
  end if;

  update public.chapters
     set approved_version_id = target_version_id,
         approved_at = case when target_version_id is null then null else now() end,
         approved_by = case when target_version_id is null then null else auth.uid() end,
         memory_status = case
           when target_version_id is null then
             case when approved_version_id is null then memory_status else 'stale' end
           when approved_version_id is null then memory_status
           when approved_version_id = target_version_id then memory_status
           else 'stale'
         end
   where id = target_chapter_id
   returning * into result;

  return result;
end;
$$;

revoke all on function public.set_chapter_approved_version(uuid, uuid) from public;
grant execute on function public.set_chapter_approved_version(uuid, uuid) to authenticated;


-- Qualquer nova versão invalida o snapshot aprovado e a memória derivada dele.
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
  select coalesce(max(version_number), 0) + 1
    into next_number
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

  update public.chapters
     set approved_version_id = null,
         approved_at = null,
         approved_by = null,
         memory_status = case
           when memory_status = 'never_analyzed' then 'never_analyzed'
           else 'stale'
         end
   where id = target_chapter_id;

  return result;
end;
$$;

grant execute on function public.create_chapter_version(uuid, text, jsonb, text, text, text) to authenticated;

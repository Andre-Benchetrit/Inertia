-- Inertia: mensagens colaborativas de capítulos
-- Compatível com a tabela chapters existente; não altera chapters.
create table if not exists public.chapter_messages (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  content text not null check (char_length(btrim(content)) between 1 and 50000),
  kind text not null default 'history' check (kind in ('history', 'comment')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists chapter_messages_chapter_created_idx on public.chapter_messages(chapter_id, created_at, id);
create index if not exists chapter_messages_author_idx on public.chapter_messages(author_id);
alter table public.chapter_messages enable row level security;
drop policy if exists chapter_messages_select_own on public.chapter_messages;
create policy chapter_messages_select_own on public.chapter_messages for select to authenticated using (author_id = auth.uid() and deleted_at is null);
drop policy if exists chapter_messages_insert_own on public.chapter_messages;
create policy chapter_messages_insert_own on public.chapter_messages for insert to authenticated with check (author_id = auth.uid());
drop policy if exists chapter_messages_update_own on public.chapter_messages;
create policy chapter_messages_update_own on public.chapter_messages for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create or replace function public.touch_chapter_messages_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists chapter_messages_touch_updated_at on public.chapter_messages;
create trigger chapter_messages_touch_updated_at before update on public.chapter_messages for each row execute function public.touch_chapter_messages_updated_at();

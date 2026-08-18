-- Inertia — schema inicial reconstruído a partir do banco ativo
--
-- Esta migration recompõe a base necessária para executar as migrations
-- 0002, 0005, 0006 e 0007 em uma instalação nova. Os dados do projeto
-- atual não fazem parte deste arquivo.
--
-- A Fonte principal do chat é public.messages. A tabela
-- public.chapter_messages, criada na migration 0002, é mantida como legado.

create extension if not exists pgcrypto;

-- Tipos usados pela aplicação.
do $$
begin
  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
       and t.typname = 'book_member_role'
  ) then
    create type public.book_member_role as enum ('owner', 'author');
  end if;

  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
       and t.typname = 'chapter_status'
  ) then
    create type public.chapter_status as enum ('draft', 'finished');
  end if;

  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
       and t.typname = 'message_type'
  ) then
    create type public.message_type as enum ('story', 'author_note');
  end if;
end;
$$;

-- Perfil público mínimo associado a auth.users.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Autor',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.book_members (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.book_member_role not null default 'author',
  created_at timestamptz not null default now(),
  unique (book_id, user_id)
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  chapter_number integer not null check (chapter_number > 0),
  status public.chapter_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, chapter_number)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  content text not null check (char_length(btrim(content)) between 1 and 50000),
  message_type public.message_type not null default 'story',
  sequence_number bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  edited_at timestamptz,
  unique (chapter_id, sequence_number)
);

create table if not exists public.book_invites (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  token text not null unique,
  role public.book_member_role not null default 'author',
  expires_at timestamptz not null
);

create index if not exists book_members_book_idx on public.book_members(book_id);
create index if not exists book_members_user_idx on public.book_members(user_id);
create index if not exists chapters_book_number_idx on public.chapters(book_id, chapter_number);
create index if not exists messages_chapter_sequence_idx on public.messages(chapter_id, sequence_number, id);
create index if not exists messages_author_idx on public.messages(author_id);
create index if not exists book_invites_book_idx on public.book_invites(book_id);

-- Funções auxiliares usadas pelas políticas RLS e pelas migrations editoriais.
create or replace function public.is_book_member(target_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.book_members bm
     where bm.book_id = target_book_id
       and bm.user_id = auth.uid()
  );
$$;

create or replace function public.is_book_owner(target_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.book_members bm
     where bm.book_id = target_book_id
       and bm.user_id = auth.uid()
       and bm.role = 'owner'
  );
$$;

create or replace function public.is_chapter_member(target_chapter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.chapters c
      join public.book_members bm on bm.book_id = c.book_id
     where c.id = target_chapter_id
       and bm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_book_member(uuid) from public;
revoke all on function public.is_book_owner(uuid) from public;
revoke all on function public.is_chapter_member(uuid) from public;
grant execute on function public.is_book_member(uuid) to authenticated;
grant execute on function public.is_book_owner(uuid) to authenticated;
grant execute on function public.is_chapter_member(uuid) to authenticated;

-- Timestamps e sequência por capítulo.
create or replace function public.touch_inertia_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.assign_message_sequence()
returns trigger
language plpgsql
as $$
declare
  next_sequence bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.chapter_id::text, 0));

  select coalesce(max(m.sequence_number), 0) + 1
    into next_sequence
    from public.messages m
   where m.chapter_id = new.chapter_id;

  if new.sequence_number is null or new.sequence_number <= 0 then
    new.sequence_number = next_sequence;
  end if;

  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'Autor')
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_inertia_updated_at();

drop trigger if exists books_touch_updated_at on public.books;
create trigger books_touch_updated_at
before update on public.books
for each row execute function public.touch_inertia_updated_at();

drop trigger if exists chapters_touch_updated_at on public.chapters;
create trigger chapters_touch_updated_at
before update on public.chapters
for each row execute function public.touch_inertia_updated_at();

drop trigger if exists messages_touch_updated_at on public.messages;
create trigger messages_touch_updated_at
before update on public.messages
for each row execute function public.touch_inertia_updated_at();

drop trigger if exists messages_assign_sequence on public.messages;
create trigger messages_assign_sequence
before insert on public.messages
for each row execute function public.assign_message_sequence();

-- Criação de livros e associação do proprietário.
create or replace function public.create_book(
  book_title text,
  book_description text default ''
)
returns public.books
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.books;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if char_length(btrim(coalesce(book_title, ''))) not between 1 and 160 then
    raise exception 'O título do livro deve ter entre 1 e 160 caracteres';
  end if;

  if char_length(coalesce(book_description, '')) > 2000 then
    raise exception 'A descrição do livro excede o limite permitido';
  end if;

  insert into public.books (title, description, created_by)
  values (btrim(book_title), btrim(coalesce(book_description, '')), auth.uid())
  returning * into result;

  insert into public.book_members (book_id, user_id, role)
  values (result.id, auth.uid(), 'owner');

  return result;
end;
$$;

grant execute on function public.create_book(text, text) to authenticated;

-- Convites são de uso único: a aceitação remove o token da tabela.
create or replace function public.create_book_invite(
  p_book_id uuid,
  p_expires_in_hours integer default 168
)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_token text;
  invite_expiry timestamptz;
begin
  if not public.is_book_owner(p_book_id) then
    raise exception 'Livro não encontrado ou acesso negado';
  end if;

  if p_expires_in_hours is null or p_expires_in_hours not between 1 and 720 then
    raise exception 'Prazo do convite inválido';
  end if;

  invite_token = encode(gen_random_bytes(24), 'hex');
  invite_expiry = now() + make_interval(hours => p_expires_in_hours);

  insert into public.book_invites (book_id, created_by, token, role, expires_at)
  values (p_book_id, auth.uid(), invite_token, 'author', invite_expiry);

  return query select invite_token, invite_expiry;
end;
$$;

grant execute on function public.create_book_invite(uuid, integer) to authenticated;

create or replace function public.accept_book_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.book_invites;
  accepted_book_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select * into invite
    from public.book_invites
   where token = btrim(p_token)
   for update;

  if not found then
    raise exception 'Convite não encontrado ou já utilizado';
  end if;

  if invite.expires_at <= now() then
    delete from public.book_invites where id = invite.id;
    raise exception 'Convite expirou';
  end if;

  insert into public.book_members (book_id, user_id, role)
  values (invite.book_id, auth.uid(), invite.role)
  on conflict (book_id, user_id) do nothing;

  delete from public.book_invites where id = invite.id;
  accepted_book_id = invite.book_id;
  return accepted_book_id;
end;
$$;

grant execute on function public.accept_book_invite(text) to authenticated;

-- RLS: a leitura das mensagens ocorre exclusivamente pela função segura
-- get_chapter_messages, criada na migration 0005.
alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.book_members enable row level security;
alter table public.chapters enable row level security;
alter table public.messages enable row level security;
alter table public.book_invites enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
for select to authenticated using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists books_select_members on public.books;
create policy books_select_members on public.books
for select to authenticated using (public.is_book_member(id));

drop policy if exists books_insert_self on public.books;
create policy books_insert_self on public.books
for insert to authenticated with check (created_by = auth.uid());

drop policy if exists books_update_owner on public.books;
create policy books_update_owner on public.books
for update to authenticated using (public.is_book_owner(id)) with check (created_by = auth.uid());

drop policy if exists books_delete_owner on public.books;
create policy books_delete_owner on public.books
for delete to authenticated using (public.is_book_owner(id));

drop policy if exists book_members_select_members on public.book_members;
create policy book_members_select_members on public.book_members
for select to authenticated using (public.is_book_member(book_id));

drop policy if exists book_members_insert_owner on public.book_members;
create policy book_members_insert_owner on public.book_members
for insert to authenticated with check (public.is_book_owner(book_id) or user_id = auth.uid());

drop policy if exists book_members_update_owner on public.book_members;
create policy book_members_update_owner on public.book_members
for update to authenticated using (public.is_book_owner(book_id)) with check (public.is_book_owner(book_id));

drop policy if exists book_members_delete_owner_or_self on public.book_members;
create policy book_members_delete_owner_or_self on public.book_members
for delete to authenticated using (public.is_book_owner(book_id) or user_id = auth.uid());

drop policy if exists chapters_select_members on public.chapters;
create policy chapters_select_members on public.chapters
for select to authenticated using (public.is_book_member(book_id));

drop policy if exists chapters_insert_owners on public.chapters;
create policy chapters_insert_owners on public.chapters
for insert to authenticated with check (public.is_book_owner(book_id));

drop policy if exists chapters_update_owners on public.chapters;
create policy chapters_update_owners on public.chapters
for update to authenticated using (public.is_book_owner(book_id)) with check (public.is_book_owner(book_id));

drop policy if exists chapters_delete_owners on public.chapters;
create policy chapters_delete_owners on public.chapters
for delete to authenticated using (public.is_book_owner(book_id));

drop policy if exists messages_insert_members on public.messages;
create policy messages_insert_members on public.messages
for insert to authenticated
with check (author_id = auth.uid() and public.is_chapter_member(chapter_id));

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
for update to authenticated
using (author_id = auth.uid() and public.is_chapter_member(chapter_id))
with check (author_id = auth.uid() and public.is_chapter_member(chapter_id));

drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages
for delete to authenticated
using (author_id = auth.uid() and public.is_chapter_member(chapter_id));

drop policy if exists book_invites_select_owner on public.book_invites;
create policy book_invites_select_owner on public.book_invites
for select to authenticated using (public.is_book_owner(book_id));

drop policy if exists book_invites_insert_owner on public.book_invites;
create policy book_invites_insert_owner on public.book_invites
for insert to authenticated with check (created_by = auth.uid() and public.is_book_owner(book_id));

drop policy if exists book_invites_delete_owner on public.book_invites;
create policy book_invites_delete_owner on public.book_invites
for delete to authenticated using (public.is_book_owner(book_id));

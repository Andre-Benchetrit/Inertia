-- Sprint 3B: núcleo manual do Universo da obra.
-- Propostas de IA não entram nessas tabelas diretamente; serão adicionadas em migrations futuras após aprovação humana.

create table if not exists public.universe_entities (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 240),
  entity_type text not null default 'other' check (
    entity_type in (
      'character',
      'location',
      'faction',
      'organization',
      'power',
      'item',
      'creature',
      'concept',
      'other'
    )
  ),
  summary text not null default '' check (char_length(summary) <= 20000),
  aliases text[] not null default '{}',
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  visibility text not null default 'canon' check (visibility in ('canon', 'author_only')),
  archived_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists universe_entities_active_name_idx
  on public.universe_entities (book_id, lower(name))
  where archived_at is null;

create index if not exists universe_entities_book_type_idx
  on public.universe_entities (book_id, entity_type, archived_at);

create table if not exists public.canon_facts (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  entity_id uuid references public.universe_entities(id) on delete set null,
  statement text not null check (char_length(btrim(statement)) between 1 and 4000),
  source_kind text not null default 'author' check (source_kind in ('author', 'manuscript')),
  source_chapter_id uuid references public.chapters(id) on delete set null,
  source_version_id uuid references public.chapter_versions(id) on delete set null,
  evidence text not null default '' check (char_length(evidence) <= 10000),
  visibility text not null default 'canon' check (visibility in ('canon', 'author_only')),
  status text not null default 'active' check (status in ('active', 'superseded', 'archived')),
  archived_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists canon_facts_book_entity_idx
  on public.canon_facts (book_id, entity_id, status, archived_at);

create index if not exists canon_facts_source_version_idx
  on public.canon_facts (source_version_id)
  where source_version_id is not null;

create table if not exists public.universe_relations (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  from_entity_id uuid not null references public.universe_entities(id) on delete cascade,
  to_entity_id uuid not null references public.universe_entities(id) on delete cascade,
  relation_type text not null check (char_length(btrim(relation_type)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  source_kind text not null default 'author' check (source_kind in ('author', 'manuscript')),
  source_chapter_id uuid references public.chapters(id) on delete set null,
  source_version_id uuid references public.chapter_versions(id) on delete set null,
  visibility text not null default 'canon' check (visibility in ('canon', 'author_only')),
  archived_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_entity_id <> to_entity_id)
);

create unique index if not exists universe_relations_active_unique_idx
  on public.universe_relations (
    book_id,
    from_entity_id,
    to_entity_id,
    lower(relation_type)
  )
  where archived_at is null;

create index if not exists universe_relations_book_entity_idx
  on public.universe_relations (book_id, from_entity_id, to_entity_id, archived_at);

create or replace function public.validate_universe_reference_books()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  referenced_book_id uuid;
  source_book_id uuid;
begin
  if tg_table_name = 'canon_facts' and new.entity_id is not null then
    select book_id into referenced_book_id
      from public.universe_entities
     where id = new.entity_id;
    if referenced_book_id is null or referenced_book_id <> new.book_id then
      raise exception 'A entidade do fato pertence a outro livro';
    end if;
  elsif tg_table_name = 'universe_relations' then
    select book_id into referenced_book_id
      from public.universe_entities
     where id = new.from_entity_id;
    if referenced_book_id is null or referenced_book_id <> new.book_id then
      raise exception 'A entidade de origem pertence a outro livro';
    end if;

    select book_id into referenced_book_id
      from public.universe_entities
     where id = new.to_entity_id;
    if referenced_book_id is null or referenced_book_id <> new.book_id then
      raise exception 'A entidade de destino pertence a outro livro';
    end if;
  end if;

  if new.source_chapter_id is not null then
    select book_id into source_book_id
      from public.chapters
     where id = new.source_chapter_id;
    if source_book_id is null or source_book_id <> new.book_id then
      raise exception 'O capítulo de origem pertence a outro livro';
    end if;
  end if;

  if new.source_version_id is not null then
    select c.book_id into source_book_id
      from public.chapter_versions v
      join public.chapters c on c.id = v.chapter_id
     where v.id = new.source_version_id;
    if source_book_id is null or source_book_id <> new.book_id then
      raise exception 'A versão de origem pertence a outro livro';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.set_universe_updated_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_by = auth.uid();
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists universe_entities_updated_at on public.universe_entities;
create trigger universe_entities_updated_at
before update on public.universe_entities
for each row execute function public.set_universe_updated_by();

drop trigger if exists canon_facts_updated_at on public.canon_facts;
create trigger canon_facts_updated_at
before update on public.canon_facts
for each row execute function public.set_universe_updated_by();

drop trigger if exists universe_relations_updated_at on public.universe_relations;
create trigger universe_relations_updated_at
before update on public.universe_relations
for each row execute function public.set_universe_updated_by();

drop trigger if exists canon_facts_validate_books on public.canon_facts;
create trigger canon_facts_validate_books
before insert or update on public.canon_facts
for each row execute function public.validate_universe_reference_books();

drop trigger if exists universe_relations_validate_books on public.universe_relations;
create trigger universe_relations_validate_books
before insert or update on public.universe_relations
for each row execute function public.validate_universe_reference_books();

alter table public.universe_entities enable row level security;
alter table public.canon_facts enable row level security;
alter table public.universe_relations enable row level security;

drop policy if exists universe_entities_select_members on public.universe_entities;
create policy universe_entities_select_members on public.universe_entities
for select to authenticated
using (public.is_book_member(book_id));

drop policy if exists universe_entities_insert_members on public.universe_entities;
create policy universe_entities_insert_members on public.universe_entities
for insert to authenticated
with check (public.is_book_member(book_id) and created_by = auth.uid() and updated_by = auth.uid());

drop policy if exists universe_entities_update_members on public.universe_entities;
create policy universe_entities_update_members on public.universe_entities
for update to authenticated
using (public.is_book_member(book_id))
with check (public.is_book_member(book_id) and updated_by = auth.uid());

drop policy if exists universe_entities_delete_owner on public.universe_entities;
create policy universe_entities_delete_owner on public.universe_entities
for delete to authenticated
using (public.is_book_owner(book_id));

drop policy if exists canon_facts_select_members on public.canon_facts;
create policy canon_facts_select_members on public.canon_facts
for select to authenticated
using (public.is_book_member(book_id));

drop policy if exists canon_facts_insert_members on public.canon_facts;
create policy canon_facts_insert_members on public.canon_facts
for insert to authenticated
with check (public.is_book_member(book_id) and created_by = auth.uid() and updated_by = auth.uid());

drop policy if exists canon_facts_update_members on public.canon_facts;
create policy canon_facts_update_members on public.canon_facts
for update to authenticated
using (public.is_book_member(book_id))
with check (public.is_book_member(book_id) and updated_by = auth.uid());

drop policy if exists canon_facts_delete_owner on public.canon_facts;
create policy canon_facts_delete_owner on public.canon_facts
for delete to authenticated
using (public.is_book_owner(book_id));

drop policy if exists universe_relations_select_members on public.universe_relations;
create policy universe_relations_select_members on public.universe_relations
for select to authenticated
using (public.is_book_member(book_id));

drop policy if exists universe_relations_insert_members on public.universe_relations;
create policy universe_relations_insert_members on public.universe_relations
for insert to authenticated
with check (public.is_book_member(book_id) and created_by = auth.uid() and updated_by = auth.uid());

drop policy if exists universe_relations_update_members on public.universe_relations;
create policy universe_relations_update_members on public.universe_relations
for update to authenticated
using (public.is_book_member(book_id))
with check (public.is_book_member(book_id) and updated_by = auth.uid());

drop policy if exists universe_relations_delete_owner on public.universe_relations;
create policy universe_relations_delete_owner on public.universe_relations
for delete to authenticated
using (public.is_book_owner(book_id));

grant select, insert, update, delete on public.universe_entities to authenticated;
grant select, insert, update, delete on public.canon_facts to authenticated;
grant select, insert, update, delete on public.universe_relations to authenticated;
grant execute on function public.validate_universe_reference_books() to authenticated;
grant execute on function public.set_universe_updated_by() to authenticated;

comment on table public.universe_entities is 'Entidades factuais do Universo, editadas pelos autores e nunca inseridas diretamente pela IA.';
comment on table public.canon_facts is 'Fatos canônicos ligados opcionalmente a entidades e evidências editoriais.';
comment on table public.universe_relations is 'Relações direcionadas entre entidades do mesmo livro.';

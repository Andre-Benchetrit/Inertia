-- Sprint 3: memória narrativa episódica.
-- Eventos e tramas abertas continuam sujeitos à aprovação humana;
-- a IA nunca grava diretamente no Universo canônico.

create table if not exists public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  event_kind text not null default 'other' check (
    event_kind in (
      'action',
      'revelation',
      'conflict',
      'relationship_change',
      'discovery',
      'scene',
      'other'
    )
  ),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text not null default '' check (char_length(description) <= 4000),
  narrative_time text not null default '' check (char_length(narrative_time) <= 240),
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

create table if not exists public.open_threads (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text not null default '' check (char_length(description) <= 4000),
  status text not null default 'open' check (
    status in ('open', 'in_progress', 'resolved', 'abandoned', 'contradicted')
  ),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  source_kind text not null default 'author' check (source_kind in ('author', 'manuscript')),
  source_chapter_id uuid references public.chapters(id) on delete set null,
  source_version_id uuid references public.chapter_versions(id) on delete set null,
  evidence text not null default '' check (char_length(evidence) <= 10000),
  visibility text not null default 'canon' check (visibility in ('canon', 'author_only')),
  archived_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.timeline_event_entities (
  event_id uuid not null references public.timeline_events(id) on delete cascade,
  entity_id uuid not null references public.universe_entities(id) on delete cascade,
  role text not null default 'participant' check (char_length(btrim(role)) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (event_id, entity_id)
);

create table if not exists public.open_thread_entities (
  thread_id uuid not null references public.open_threads(id) on delete cascade,
  entity_id uuid not null references public.universe_entities(id) on delete cascade,
  role text not null default 'related' check (char_length(btrim(role)) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (thread_id, entity_id)
);

create index if not exists timeline_events_book_status_idx
  on public.timeline_events (book_id, status, archived_at, created_at desc);

create index if not exists timeline_events_source_version_idx
  on public.timeline_events (source_version_id)
  where source_version_id is not null;

create index if not exists open_threads_book_status_idx
  on public.open_threads (book_id, status, archived_at, created_at desc);

create index if not exists open_threads_source_version_idx
  on public.open_threads (source_version_id)
  where source_version_id is not null;

create index if not exists timeline_event_entities_entity_idx
  on public.timeline_event_entities (entity_id, event_id);

create index if not exists open_thread_entities_entity_idx
  on public.open_thread_entities (entity_id, thread_id);

create or replace function public.validate_narrative_source_books()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_book_id uuid;
begin
  if new.source_chapter_id is not null then
    select c.book_id
      into source_book_id
      from public.chapters c
     where c.id = new.source_chapter_id;
    if source_book_id is null or source_book_id <> new.book_id then
      raise exception 'O capítulo de origem pertence a outro livro';
    end if;
  end if;

  if new.source_version_id is not null then
    select c.book_id
      into source_book_id
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

create or replace function public.validate_narrative_entity_books()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_book_id uuid;
  entity_book_id uuid;
begin
  if tg_table_name = 'timeline_event_entities' then
    select book_id into parent_book_id
      from public.timeline_events
     where id = new.event_id;
  else
    select book_id into parent_book_id
      from public.open_threads
     where id = new.thread_id;
  end if;

  select book_id into entity_book_id
    from public.universe_entities
   where id = new.entity_id;

  if parent_book_id is null or entity_book_id is null or parent_book_id <> entity_book_id then
    raise exception 'A entidade e o registro narrativo precisam pertencer ao mesmo livro';
  end if;

  return new;
end;
$$;

create or replace function public.set_narrative_updated_by()
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

drop trigger if exists timeline_events_validate_source on public.timeline_events;
create trigger timeline_events_validate_source
before insert or update on public.timeline_events
for each row execute function public.validate_narrative_source_books();

drop trigger if exists open_threads_validate_source on public.open_threads;
create trigger open_threads_validate_source
before insert or update on public.open_threads
for each row execute function public.validate_narrative_source_books();

drop trigger if exists timeline_event_entities_validate_books on public.timeline_event_entities;
create trigger timeline_event_entities_validate_books
before insert or update on public.timeline_event_entities
for each row execute function public.validate_narrative_entity_books();

drop trigger if exists open_thread_entities_validate_books on public.open_thread_entities;
create trigger open_thread_entities_validate_books
before insert or update on public.open_thread_entities
for each row execute function public.validate_narrative_entity_books();

drop trigger if exists timeline_events_updated_at on public.timeline_events;
create trigger timeline_events_updated_at
before update on public.timeline_events
for each row execute function public.set_narrative_updated_by();

drop trigger if exists open_threads_updated_at on public.open_threads;
create trigger open_threads_updated_at
before update on public.open_threads
for each row execute function public.set_narrative_updated_by();

alter table public.memory_proposals
  drop constraint if exists memory_proposals_proposal_kind_check;

alter table public.memory_proposals
  add constraint memory_proposals_proposal_kind_check
  check (proposal_kind in ('entity', 'fact', 'relation', 'event', 'open_thread'));

alter table public.timeline_events enable row level security;
alter table public.open_threads enable row level security;
alter table public.timeline_event_entities enable row level security;
alter table public.open_thread_entities enable row level security;

drop policy if exists timeline_events_select_members on public.timeline_events;
create policy timeline_events_select_members on public.timeline_events
for select to authenticated
using (public.is_book_member(book_id));

drop policy if exists timeline_events_insert_members on public.timeline_events;
create policy timeline_events_insert_members on public.timeline_events
for insert to authenticated
with check (public.is_book_member(book_id) and created_by = auth.uid() and updated_by = auth.uid());

drop policy if exists timeline_events_update_members on public.timeline_events;
create policy timeline_events_update_members on public.timeline_events
for update to authenticated
using (public.is_book_member(book_id))
with check (public.is_book_member(book_id) and updated_by = auth.uid());

drop policy if exists timeline_events_delete_owner on public.timeline_events;
create policy timeline_events_delete_owner on public.timeline_events
for delete to authenticated
using (public.is_book_owner(book_id));

drop policy if exists open_threads_select_members on public.open_threads;
create policy open_threads_select_members on public.open_threads
for select to authenticated
using (public.is_book_member(book_id));

drop policy if exists open_threads_insert_members on public.open_threads;
create policy open_threads_insert_members on public.open_threads
for insert to authenticated
with check (public.is_book_member(book_id) and created_by = auth.uid() and updated_by = auth.uid());

drop policy if exists open_threads_update_members on public.open_threads;
create policy open_threads_update_members on public.open_threads
for update to authenticated
using (public.is_book_member(book_id))
with check (public.is_book_member(book_id) and updated_by = auth.uid());

drop policy if exists open_threads_delete_owner on public.open_threads;
create policy open_threads_delete_owner on public.open_threads
for delete to authenticated
using (public.is_book_owner(book_id));

drop policy if exists timeline_event_entities_select_members on public.timeline_event_entities;
create policy timeline_event_entities_select_members on public.timeline_event_entities
for select to authenticated
using (
  exists (
    select 1 from public.timeline_events e
     where e.id = event_id and public.is_book_member(e.book_id)
  )
);

drop policy if exists timeline_event_entities_insert_members on public.timeline_event_entities;
create policy timeline_event_entities_insert_members on public.timeline_event_entities
for insert to authenticated
with check (
  exists (
    select 1 from public.timeline_events e
     where e.id = event_id and public.is_book_member(e.book_id)
  )
);

drop policy if exists timeline_event_entities_update_members on public.timeline_event_entities;
create policy timeline_event_entities_update_members on public.timeline_event_entities
for update to authenticated
using (
  exists (
    select 1 from public.timeline_events e
     where e.id = event_id and public.is_book_member(e.book_id)
  )
)
with check (
  exists (
    select 1 from public.timeline_events e
     where e.id = event_id and public.is_book_member(e.book_id)
  )
);

drop policy if exists timeline_event_entities_delete_owner on public.timeline_event_entities;
create policy timeline_event_entities_delete_owner on public.timeline_event_entities
for delete to authenticated
using (
  exists (
    select 1 from public.timeline_events e
     where e.id = event_id and public.is_book_owner(e.book_id)
  )
);

drop policy if exists open_thread_entities_select_members on public.open_thread_entities;
create policy open_thread_entities_select_members on public.open_thread_entities
for select to authenticated
using (
  exists (
    select 1 from public.open_threads t
     where t.id = thread_id and public.is_book_member(t.book_id)
  )
);

drop policy if exists open_thread_entities_insert_members on public.open_thread_entities;
create policy open_thread_entities_insert_members on public.open_thread_entities
for insert to authenticated
with check (
  exists (
    select 1 from public.open_threads t
     where t.id = thread_id and public.is_book_member(t.book_id)
  )
);

drop policy if exists open_thread_entities_update_members on public.open_thread_entities;
create policy open_thread_entities_update_members on public.open_thread_entities
for update to authenticated
using (
  exists (
    select 1 from public.open_threads t
     where t.id = thread_id and public.is_book_member(t.book_id)
  )
)
with check (
  exists (
    select 1 from public.open_threads t
     where t.id = thread_id and public.is_book_member(t.book_id)
  )
);

drop policy if exists open_thread_entities_delete_owner on public.open_thread_entities;
create policy open_thread_entities_delete_owner on public.open_thread_entities
for delete to authenticated
using (
  exists (
    select 1 from public.open_threads t
     where t.id = thread_id and public.is_book_owner(t.book_id)
  )
);

grant select, insert, update, delete on public.timeline_events to authenticated;
grant select, insert, update, delete on public.open_threads to authenticated;
grant select, insert, update, delete on public.timeline_event_entities to authenticated;
grant select, insert, update, delete on public.open_thread_entities to authenticated;
grant execute on function public.validate_narrative_source_books() to authenticated;
grant execute on function public.validate_narrative_entity_books() to authenticated;
grant execute on function public.set_narrative_updated_by() to authenticated;

comment on table public.timeline_events is 'Eventos narrativos canônicos, aprovados pelos autores e ligados opcionalmente a entidades.';
comment on table public.open_threads is 'Plots, mistérios e conflitos narrativos acompanhados pelos autores.';
comment on table public.timeline_event_entities is 'Entidades participantes ou relacionadas a eventos narrativos.';
comment on table public.open_thread_entities is 'Entidades relacionadas a plots, mistérios e conflitos abertos.';

-- A RPC é redefinida nesta migration para manter a aprovação atômica dos tipos novos.
create or replace function public.approve_memory_proposal(
  target_proposal_id uuid,
  edited_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal public.memory_proposals;
  payload jsonb;
  result jsonb;
  entity_id uuid;
  existing_entity_id uuid;
  v_from_entity_id uuid;
  v_to_entity_id uuid;
  existing_relation_id uuid;
  fact_id uuid;
  relation_id uuid;
  event_id uuid;
  thread_id uuid;
  candidate_name text;
  entity_name text;
  entity_type text;
  title text;
  summary text;
  statement text;
  relation_type text;
  description text;
  visibility text;
  aliases text[];
  attributes jsonb;
  event_kind text;
  narrative_time text;
  thread_status text;
  priority text;
begin
  select p.*
    into proposal
    from public.memory_proposals p
   where p.id = target_proposal_id
     and public.is_book_member(p.book_id)
   for update;

  if proposal.id is null then
    raise exception 'Proposta não encontrada ou acesso negado';
  end if;

  if proposal.status = 'approved' then
    return jsonb_build_object(
      'proposal_id', proposal.id,
      'status', proposal.status,
      'already_approved', true,
      'approved_records', proposal.approved_records
    );
  end if;

  if proposal.status <> 'pending' then
    raise exception 'Somente propostas pendentes podem ser aprovadas';
  end if;

  payload := coalesce(edited_payload, proposal.payload);
  if jsonb_typeof(payload) <> 'object' then
    raise exception 'O payload editado precisa ser um objeto JSON';
  end if;

  visibility := case
    when payload->>'visibility' = 'author_only' then 'author_only'
    else 'canon'
  end;

  if proposal.proposal_kind = 'entity' then
    entity_name := nullif(btrim(coalesce(payload->>'name', proposal.title)), '');
    if entity_name is null then
      raise exception 'A entidade precisa ter um nome';
    end if;

    entity_type := case payload->>'entity_type'
      when 'character' then 'character'
      when 'location' then 'location'
      when 'faction' then 'faction'
      when 'organization' then 'organization'
      when 'power' then 'power'
      when 'item' then 'item'
      when 'creature' then 'creature'
      when 'concept' then 'concept'
      else 'other'
    end;
    summary := left(coalesce(payload->>'summary', ''), 20000);
    attributes := case
      when jsonb_typeof(payload->'attributes') = 'object' then payload->'attributes'
      else '{}'::jsonb
    end;
    aliases := case
      when jsonb_typeof(payload->'aliases') = 'array'
        then coalesce(array(select jsonb_array_elements_text(payload->'aliases')), '{}'::text[])
      else '{}'::text[]
    end;

    existing_entity_id := public.resolve_memory_entity(proposal.book_id, entity_name);
    if existing_entity_id is not null then
      entity_id := existing_entity_id;
    else
      insert into public.universe_entities (
        book_id, name, entity_type, summary, aliases, attributes,
        visibility, created_by, updated_by
      ) values (
        proposal.book_id, entity_name, entity_type, summary, aliases, attributes,
        visibility, auth.uid(), auth.uid()
      )
      returning id into entity_id;
    end if;

    result := jsonb_build_object(
      'entity_id', entity_id,
      'created', existing_entity_id is null
    );

  elsif proposal.proposal_kind = 'fact' then
    statement := nullif(btrim(payload->>'statement'), '');
    if statement is null then
      raise exception 'O fato precisa ter uma afirmação';
    end if;

    candidate_name := nullif(btrim(payload->>'entity_name'), '');
    entity_id := public.resolve_memory_entity(proposal.book_id, candidate_name);

    insert into public.canon_facts (
      book_id, entity_id, statement, source_kind, source_chapter_id,
      source_version_id, evidence, visibility, status, created_by, updated_by
    ) values (
      proposal.book_id, entity_id, left(statement, 4000), 'manuscript',
      proposal.chapter_id, proposal.version_id, left(proposal.evidence, 10000),
      visibility, 'active', auth.uid(), auth.uid()
    )
    returning id into fact_id;

    result := jsonb_build_object(
      'fact_id', fact_id,
      'entity_id', entity_id,
      'created', true
    );

  elsif proposal.proposal_kind = 'relation' then
    candidate_name := nullif(btrim(payload->>'from_entity'), '');
    v_from_entity_id := public.resolve_memory_entity(proposal.book_id, candidate_name);
    candidate_name := nullif(btrim(payload->>'to_entity'), '');
    v_to_entity_id := public.resolve_memory_entity(proposal.book_id, candidate_name);
    relation_type := nullif(btrim(payload->>'relation_type'), '');
    description := left(coalesce(payload->>'description', ''), 4000);

    if v_from_entity_id is null or v_to_entity_id is null then
      raise exception 'A relação precisa apontar para duas entidades já aprovadas';
    end if;
    if v_from_entity_id = v_to_entity_id then
      raise exception 'Uma relação não pode apontar para a mesma entidade';
    end if;
    if relation_type is null then
      raise exception 'A relação precisa ter um tipo';
    end if;

    select r.id
      into existing_relation_id
      from public.universe_relations r
     where r.book_id = proposal.book_id
       and r.from_entity_id = v_from_entity_id
       and r.to_entity_id = v_to_entity_id
       and lower(r.relation_type) = lower(relation_type)
       and r.archived_at is null
     limit 1;

    if existing_relation_id is not null then
      relation_id := existing_relation_id;
    else
      insert into public.universe_relations (
        book_id, from_entity_id, to_entity_id, relation_type, description,
        source_kind, source_chapter_id, source_version_id, visibility,
        created_by, updated_by
      ) values (
        proposal.book_id, v_from_entity_id, v_to_entity_id, left(relation_type, 160),
        description, 'manuscript', proposal.chapter_id, proposal.version_id,
        visibility, auth.uid(), auth.uid()
      )
      returning id into relation_id;
    end if;

    result := jsonb_build_object(
      'relation_id', relation_id,
      'created', existing_relation_id is null
    );

  elsif proposal.proposal_kind = 'event' then
    title := nullif(btrim(coalesce(payload->>'title', proposal.title)), '');
    if title is null then
      raise exception 'O evento precisa ter um título';
    end if;

    event_kind := case payload->>'event_kind'
      when 'action' then 'action'
      when 'revelation' then 'revelation'
      when 'conflict' then 'conflict'
      when 'relationship_change' then 'relationship_change'
      when 'discovery' then 'discovery'
      when 'scene' then 'scene'
      else 'other'
    end;
    description := left(coalesce(payload->>'description', ''), 4000);
    narrative_time := left(coalesce(payload->>'narrative_time', ''), 240);

    insert into public.timeline_events (
      book_id, event_kind, title, description, narrative_time, source_kind,
      source_chapter_id, source_version_id, evidence, visibility,
      status, created_by, updated_by
    ) values (
      proposal.book_id, event_kind, left(title, 240), description, narrative_time,
      'manuscript', proposal.chapter_id, proposal.version_id,
      left(proposal.evidence, 10000), visibility, 'active', auth.uid(), auth.uid()
    )
    returning id into event_id;

    if jsonb_typeof(payload->'entities_involved') = 'array' then
      for candidate_name in
        select value from jsonb_array_elements_text(payload->'entities_involved') as value
      loop
        entity_id := public.resolve_memory_entity(proposal.book_id, candidate_name);
        if entity_id is not null then
          insert into public.timeline_event_entities (event_id, entity_id)
          values (event_id, entity_id)
          on conflict (event_id, entity_id) do nothing;
        end if;
      end loop;
    end if;

    result := jsonb_build_object(
      'event_id', event_id,
      'created', true,
      'unresolved_entity_names', coalesce(
        (
          select jsonb_agg(value)
            from jsonb_array_elements_text(coalesce(payload->'entities_involved', '[]'::jsonb)) as value
           where public.resolve_memory_entity(proposal.book_id, value) is null
        ),
        '[]'::jsonb
      )
    );

  elsif proposal.proposal_kind = 'open_thread' then
    title := nullif(btrim(coalesce(payload->>'title', proposal.title)), '');
    if title is null then
      raise exception 'A trama aberta precisa ter um título';
    end if;

    thread_status := case payload->>'thread_status'
      when 'in_progress' then 'in_progress'
      when 'resolved' then 'resolved'
      when 'abandoned' then 'abandoned'
      when 'contradicted' then 'contradicted'
      else 'open'
    end;
    priority := case payload->>'priority'
      when 'low' then 'low'
      when 'high' then 'high'
      else 'normal'
    end;
    description := left(coalesce(payload->>'description', ''), 4000);

    insert into public.open_threads (
      book_id, title, description, status, priority, source_kind,
      source_chapter_id, source_version_id, evidence, visibility,
      created_by, updated_by
    ) values (
      proposal.book_id, left(title, 240), description, thread_status, priority,
      'manuscript', proposal.chapter_id, proposal.version_id,
      left(proposal.evidence, 10000), visibility, auth.uid(), auth.uid()
    )
    returning id into thread_id;

    if jsonb_typeof(payload->'entities_involved') = 'array' then
      for candidate_name in
        select value from jsonb_array_elements_text(payload->'entities_involved') as value
      loop
        entity_id := public.resolve_memory_entity(proposal.book_id, candidate_name);
        if entity_id is not null then
          insert into public.open_thread_entities (thread_id, entity_id)
          values (thread_id, entity_id)
          on conflict (thread_id, entity_id) do nothing;
        end if;
      end loop;
    end if;

    result := jsonb_build_object(
      'thread_id', thread_id,
      'created', true,
      'unresolved_entity_names', coalesce(
        (
          select jsonb_agg(value)
            from jsonb_array_elements_text(coalesce(payload->'entities_involved', '[]'::jsonb)) as value
           where public.resolve_memory_entity(proposal.book_id, value) is null
        ),
        '[]'::jsonb
      )
    );

  else
    raise exception 'Tipo de proposta não suportado';
  end if;

  update public.memory_proposals
     set status = 'approved',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         approved_records = jsonb_build_array(result),
         review_note = case
           when edited_payload is null then review_note
           else 'Payload editado pelos autores durante a aprovação.'
         end
   where id = proposal.id;

  return result || jsonb_build_object(
    'proposal_id', proposal.id,
    'status', 'approved',
    'already_approved', false
  );
end;
$$;

grant execute on function public.approve_memory_proposal(uuid, jsonb) to authenticated;
comment on function public.approve_memory_proposal(uuid, jsonb) is
  'Aprova uma proposta de memória e cria seu registro canônico em uma transação atômica, incluindo eventos e tramas abertas.';

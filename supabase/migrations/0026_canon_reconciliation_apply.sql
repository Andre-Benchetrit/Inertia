-- Fase B do Reconciliador de Cânone.
--
-- A IA continua sem permissão para escrever no cânone. Esta migration cria
-- apenas operações executáveis após uma decisão humana explícita:
--   1. revisão da proposta: pending -> approved/rejected;
--   2. aplicação: approved -> applied;
--   3. aplicação em lote, com uma única transação por livro.
--
-- As funções são SECURITY DEFINER porque a aplicação precisa ser atômica entre
-- tabelas relacionadas. A autorização não é delegada ao RLS: cada função
-- verifica associação ao livro, status da proposta e auth.uid().

alter table public.canon_reconciliation_proposals
  add column if not exists applied_by uuid references auth.users(id) on delete set null;

alter table public.canon_reconciliation_proposals
  add column if not exists applied_at timestamptz;

alter table public.canon_reconciliation_proposals
  add column if not exists apply_note text not null default '' check (char_length(apply_note) <= 4000);

alter table public.canon_reconciliation_proposals
  add column if not exists applied_records jsonb not null default '[]'::jsonb
    check (jsonb_typeof(applied_records) = 'array');

alter table public.canon_reconciliation_proposals
  drop constraint if exists canon_reconciliation_proposals_status_check;

alter table public.canon_reconciliation_proposals
  add constraint canon_reconciliation_proposals_status_check
  check (status in ('pending', 'approved', 'rejected', 'superseded', 'archived', 'applied'));

alter table public.universe_entities
  add column if not exists last_reconciliation_proposal_id uuid
    references public.canon_reconciliation_proposals(id) on delete set null;

alter table public.canon_facts
  add column if not exists last_reconciliation_proposal_id uuid
    references public.canon_reconciliation_proposals(id) on delete set null;

alter table public.universe_relations
  add column if not exists last_reconciliation_proposal_id uuid
    references public.canon_reconciliation_proposals(id) on delete set null;

alter table public.timeline_events
  add column if not exists last_reconciliation_proposal_id uuid
    references public.canon_reconciliation_proposals(id) on delete set null;

alter table public.open_threads
  add column if not exists last_reconciliation_proposal_id uuid
    references public.canon_reconciliation_proposals(id) on delete set null;

create index if not exists universe_entities_last_reconciliation_idx
  on public.universe_entities (last_reconciliation_proposal_id)
  where last_reconciliation_proposal_id is not null;

create index if not exists canon_facts_last_reconciliation_idx
  on public.canon_facts (last_reconciliation_proposal_id)
  where last_reconciliation_proposal_id is not null;

create index if not exists universe_relations_last_reconciliation_idx
  on public.universe_relations (last_reconciliation_proposal_id)
  where last_reconciliation_proposal_id is not null;

create index if not exists timeline_events_last_reconciliation_idx
  on public.timeline_events (last_reconciliation_proposal_id)
  where last_reconciliation_proposal_id is not null;

create index if not exists open_threads_last_reconciliation_idx
  on public.open_threads (last_reconciliation_proposal_id)
  where last_reconciliation_proposal_id is not null;

create or replace function public.canon_reconciliation_uuid(candidate text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  if candidate is null or btrim(candidate) = '' then
    return null;
  end if;

  if candidate !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  return candidate::uuid;
end;
$$;

create or replace function public.resolve_canon_reconciliation_entity(
  target_book_id uuid,
  candidate text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate_id uuid;
  resolved_id uuid;
begin
  if candidate is null or btrim(candidate) = '' then
    return null;
  end if;

  candidate_id := public.canon_reconciliation_uuid(btrim(candidate));
  if candidate_id is not null then
    select e.id
      into resolved_id
      from public.universe_entities e
     where e.id = candidate_id
       and e.book_id = target_book_id
       and e.archived_at is null;
    return resolved_id;
  end if;

  return public.resolve_memory_entity(target_book_id, btrim(candidate));
end;
$$;

create or replace function public.canon_reconciliation_uuid_array(
  payload jsonb,
  property_name text
)
returns uuid[]
language plpgsql
immutable
set search_path = public
as $$
declare
  items jsonb;
  item jsonb;
  result_ids uuid[] := '{}'::uuid[];
  item_id uuid;
  candidate text;
begin
  items := payload -> property_name;
  if items is null or jsonb_typeof(items) <> 'array' then
    return result_ids;
  end if;

  for item in select value from jsonb_array_elements(items) loop
    candidate := case
      when jsonb_typeof(item) = 'object'
        then coalesce(item->>'id', item->>'record_id')
      else item #>> '{}'
    end;
    item_id := public.canon_reconciliation_uuid(candidate);
    if item_id is null then
      raise exception 'O campo % contém um UUID inválido', property_name;
    end if;
    if not item_id = any(result_ids) then
      result_ids := array_append(result_ids, item_id);
    end if;
  end loop;

  return result_ids;
end;
$$;

create or replace function public.canon_reconciliation_entity_ids(
  target_book_id uuid,
  payload jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  property_name text;
  items jsonb;
  item jsonb;
  result_ids uuid[] := '{}'::uuid[];
  entity_id uuid;
  candidate text;
begin
  foreach property_name in array array['entity_ids', 'entities_involved', 'entities'] loop
    items := payload -> property_name;
    if items is null or jsonb_typeof(items) <> 'array' then
      continue;
    end if;

    for item in select value from jsonb_array_elements(items) loop
      candidate := case
        when jsonb_typeof(item) = 'object'
          then coalesce(item->>'id', item->>'entity_id', item->>'name', item->>'label')
        else item #>> '{}'
      end;
      entity_id := public.resolve_canon_reconciliation_entity(target_book_id, candidate);
      if entity_id is null then
        raise exception 'A entidade % não foi encontrada neste livro', coalesce(candidate, '[vazio]');
      end if;
      if not entity_id = any(result_ids) then
        result_ids := array_append(result_ids, entity_id);
      end if;
    end loop;
  end loop;

  return result_ids;
end;
$$;

create or replace function public.review_canon_reconciliation_proposal(
  target_proposal_id uuid,
  requested_status text,
  requested_title text default null,
  requested_payload jsonb default null,
  requested_review_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal public.canon_reconciliation_proposals;
  next_title text;
  next_payload jsonb;
  note text;
  actor_id uuid;
  result jsonb;
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'É necessário estar autenticado para revisar uma proposta';
  end if;

  if requested_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Status de revisão inválido';
  end if;

  select p.*
    into proposal
    from public.canon_reconciliation_proposals p
   where p.id = target_proposal_id
     and public.is_book_member(p.book_id)
   for update;

  if proposal.id is null then
    raise exception 'Proposta não encontrada ou acesso negado';
  end if;

  if requested_status = 'pending' then
    if proposal.status <> 'pending' then
      raise exception 'Somente uma proposta pendente pode receber edição';
    end if;
  elsif proposal.status <> 'pending' then
    raise exception 'Somente propostas pendentes podem ser aprovadas ou rejeitadas';
  end if;

  next_title := left(coalesce(nullif(btrim(requested_title), ''), proposal.title), 240);
  if next_title = '' then
    raise exception 'A proposta precisa ter um título';
  end if;

  next_payload := coalesce(requested_payload, proposal.payload);
  if jsonb_typeof(next_payload) <> 'object' then
    raise exception 'O payload da proposta precisa ser um objeto JSON';
  end if;

  note := left(coalesce(requested_review_note, ''), 4000);

  update public.canon_reconciliation_proposals p
     set title = next_title,
         payload = next_payload,
         status = requested_status,
         reviewed_by = case when requested_status = 'pending' then p.reviewed_by else actor_id end,
         reviewed_at = case when requested_status = 'pending' then p.reviewed_at else now() end,
         review_note = case
           when requested_status = 'pending' then note
           when note <> '' then note
           when requested_status = 'approved' then 'Aprovada pelos autores. A aplicação ao cânone requer ação explícita.'
           else 'Rejeitada pelos autores. Não será aplicada ao cânone.'
         end
   where p.id = proposal.id
   returning to_jsonb(p) into result;

  return result;
end;
$$;

create or replace function public.apply_canon_reconciliation_proposal(
  target_proposal_id uuid,
  requested_apply_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  proposal public.canon_reconciliation_proposals;
  actor_id uuid;
  result jsonb := '{}'::jsonb;
  target_id uuid;
  survivor_id uuid;
  source_ids uuid[];
  source_id uuid;
  entity_id uuid;
  from_entity_id uuid;
  to_entity_id uuid;
  existing_id uuid;
  relation_type text;
  entity_name text;
  entity_type text;
  summary text;
  statement text;
  relation_description text;
  event_payload jsonb;
  event_title text;
  event_description text;
  event_kind text;
  narrative_time text;
  thread_title text;
  thread_description text;
  thread_status text;
  thread_priority text;
  visibility text;
  source_kind text;
  source_chapter_id uuid;
  source_version_id uuid;
  aliases text[];
  attributes jsonb;
  entity_ids uuid[];
  source_entity public.universe_entities;
  survivor_entity public.universe_entities;
  source_fact public.canon_facts;
  survivor_fact public.canon_facts;
  source_event public.timeline_events;
  survivor_event public.timeline_events;
  source_thread public.open_threads;
  survivor_thread public.open_threads;
  relation_row public.universe_relations;
  duplicate_relation_id uuid;
  item_id uuid;
  item jsonb;
  applied_note text;
  source_count integer;
  created_record boolean;
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'É necessário estar autenticado para aplicar uma proposta';
  end if;

  select p.*
    into proposal
    from public.canon_reconciliation_proposals p
   where p.id = target_proposal_id
     and public.is_book_member(p.book_id)
   for update;

  if proposal.id is null then
    raise exception 'Proposta não encontrada ou acesso negado';
  end if;

  if proposal.status = 'applied' then
    return jsonb_build_object(
      'proposal_id', proposal.id,
      'status', proposal.status,
      'already_applied', true,
      'applied_records', proposal.applied_records
    );
  end if;

  if proposal.status <> 'approved' then
    raise exception 'Somente propostas aprovadas podem ser aplicadas ao cânone';
  end if;

  applied_note := left(coalesce(nullif(btrim(requested_apply_note), ''), 'Aplicada pelos autores ao cânone.'), 4000);
  visibility := case when proposal.payload->>'visibility' = 'author_only' then 'author_only' else 'canon' end;
  source_kind := case when proposal.payload->>'source_kind' = 'manuscript' then 'manuscript' else 'author' end;

  if proposal.proposal_kind = 'entity' then
    if proposal.operation = 'create' then
      created_record := false;
      entity_name := left(nullif(btrim(coalesce(proposal.payload->>'name', proposal.title)), ''), 240);
      if entity_name is null then
        raise exception 'A entidade precisa ter um nome';
      end if;

      entity_type := case proposal.payload->>'entity_type'
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
      summary := left(coalesce(proposal.payload->>'summary', ''), 20000);
      attributes := case
        when jsonb_typeof(proposal.payload->'attributes') = 'object' then proposal.payload->'attributes'
        else '{}'::jsonb
      end;
      aliases := case
        when jsonb_typeof(proposal.payload->'aliases') = 'array'
          then array(select jsonb_array_elements_text(proposal.payload->'aliases'))
        else '{}'::text[]
      end;

      select e.id
        into existing_id
        from public.universe_entities e
       where e.book_id = proposal.book_id
         and lower(e.name) = lower(entity_name)
         and e.archived_at is null
       for update;

      if existing_id is null then
        insert into public.universe_entities (
          book_id, name, entity_type, summary, aliases, attributes,
          visibility, created_by, updated_by, last_reconciliation_proposal_id
        ) values (
          proposal.book_id, entity_name, entity_type, summary, aliases, attributes,
          visibility, actor_id, actor_id, proposal.id
        ) returning id into existing_id;
        created_record := true;
      end if;
      if not created_record then
        update public.universe_entities
           set last_reconciliation_proposal_id = proposal.id
         where id = existing_id;
      end if;

      result := jsonb_build_object(
        'record_type', 'entity',
        'entity_id', existing_id,
        'created', created_record
      );

    elsif proposal.operation = 'update' then
      target_id := public.canon_reconciliation_uuid(coalesce(proposal.target->>'record_id', proposal.target->>'id'));
      if target_id is null then
        raise exception 'A atualização da entidade precisa de target.record_id';
      end if;

      select e.*
        into survivor_entity
        from public.universe_entities e
       where e.id = target_id
         and e.book_id = proposal.book_id
         and e.archived_at is null
       for update;
      if survivor_entity.id is null then
        raise exception 'A entidade alvo não existe ou pertence a outro livro';
      end if;

      entity_name := left(coalesce(nullif(btrim(proposal.payload->>'name'), ''), survivor_entity.name), 240);
      entity_type := case
        when proposal.payload->>'entity_type' = 'character' then 'character'
        when proposal.payload->>'entity_type' = 'location' then 'location'
        when proposal.payload->>'entity_type' = 'faction' then 'faction'
        when proposal.payload->>'entity_type' = 'organization' then 'organization'
        when proposal.payload->>'entity_type' = 'power' then 'power'
        when proposal.payload->>'entity_type' = 'item' then 'item'
        when proposal.payload->>'entity_type' = 'creature' then 'creature'
        when proposal.payload->>'entity_type' = 'concept' then 'concept'
        when proposal.payload ? 'entity_type' then 'other'
        else survivor_entity.entity_type
      end;
      summary := left(coalesce(nullif(proposal.payload->>'summary', ''), survivor_entity.summary), 20000);
      visibility := case
        when proposal.payload ? 'visibility' and proposal.payload->>'visibility' = 'author_only' then 'author_only'
        when proposal.payload ? 'visibility' then 'canon'
        else survivor_entity.visibility
      end;
      attributes := case
        when jsonb_typeof(proposal.payload->'attributes') = 'object' then proposal.payload->'attributes'
        else survivor_entity.attributes
      end;
      aliases := case
        when jsonb_typeof(proposal.payload->'aliases') = 'array'
          then array(select jsonb_array_elements_text(proposal.payload->'aliases'))
        else survivor_entity.aliases
      end;

      update public.universe_entities
         set name = entity_name,
             entity_type = entity_type,
             summary = summary,
             aliases = aliases,
             attributes = attributes,
             visibility = visibility,
             last_reconciliation_proposal_id = proposal.id
       where id = survivor_entity.id;

      result := jsonb_build_object('record_type', 'entity', 'entity_id', survivor_entity.id, 'updated', true);

    elsif proposal.operation = 'merge' then
      survivor_id := public.canon_reconciliation_uuid(coalesce(proposal.payload->>'survivor_id', proposal.target->>'record_id'));
      source_ids := public.canon_reconciliation_uuid_array(proposal.payload, 'source_record_ids');
      if survivor_id is null or cardinality(source_ids) = 0 then
        raise exception 'A consolidação de entidade precisa de survivor_id e source_record_ids';
      end if;

      select e.* into survivor_entity
        from public.universe_entities e
       where e.id = survivor_id
         and e.book_id = proposal.book_id
         and e.archived_at is null
       for update;
      if survivor_entity.id is null then
        raise exception 'A entidade sobrevivente não existe ou pertence a outro livro';
      end if;

      source_count := 0;
      foreach source_id in array source_ids loop
        if source_id = survivor_id then
          continue;
        end if;

        select e.* into source_entity
          from public.universe_entities e
         where e.id = source_id
           and e.book_id = proposal.book_id
           and e.archived_at is null
         for update;
        if source_entity.id is null then
          raise exception 'A entidade fonte % não existe ou já foi arquivada', source_id;
        end if;

        update public.universe_entities survivor
           set aliases = array(
                 select distinct value
                   from unnest(coalesce(survivor.aliases, '{}'::text[]) || coalesce(source_entity.aliases, '{}'::text[])) as value
                  where btrim(value) <> ''
               ),
               attributes = coalesce(survivor.attributes, '{}'::jsonb) || coalesce(source_entity.attributes, '{}'::jsonb),
               summary = case
                 when btrim(coalesce(survivor.summary, '')) = '' then source_entity.summary
                 else survivor.summary
               end,
               last_reconciliation_proposal_id = proposal.id
         where survivor.id = survivor_id;

        update public.canon_facts
           set entity_id = survivor_id,
               last_reconciliation_proposal_id = proposal.id
         where book_id = proposal.book_id
           and entity_id = source_id
           and archived_at is null;

        for relation_row in
          select r.*
            from public.universe_relations r
           where r.book_id = proposal.book_id
             and r.archived_at is null
             and (r.from_entity_id = source_id or r.to_entity_id = source_id)
           for update
        loop
          from_entity_id := case when relation_row.from_entity_id = source_id then survivor_id else relation_row.from_entity_id end;
          to_entity_id := case when relation_row.to_entity_id = source_id then survivor_id else relation_row.to_entity_id end;
          duplicate_relation_id := null;

          if from_entity_id = to_entity_id then
            update public.universe_relations
               set archived_at = now(), last_reconciliation_proposal_id = proposal.id
             where id = relation_row.id;
          else
            select r.id into duplicate_relation_id
              from public.universe_relations r
             where r.book_id = proposal.book_id
               and r.id <> relation_row.id
               and r.archived_at is null
               and r.from_entity_id = from_entity_id
               and r.to_entity_id = to_entity_id
               and lower(r.relation_type) = lower(relation_row.relation_type)
             for update;

            if duplicate_relation_id is null then
              update public.universe_relations
                 set from_entity_id = from_entity_id,
                     to_entity_id = to_entity_id,
                     last_reconciliation_proposal_id = proposal.id
               where id = relation_row.id;
            else
              update public.universe_relations
                 set last_reconciliation_proposal_id = proposal.id
               where id = duplicate_relation_id;
              update public.universe_relations
                 set archived_at = now(), last_reconciliation_proposal_id = proposal.id
               where id = relation_row.id;
            end if;
          end if;
        end loop;

        insert into public.timeline_event_entities (event_id, entity_id, role)
        select ee.event_id, survivor_id, ee.role
          from public.timeline_event_entities ee
         where ee.entity_id = source_id
        on conflict (event_id, entity_id) do nothing;
        delete from public.timeline_event_entities where entity_id = source_id;

        insert into public.open_thread_entities (thread_id, entity_id, role)
        select te.thread_id, survivor_id, te.role
          from public.open_thread_entities te
         where te.entity_id = source_id
        on conflict (thread_id, entity_id) do nothing;
        delete from public.open_thread_entities where entity_id = source_id;

        update public.universe_entities
           set archived_at = now(), last_reconciliation_proposal_id = proposal.id
         where id = source_id;
        source_count := source_count + 1;
      end loop;

      result := jsonb_build_object(
        'record_type', 'entity',
        'entity_id', survivor_id,
        'merged_source_count', source_count,
        'source_record_ids', to_jsonb(source_ids)
      );

    elsif proposal.operation = 'archive' then
      target_id := public.canon_reconciliation_uuid(coalesce(proposal.target->>'record_id', proposal.target->>'id'));
      if target_id is null then
        raise exception 'O arquivamento da entidade precisa de target.record_id';
      end if;
      update public.universe_entities
         set archived_at = now(), last_reconciliation_proposal_id = proposal.id
       where id = target_id and book_id = proposal.book_id and archived_at is null;
      if not found then
        raise exception 'A entidade alvo não existe ou já foi arquivada';
      end if;
      result := jsonb_build_object('record_type', 'entity', 'entity_id', target_id, 'archived', true);
    else
      raise exception 'A operação % não é válida para entidades', proposal.operation;
    end if;

  elsif proposal.proposal_kind = 'fact' then
    if proposal.operation = 'create' then
      created_record := false;
      statement := left(nullif(btrim(proposal.payload->>'statement'), ''), 4000);
      if statement is null then
        raise exception 'O fato precisa ter uma afirmação';
      end if;
      entity_id := public.resolve_canon_reconciliation_entity(
        proposal.book_id,
        coalesce(proposal.payload->>'entity_id', proposal.payload->>'entity_name')
      );
      if coalesce(proposal.payload->>'entity_id', proposal.payload->>'entity_name') is not null and entity_id is null then
        raise exception 'A entidade vinculada ao fato não foi encontrada';
      end if;
      select f.id into existing_id
        from public.canon_facts f
       where f.book_id = proposal.book_id
         and f.entity_id is not distinct from entity_id
         and lower(btrim(f.statement)) = lower(btrim(statement))
         and f.status = 'active'
         and f.archived_at is null
       for update;
      if existing_id is null then
        insert into public.canon_facts (
          book_id, entity_id, title, statement, source_kind, source_chapter_id,
          source_version_id, evidence, visibility, status, created_by, updated_by,
          last_reconciliation_proposal_id
        ) values (
          proposal.book_id, entity_id, left(coalesce(proposal.payload->>'title', proposal.title), 240),
          statement, source_kind,
          public.canon_reconciliation_uuid(proposal.payload->>'source_chapter_id'),
          public.canon_reconciliation_uuid(proposal.payload->>'source_version_id'),
          left(coalesce(proposal.payload->>'evidence', proposal.evidence), 10000),
          visibility, 'active', actor_id, actor_id, proposal.id
        ) returning id into existing_id;
        created_record := true;
      end if;
      if not created_record then
        update public.canon_facts
           set last_reconciliation_proposal_id = proposal.id
         where id = existing_id;
      end if;
      result := jsonb_build_object('record_type', 'fact', 'fact_id', existing_id, 'created', created_record);

    elsif proposal.operation = 'update' then
      target_id := public.canon_reconciliation_uuid(coalesce(proposal.target->>'record_id', proposal.target->>'id'));
      if target_id is null then
        raise exception 'A atualização do fato precisa de target.record_id';
      end if;
      select f.* into survivor_fact
        from public.canon_facts f
       where f.id = target_id and f.book_id = proposal.book_id and f.archived_at is null
       for update;
      if survivor_fact.id is null then
        raise exception 'O fato alvo não existe ou pertence a outro livro';
      end if;
      statement := left(coalesce(nullif(btrim(proposal.payload->>'statement'), ''), survivor_fact.statement), 4000);
      visibility := case
        when proposal.payload ? 'visibility' and proposal.payload->>'visibility' = 'author_only' then 'author_only'
        when proposal.payload ? 'visibility' then 'canon'
        else survivor_fact.visibility
      end;
      entity_id := case
        when proposal.payload ? 'entity_id' or proposal.payload ? 'entity_name'
          then public.resolve_canon_reconciliation_entity(proposal.book_id, coalesce(proposal.payload->>'entity_id', proposal.payload->>'entity_name'))
        else survivor_fact.entity_id
      end;
      if (proposal.payload ? 'entity_id' or proposal.payload ? 'entity_name') and entity_id is null then
        raise exception 'A entidade vinculada ao fato não foi encontrada';
      end if;
      update public.canon_facts
         set entity_id = entity_id,
             title = left(coalesce(nullif(proposal.payload->>'title', ''), survivor_fact.title), 240),
             statement = statement,
             evidence = left(coalesce(nullif(proposal.payload->>'evidence', ''), survivor_fact.evidence), 10000),
             visibility = visibility,
             last_reconciliation_proposal_id = proposal.id
       where id = survivor_fact.id;
      result := jsonb_build_object('record_type', 'fact', 'fact_id', survivor_fact.id, 'updated', true);

    elsif proposal.operation = 'merge' then
      survivor_id := public.canon_reconciliation_uuid(coalesce(proposal.payload->>'survivor_id', proposal.target->>'record_id'));
      source_ids := public.canon_reconciliation_uuid_array(proposal.payload, 'source_record_ids');
      if survivor_id is null or cardinality(source_ids) = 0 then
        raise exception 'A consolidação de fatos precisa de survivor_id e source_record_ids';
      end if;
      select f.* into survivor_fact
        from public.canon_facts f
       where f.id = survivor_id and f.book_id = proposal.book_id and f.archived_at is null
       for update;
      if survivor_fact.id is null then
        raise exception 'O fato sobrevivente não existe ou pertence a outro livro';
      end if;
      source_count := 0;
      foreach source_id in array source_ids loop
        if source_id = survivor_id then continue; end if;
        select f.* into source_fact
          from public.canon_facts f
         where f.id = source_id and f.book_id = proposal.book_id and f.archived_at is null
         for update;
        if source_fact.id is null then
          raise exception 'O fato fonte % não existe ou já foi arquivado', source_id;
        end if;
        update public.canon_facts survivor
           set title = case when btrim(coalesce(survivor.title, '')) = '' then source_fact.title else survivor.title end,
               evidence = left(trim(both from concat_ws(chr(10) || chr(10), nullif(survivor.evidence, ''), nullif(source_fact.evidence, ''))), 10000),
               source_chapter_id = coalesce(survivor.source_chapter_id, source_fact.source_chapter_id),
               source_version_id = coalesce(survivor.source_version_id, source_fact.source_version_id),
               last_reconciliation_proposal_id = proposal.id
         where survivor.id = survivor_id;
        update public.canon_facts
           set status = 'superseded', archived_at = now(), last_reconciliation_proposal_id = proposal.id
         where id = source_id;
        source_count := source_count + 1;
      end loop;
      result := jsonb_build_object('record_type', 'fact', 'fact_id', survivor_id, 'merged_source_count', source_count, 'source_record_ids', to_jsonb(source_ids));

    elsif proposal.operation = 'archive' then
      target_id := public.canon_reconciliation_uuid(coalesce(proposal.target->>'record_id', proposal.target->>'id'));
      if target_id is null then raise exception 'O arquivamento do fato precisa de target.record_id'; end if;
      update public.canon_facts
         set status = 'archived', archived_at = now(), last_reconciliation_proposal_id = proposal.id
       where id = target_id and book_id = proposal.book_id and archived_at is null;
      if not found then raise exception 'O fato alvo não existe ou já foi arquivado'; end if;
      result := jsonb_build_object('record_type', 'fact', 'fact_id', target_id, 'archived', true);
    else
      raise exception 'A operação % não é válida para fatos', proposal.operation;
    end if;

  elsif proposal.proposal_kind = 'relation' then
    if proposal.operation = 'create' then
      created_record := false;
      from_entity_id := public.resolve_canon_reconciliation_entity(proposal.book_id, coalesce(proposal.target->>'from_entity_id', proposal.payload->>'from_entity_id', proposal.payload->>'from_entity'));
      to_entity_id := public.resolve_canon_reconciliation_entity(proposal.book_id, coalesce(proposal.target->>'to_entity_id', proposal.payload->>'to_entity_id', proposal.payload->>'to_entity'));
      relation_type := left(nullif(btrim(proposal.payload->>'relation_type'), ''), 160);
      relation_description := left(coalesce(proposal.payload->>'description', proposal.explanation), 4000);
      if from_entity_id is null or to_entity_id is null then raise exception 'A relação precisa apontar para duas entidades do livro'; end if;
      if from_entity_id = to_entity_id then raise exception 'Uma relação não pode apontar para a mesma entidade'; end if;
      if relation_type is null then raise exception 'A relação precisa ter um tipo'; end if;
      select r.id into existing_id
        from public.universe_relations r
       where r.book_id = proposal.book_id
         and r.from_entity_id = from_entity_id
         and r.to_entity_id = to_entity_id
         and lower(r.relation_type) = lower(relation_type)
         and r.archived_at is null
       for update;
      if existing_id is null then
        insert into public.universe_relations (
          book_id, from_entity_id, to_entity_id, relation_type, description,
          source_kind, source_chapter_id, source_version_id, visibility,
          created_by, updated_by, last_reconciliation_proposal_id
        ) values (
          proposal.book_id, from_entity_id, to_entity_id, relation_type, relation_description,
          source_kind,
          public.canon_reconciliation_uuid(proposal.payload->>'source_chapter_id'),
          public.canon_reconciliation_uuid(proposal.payload->>'source_version_id'),
          visibility, actor_id, actor_id, proposal.id
        ) returning id into existing_id;
        created_record := true;
      end if;
      if not created_record then
        update public.universe_relations
           set last_reconciliation_proposal_id = proposal.id
         where id = existing_id;
      end if;
      result := jsonb_build_object('record_type', 'relation', 'relation_id', existing_id, 'created', created_record);

    elsif proposal.operation = 'update' then
      target_id := public.canon_reconciliation_uuid(coalesce(proposal.target->>'record_id', proposal.target->>'id'));
      if target_id is null then raise exception 'A atualização da relação precisa de target.record_id'; end if;
      select r.* into relation_row
        from public.universe_relations r
       where r.id = target_id and r.book_id = proposal.book_id and r.archived_at is null
       for update;
      if relation_row.id is null then raise exception 'A relação alvo não existe ou pertence a outro livro'; end if;
      visibility := case
        when proposal.payload ? 'visibility' and proposal.payload->>'visibility' = 'author_only' then 'author_only'
        when proposal.payload ? 'visibility' then 'canon'
        else relation_row.visibility
      end;
      from_entity_id := case when proposal.payload ? 'from_entity_id' or proposal.payload ? 'from_entity' then public.resolve_canon_reconciliation_entity(proposal.book_id, coalesce(proposal.payload->>'from_entity_id', proposal.payload->>'from_entity')) else relation_row.from_entity_id end;
      to_entity_id := case when proposal.payload ? 'to_entity_id' or proposal.payload ? 'to_entity' then public.resolve_canon_reconciliation_entity(proposal.book_id, coalesce(proposal.payload->>'to_entity_id', proposal.payload->>'to_entity')) else relation_row.to_entity_id end;
      relation_type := left(coalesce(nullif(btrim(proposal.payload->>'relation_type'), ''), relation_row.relation_type), 160);
      relation_description := left(coalesce(nullif(proposal.payload->>'description', ''), relation_row.description), 4000);
      if from_entity_id is null or to_entity_id is null or from_entity_id = to_entity_id then raise exception 'Os endpoints da relação são inválidos'; end if;
      update public.universe_relations
         set from_entity_id = from_entity_id,
             to_entity_id = to_entity_id,
             relation_type = relation_type,
             description = relation_description,
             visibility = visibility,
             last_reconciliation_proposal_id = proposal.id
       where id = relation_row.id;
      result := jsonb_build_object('record_type', 'relation', 'relation_id', relation_row.id, 'updated', true);

    elsif proposal.operation = 'merge' then
      survivor_id := public.canon_reconciliation_uuid(coalesce(proposal.payload->>'survivor_id', proposal.target->>'record_id'));
      source_ids := public.canon_reconciliation_uuid_array(proposal.payload, 'source_record_ids');
      if survivor_id is null or cardinality(source_ids) = 0 then raise exception 'A consolidação de relações precisa de survivor_id e source_record_ids'; end if;
      select r.* into relation_row from public.universe_relations r where r.id = survivor_id and r.book_id = proposal.book_id and r.archived_at is null for update;
      if relation_row.id is null then raise exception 'A relação sobrevivente não existe ou pertence a outro livro'; end if;
      source_count := 0;
      foreach source_id in array source_ids loop
        if source_id = survivor_id then continue; end if;
        update public.universe_relations
           set archived_at = now(), last_reconciliation_proposal_id = proposal.id
         where id = source_id and book_id = proposal.book_id and archived_at is null;
        if not found then raise exception 'A relação fonte % não existe ou já foi arquivada', source_id; end if;
        source_count := source_count + 1;
      end loop;
      update public.universe_relations set last_reconciliation_proposal_id = proposal.id where id = survivor_id;
      result := jsonb_build_object('record_type', 'relation', 'relation_id', survivor_id, 'merged_source_count', source_count, 'source_record_ids', to_jsonb(source_ids));

    elsif proposal.operation = 'archive' then
      target_id := public.canon_reconciliation_uuid(coalesce(proposal.target->>'record_id', proposal.target->>'id'));
      if target_id is null then raise exception 'O arquivamento da relação precisa de target.record_id'; end if;
      update public.universe_relations set archived_at = now(), last_reconciliation_proposal_id = proposal.id where id = target_id and book_id = proposal.book_id and archived_at is null;
      if not found then raise exception 'A relação alvo não existe ou já foi arquivada'; end if;
      result := jsonb_build_object('record_type', 'relation', 'relation_id', target_id, 'archived', true);
    else
      raise exception 'A operação % não é válida para relações', proposal.operation;
    end if;

  elsif proposal.proposal_kind = 'event' then
    if proposal.operation in ('create', 'update') then
      event_payload := public.normalize_memory_event_payload(proposal.payload, proposal.title);
      event_title := left(coalesce(nullif(btrim(event_payload->>'title'), ''), proposal.title), 240);
      event_description := left(coalesce(event_payload->>'description', ''), 4000);
      event_kind := case event_payload->>'event_kind'
        when 'action' then 'action'
        when 'revelation' then 'revelation'
        when 'conflict' then 'conflict'
        when 'relationship_change' then 'relationship_change'
        when 'discovery' then 'discovery'
        when 'scene' then 'scene'
        else 'other'
      end;
      narrative_time := left(coalesce(event_payload->>'narrative_time', ''), 240);
      source_kind := case when event_payload->>'source_kind' = 'manuscript' then 'manuscript' else 'author' end;
      source_chapter_id := public.canon_reconciliation_uuid(event_payload->>'source_chapter_id');
      source_version_id := public.canon_reconciliation_uuid(event_payload->>'source_version_id');
      entity_ids := public.canon_reconciliation_entity_ids(proposal.book_id, event_payload);

      if proposal.operation = 'create' then
        insert into public.timeline_events (
          book_id, event_kind, title, description, narrative_time, source_kind,
          source_chapter_id, source_version_id, evidence, visibility, status,
          payload, created_by, updated_by, last_reconciliation_proposal_id
        ) values (
          proposal.book_id, event_kind, event_title, event_description, narrative_time, source_kind,
          source_chapter_id, source_version_id, left(coalesce(event_payload->>'evidence', proposal.evidence), 10000),
          visibility, 'active', event_payload, actor_id, actor_id, proposal.id
        ) returning id into existing_id;
      else
        target_id := public.canon_reconciliation_uuid(coalesce(proposal.target->>'record_id', proposal.target->>'id'));
        if target_id is null then raise exception 'A atualização do evento precisa de target.record_id'; end if;
        select e.* into survivor_event from public.timeline_events e where e.id = target_id and e.book_id = proposal.book_id and e.archived_at is null for update;
        if survivor_event.id is null then raise exception 'O evento alvo não existe ou pertence a outro livro'; end if;
        event_payload := public.normalize_memory_event_payload(
          coalesce(survivor_event.payload, '{}'::jsonb) || proposal.payload,
          coalesce(survivor_event.title, proposal.title)
        );
        event_title := left(coalesce(nullif(btrim(event_payload->>'title'), ''), survivor_event.title, proposal.title), 240);
        entity_ids := public.canon_reconciliation_entity_ids(proposal.book_id, event_payload);
        event_kind := case
          when proposal.payload ? 'event_kind' then event_kind
          else survivor_event.event_kind
        end;
        event_description := left(coalesce(nullif(event_payload->>'description', ''), survivor_event.description), 4000);
        narrative_time := left(coalesce(nullif(event_payload->>'narrative_time', ''), survivor_event.narrative_time), 240);
        source_kind := case
          when proposal.payload ? 'source_kind' and proposal.payload->>'source_kind' = 'manuscript' then 'manuscript'
          when proposal.payload ? 'source_kind' then 'author'
          else survivor_event.source_kind
        end;
        source_chapter_id := case
          when proposal.payload ? 'source_chapter_id' then public.canon_reconciliation_uuid(proposal.payload->>'source_chapter_id')
          else survivor_event.source_chapter_id
        end;
        source_version_id := case
          when proposal.payload ? 'source_version_id' then public.canon_reconciliation_uuid(proposal.payload->>'source_version_id')
          else survivor_event.source_version_id
        end;
        visibility := case
          when proposal.payload ? 'visibility' and proposal.payload->>'visibility' = 'author_only' then 'author_only'
          when proposal.payload ? 'visibility' then 'canon'
          else survivor_event.visibility
        end;
        update public.timeline_events
           set event_kind = event_kind,
               title = event_title,
               description = event_description,
               narrative_time = narrative_time,
               source_kind = source_kind,
               source_chapter_id = source_chapter_id,
               source_version_id = source_version_id,
               evidence = left(coalesce(event_payload->>'evidence', survivor_event.evidence), 10000),
               visibility = visibility,
               payload = event_payload,
               last_reconciliation_proposal_id = proposal.id
         where id = survivor_event.id;
        existing_id := survivor_event.id;
        delete from public.timeline_event_entities where event_id = existing_id;
      end if;

      foreach item_id in array entity_ids loop
        insert into public.timeline_event_entities (event_id, entity_id, role)
        values (existing_id, item_id, 'participant')
        on conflict (event_id, entity_id) do nothing;
      end loop;
      result := jsonb_build_object('record_type', 'event', 'event_id', existing_id, case when proposal.operation = 'create' then 'created' else 'updated' end, true);

    elsif proposal.operation = 'merge' then
      survivor_id := public.canon_reconciliation_uuid(coalesce(proposal.payload->>'survivor_id', proposal.target->>'record_id'));
      source_ids := public.canon_reconciliation_uuid_array(proposal.payload, 'source_record_ids');
      if survivor_id is null or cardinality(source_ids) = 0 then raise exception 'A consolidação de eventos precisa de survivor_id e source_record_ids'; end if;
      select e.* into survivor_event from public.timeline_events e where e.id = survivor_id and e.book_id = proposal.book_id and e.archived_at is null for update;
      if survivor_event.id is null then raise exception 'O evento sobrevivente não existe ou pertence a outro livro'; end if;
      source_count := 0;
      foreach source_id in array source_ids loop
        if source_id = survivor_id then continue; end if;
        select e.* into source_event from public.timeline_events e where e.id = source_id and e.book_id = proposal.book_id and e.archived_at is null for update;
        if source_event.id is null then raise exception 'O evento fonte % não existe ou já foi arquivado', source_id; end if;
        update public.timeline_events survivor
           set description = left(trim(both from concat_ws(chr(10) || chr(10), nullif(survivor.description, ''), nullif(source_event.description, ''))), 4000),
               evidence = left(trim(both from concat_ws(chr(10) || chr(10), nullif(survivor.evidence, ''), nullif(source_event.evidence, ''))), 10000),
               last_reconciliation_proposal_id = proposal.id
         where survivor.id = survivor_id;
        insert into public.timeline_event_entities (event_id, entity_id, role)
        select survivor_id, entity_id, role from public.timeline_event_entities where event_id = source_id
        on conflict (event_id, entity_id) do nothing;
        delete from public.timeline_event_entities where event_id = source_id;
        update public.timeline_events set status = 'superseded', archived_at = now(), last_reconciliation_proposal_id = proposal.id where id = source_id;
        source_count := source_count + 1;
      end loop;
      update public.timeline_events set last_reconciliation_proposal_id = proposal.id where id = survivor_id;
      result := jsonb_build_object('record_type', 'event', 'event_id', survivor_id, 'merged_source_count', source_count, 'source_record_ids', to_jsonb(source_ids));

    elsif proposal.operation = 'archive' then
      target_id := public.canon_reconciliation_uuid(coalesce(proposal.target->>'record_id', proposal.target->>'id'));
      if target_id is null then raise exception 'O arquivamento do evento precisa de target.record_id'; end if;
      update public.timeline_events set status = 'archived', archived_at = now(), last_reconciliation_proposal_id = proposal.id where id = target_id and book_id = proposal.book_id and archived_at is null;
      if not found then raise exception 'O evento alvo não existe ou já foi arquivado'; end if;
      result := jsonb_build_object('record_type', 'event', 'event_id', target_id, 'archived', true);
    else
      raise exception 'A operação % não é válida para eventos', proposal.operation;
    end if;

  elsif proposal.proposal_kind = 'open_thread' then
    if proposal.operation in ('create', 'update', 'resolve') then
      thread_title := left(nullif(btrim(coalesce(proposal.payload->>'title', proposal.title)), ''), 240);
      if thread_title is null then raise exception 'A trama aberta precisa de um título'; end if;
      thread_description := left(coalesce(proposal.payload->>'description', ''), 4000);
      thread_status := case proposal.payload->>'status'
        when 'open' then 'open'
        when 'in_progress' then 'in_progress'
        when 'resolved' then 'resolved'
        when 'abandoned' then 'abandoned'
        when 'contradicted' then 'contradicted'
        else 'open'
      end;
      if proposal.operation = 'resolve' then thread_status := 'resolved'; end if;
      thread_priority := case proposal.payload->>'priority' when 'low' then 'low' when 'high' then 'high' else 'normal' end;
      source_kind := case when proposal.payload->>'source_kind' = 'manuscript' then 'manuscript' else 'author' end;
      source_chapter_id := public.canon_reconciliation_uuid(proposal.payload->>'source_chapter_id');
      source_version_id := public.canon_reconciliation_uuid(proposal.payload->>'source_version_id');
      entity_ids := public.canon_reconciliation_entity_ids(proposal.book_id, proposal.payload);

      if proposal.operation = 'create' then
        insert into public.open_threads (
          book_id, title, description, status, priority, source_kind,
          source_chapter_id, source_version_id, evidence, visibility,
          created_by, updated_by, last_reconciliation_proposal_id
        ) values (
          proposal.book_id, thread_title, thread_description, thread_status, thread_priority, source_kind,
          source_chapter_id, source_version_id, left(coalesce(proposal.payload->>'evidence', proposal.evidence), 10000),
          visibility, actor_id, actor_id, proposal.id
        ) returning id into existing_id;
      else
        target_id := public.canon_reconciliation_uuid(coalesce(proposal.target->>'record_id', proposal.target->>'id'));
        if target_id is null then raise exception 'A atualização da trama precisa de target.record_id'; end if;
        select t.* into survivor_thread from public.open_threads t where t.id = target_id and t.book_id = proposal.book_id and t.archived_at is null for update;
        if survivor_thread.id is null then raise exception 'A trama alvo não existe ou pertence a outro livro'; end if;
        thread_title := left(coalesce(nullif(btrim(proposal.payload->>'title'), ''), survivor_thread.title), 240);
        if not (proposal.payload ? 'status') and proposal.operation <> 'resolve' then
          thread_status := survivor_thread.status;
        end if;
        thread_description := left(coalesce(nullif(proposal.payload->>'description', ''), survivor_thread.description), 4000);
        thread_priority := case
          when proposal.payload ? 'priority' and proposal.payload->>'priority' = 'low' then 'low'
          when proposal.payload ? 'priority' and proposal.payload->>'priority' = 'high' then 'high'
          when proposal.payload ? 'priority' then 'normal'
          else survivor_thread.priority
        end;
        source_kind := case
          when proposal.payload ? 'source_kind' and proposal.payload->>'source_kind' = 'manuscript' then 'manuscript'
          when proposal.payload ? 'source_kind' then 'author'
          else survivor_thread.source_kind
        end;
        source_chapter_id := case
          when proposal.payload ? 'source_chapter_id' then public.canon_reconciliation_uuid(proposal.payload->>'source_chapter_id')
          else survivor_thread.source_chapter_id
        end;
        source_version_id := case
          when proposal.payload ? 'source_version_id' then public.canon_reconciliation_uuid(proposal.payload->>'source_version_id')
          else survivor_thread.source_version_id
        end;
        visibility := case
          when proposal.payload ? 'visibility' and proposal.payload->>'visibility' = 'author_only' then 'author_only'
          when proposal.payload ? 'visibility' then 'canon'
          else survivor_thread.visibility
        end;
        update public.open_threads
           set title = thread_title,
               description = thread_description,
               status = thread_status,
               priority = thread_priority,
               source_kind = source_kind,
               source_chapter_id = source_chapter_id,
               source_version_id = source_version_id,
               evidence = left(coalesce(proposal.payload->>'evidence', survivor_thread.evidence), 10000),
               visibility = visibility,
               last_reconciliation_proposal_id = proposal.id
         where id = survivor_thread.id;
        existing_id := survivor_thread.id;
        delete from public.open_thread_entities where thread_id = existing_id;
      end if;
      foreach item_id in array entity_ids loop
        insert into public.open_thread_entities (thread_id, entity_id, role)
        values (existing_id, item_id, 'related')
        on conflict (thread_id, entity_id) do nothing;
      end loop;
      result := jsonb_build_object('record_type', 'open_thread', 'thread_id', existing_id, case when proposal.operation = 'create' then 'created' else 'updated' end, true);

    elsif proposal.operation = 'merge' then
      survivor_id := public.canon_reconciliation_uuid(coalesce(proposal.payload->>'survivor_id', proposal.target->>'record_id'));
      source_ids := public.canon_reconciliation_uuid_array(proposal.payload, 'source_record_ids');
      if survivor_id is null or cardinality(source_ids) = 0 then raise exception 'A consolidação de tramas precisa de survivor_id e source_record_ids'; end if;
      select t.* into survivor_thread from public.open_threads t where t.id = survivor_id and t.book_id = proposal.book_id and t.archived_at is null for update;
      if survivor_thread.id is null then raise exception 'A trama sobrevivente não existe ou pertence a outro livro'; end if;
      source_count := 0;
      foreach source_id in array source_ids loop
        if source_id = survivor_id then continue; end if;
        select t.* into source_thread from public.open_threads t where t.id = source_id and t.book_id = proposal.book_id and t.archived_at is null for update;
        if source_thread.id is null then raise exception 'A trama fonte % não existe ou já foi arquivada', source_id; end if;
        update public.open_threads survivor
           set description = left(trim(both from concat_ws(chr(10) || chr(10), nullif(survivor.description, ''), nullif(source_thread.description, ''))), 4000),
               evidence = left(trim(both from concat_ws(chr(10) || chr(10), nullif(survivor.evidence, ''), nullif(source_thread.evidence, ''))), 10000),
               last_reconciliation_proposal_id = proposal.id
         where survivor.id = survivor_id;
        insert into public.open_thread_entities (thread_id, entity_id, role)
        select survivor_id, entity_id, role from public.open_thread_entities where thread_id = source_id
        on conflict (thread_id, entity_id) do nothing;
        delete from public.open_thread_entities where thread_id = source_id;
        update public.open_threads set archived_at = now(), last_reconciliation_proposal_id = proposal.id where id = source_id;
        source_count := source_count + 1;
      end loop;
      update public.open_threads set last_reconciliation_proposal_id = proposal.id where id = survivor_id;
      result := jsonb_build_object('record_type', 'open_thread', 'thread_id', survivor_id, 'merged_source_count', source_count, 'source_record_ids', to_jsonb(source_ids));

    elsif proposal.operation = 'archive' then
      target_id := public.canon_reconciliation_uuid(coalesce(proposal.target->>'record_id', proposal.target->>'id'));
      if target_id is null then raise exception 'O arquivamento da trama precisa de target.record_id'; end if;
      update public.open_threads set archived_at = now(), last_reconciliation_proposal_id = proposal.id where id = target_id and book_id = proposal.book_id and archived_at is null;
      if not found then raise exception 'A trama alvo não existe ou já foi arquivada'; end if;
      result := jsonb_build_object('record_type', 'open_thread', 'thread_id', target_id, 'archived', true);
    else
      raise exception 'A operação % não é válida para tramas abertas', proposal.operation;
    end if;
  else
    raise exception 'Tipo de proposta de reconciliação inválido';
  end if;

  update public.canon_reconciliation_proposals
     set status = 'applied',
         applied_by = actor_id,
         applied_at = now(),
         apply_note = applied_note,
         applied_records = jsonb_build_array(result)
   where id = proposal.id and status = 'approved';

  if not found then
    raise exception 'A proposta mudou de estado antes da aplicação';
  end if;

  return result || jsonb_build_object(
    'proposal_id', proposal.id,
    'status', 'applied',
    'already_applied', false
  );
end;
$$;

create or replace function public.apply_approved_canon_reconciliation(
  target_book_id uuid,
  requested_apply_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  proposal_id uuid;
  result jsonb;
  results jsonb := '[]'::jsonb;
  applied_count integer := 0;
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'É necessário estar autenticado para aplicar propostas';
  end if;
  if not public.is_book_member(target_book_id) then
    raise exception 'Livro não encontrado ou acesso negado';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_book_id::text, 2));

  for proposal_id in
    select p.id
      from public.canon_reconciliation_proposals p
     where p.book_id = target_book_id
       and p.status = 'approved'
     order by p.created_at, p.id
     for update
  loop
    result := public.apply_canon_reconciliation_proposal(proposal_id, requested_apply_note);
    results := results || jsonb_build_array(result);
    applied_count := applied_count + 1;
  end loop;

  return jsonb_build_object(
    'book_id', target_book_id,
    'status', 'completed',
    'applied_count', applied_count,
    'results', results
  );
end;
$$;

-- A revisão e a aplicação passam a usar RPCs SECURITY DEFINER com validação
-- explícita. Isso evita que o cliente altere status, applied_records ou
-- proveniência diretamente via PostgREST.
revoke execute on function public.resolve_canon_reconciliation_entity(uuid, text) from public;
revoke execute on function public.canon_reconciliation_uuid_array(jsonb, text) from public;
revoke execute on function public.canon_reconciliation_entity_ids(uuid, jsonb) from public;
revoke execute on function public.review_canon_reconciliation_proposal(uuid, text, text, jsonb, text) from public;
revoke execute on function public.apply_canon_reconciliation_proposal(uuid, text) from public;
revoke execute on function public.apply_approved_canon_reconciliation(uuid, text) from public;
revoke update on public.canon_reconciliation_proposals from authenticated;
revoke update on public.canon_reconciliation_runs from authenticated;

grant execute on function public.canon_reconciliation_uuid(text) to authenticated;
grant execute on function public.resolve_canon_reconciliation_entity(uuid, text) to authenticated;
grant execute on function public.canon_reconciliation_uuid_array(jsonb, text) to authenticated;
grant execute on function public.canon_reconciliation_entity_ids(uuid, jsonb) to authenticated;
grant execute on function public.review_canon_reconciliation_proposal(uuid, text, text, jsonb, text) to authenticated;
grant execute on function public.apply_canon_reconciliation_proposal(uuid, text) to authenticated;
grant execute on function public.apply_approved_canon_reconciliation(uuid, text) to authenticated;

comment on column public.canon_reconciliation_proposals.applied_records is
  'Registros canônicos efetivamente afetados pela aplicação humana da proposta.';
comment on column public.universe_entities.last_reconciliation_proposal_id is
  'Última proposta de reconciliação humana que afetou esta entidade.';
comment on column public.canon_facts.last_reconciliation_proposal_id is
  'Última proposta de reconciliação humana que afetou este fato.';
comment on column public.universe_relations.last_reconciliation_proposal_id is
  'Última proposta de reconciliação humana que afetou esta relação.';
comment on column public.timeline_events.last_reconciliation_proposal_id is
  'Última proposta de reconciliação humana que afetou este evento.';
comment on column public.open_threads.last_reconciliation_proposal_id is
  'Última proposta de reconciliação humana que afetou esta trama.';

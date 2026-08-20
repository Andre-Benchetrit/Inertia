-- Migration 0020: sincronizar campos visíveis de eventos com o payload canônico
--
-- Alguns eventos já possuem o JSON completo em timeline_events.payload, mas as
-- colunas usadas pelo card e pelo formulário ficaram vazias na aprovação antiga.
-- Esta migration recompõe somente os campos estruturados do mesmo registro; não
-- cria eventos, não duplica propostas e não altera a fonte da obra.

with normalized_events as (
  select
    event_row.id,
    public.normalize_memory_event_payload(event_row.payload, event_row.title) as normalized_payload
  from public.timeline_events as event_row
  where jsonb_typeof(event_row.payload) = 'object'
    and event_row.payload <> '{}'::jsonb
)
update public.timeline_events as event_row
   set event_kind = case normalized_events.normalized_payload->>'event_kind'
       when 'action' then 'action'
       when 'revelation' then 'revelation'
       when 'conflict' then 'conflict'
       when 'relationship_change' then 'relationship_change'
       when 'discovery' then 'discovery'
       when 'scene' then 'scene'
       else coalesce(event_row.event_kind, 'other')
     end,
       title = coalesce(
         nullif(left(btrim(normalized_events.normalized_payload->>'title'), 240), ''),
         event_row.title
       ),
       description = coalesce(
         nullif(left(normalized_events.normalized_payload->>'description', 4000), ''),
         event_row.description,
         ''
       ),
       narrative_time = coalesce(
         nullif(left(normalized_events.normalized_payload->>'narrative_time', 240), ''),
         event_row.narrative_time,
         ''
       ),
       payload = normalized_events.normalized_payload,
       updated_by = coalesce(event_row.updated_by, event_row.created_by),
       updated_at = now()
  from normalized_events
 where event_row.id = normalized_events.id;

-- A RPC de aprovação deve sempre preencher as colunas estruturadas a partir do
-- mesmo payload que grava no campo JSON. O alias e v_visibility evitam que
-- nomes de variáveis PL/pgSQL colidam com colunas das tabelas.
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
  event_payload jsonb;
  result jsonb;
  v_entity_id uuid;
  v_existing_entity_id uuid;
  v_from_entity_id uuid;
  v_to_entity_id uuid;
  v_existing_relation_id uuid;
  v_fact_id uuid;
  v_relation_id uuid;
  v_event_id uuid;
  v_existing_event_id uuid;
  v_thread_id uuid;
  candidate_name text;
  entity_name text;
  entity_type text;
  v_title text;
  summary text;
  statement text;
  relation_type text;
  v_description text;
  v_visibility text;
  aliases text[];
  attributes jsonb;
  v_event_kind text;
  v_narrative_time text;
  thread_status text;
  priority text;
begin
  select p.*
    into proposal
    from public.memory_proposals as p
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

  v_visibility := case
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

    v_existing_entity_id := public.resolve_memory_entity(proposal.book_id, entity_name);
    if v_existing_entity_id is not null then
      v_entity_id := v_existing_entity_id;
    else
      insert into public.universe_entities (
        book_id, name, entity_type, summary, aliases, attributes,
        visibility, created_by, updated_by
      ) values (
        proposal.book_id, entity_name, entity_type, summary, aliases, attributes,
        v_visibility, coalesce(auth.uid(), proposal.created_by),
        coalesce(auth.uid(), proposal.created_by)
      )
      returning id into v_entity_id;
    end if;

    result := jsonb_build_object('entity_id', v_entity_id, 'created', v_existing_entity_id is null);

  elsif proposal.proposal_kind = 'fact' then
    statement := nullif(btrim(payload->>'statement'), '');
    if statement is null then
      raise exception 'O fato precisa ter uma afirmação';
    end if;
    candidate_name := nullif(btrim(payload->>'entity_name'), '');
    v_entity_id := public.resolve_memory_entity(proposal.book_id, candidate_name);

    insert into public.canon_facts (
      book_id, entity_id, statement, source_kind, source_chapter_id,
      source_version_id, evidence, visibility, status, created_by, updated_by
    ) values (
      proposal.book_id, v_entity_id, left(statement, 4000), 'manuscript',
      proposal.chapter_id, proposal.version_id, left(proposal.evidence, 10000),
      v_visibility, 'active', coalesce(auth.uid(), proposal.created_by),
      coalesce(auth.uid(), proposal.created_by)
    )
    returning id into v_fact_id;

    result := jsonb_build_object('fact_id', v_fact_id, 'entity_id', v_entity_id, 'created', true);

  elsif proposal.proposal_kind = 'relation' then
    candidate_name := nullif(btrim(payload->>'from_entity'), '');
    v_from_entity_id := public.resolve_memory_entity(proposal.book_id, candidate_name);
    candidate_name := nullif(btrim(payload->>'to_entity'), '');
    v_to_entity_id := public.resolve_memory_entity(proposal.book_id, candidate_name);
    relation_type := nullif(btrim(payload->>'relation_type'), '');
    v_description := left(coalesce(payload->>'description', ''), 4000);

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
      into v_existing_relation_id
      from public.universe_relations as r
     where r.book_id = proposal.book_id
       and r.from_entity_id = v_from_entity_id
       and r.to_entity_id = v_to_entity_id
       and lower(r.relation_type) = lower(relation_type)
       and r.archived_at is null
     limit 1;

    if v_existing_relation_id is not null then
      v_relation_id := v_existing_relation_id;
    else
      insert into public.universe_relations (
        book_id, from_entity_id, to_entity_id, relation_type, description,
        source_kind, source_chapter_id, source_version_id, visibility,
        created_by, updated_by
      ) values (
        proposal.book_id, v_from_entity_id, v_to_entity_id, left(relation_type, 160),
        v_description, 'manuscript', proposal.chapter_id, proposal.version_id,
        v_visibility, coalesce(auth.uid(), proposal.created_by),
        coalesce(auth.uid(), proposal.created_by)
      )
      returning id into v_relation_id;
    end if;

    result := jsonb_build_object('relation_id', v_relation_id, 'created', v_existing_relation_id is null);

  elsif proposal.proposal_kind = 'event' then
    event_payload := public.normalize_memory_event_payload(payload, proposal.title);
    v_title := nullif(btrim(event_payload->>'title'), '');
    if v_title is null then
      raise exception 'O evento precisa ter um título';
    end if;

    v_event_kind := event_payload->>'event_kind';
    v_description := left(coalesce(event_payload->>'description', ''), 4000);
    v_narrative_time := left(coalesce(event_payload->>'narrative_time', ''), 240);

    if jsonb_typeof(proposal.approved_records) = 'array' then
      select (record->>'event_id')::uuid
        into v_existing_event_id
        from jsonb_array_elements(proposal.approved_records) as record
       where record->>'event_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       limit 1;
    end if;

    if v_existing_event_id is not null and exists (
      select 1
        from public.timeline_events as existing_event
       where existing_event.id = v_existing_event_id
         and existing_event.book_id = proposal.book_id
    ) then
      v_event_id := v_existing_event_id;
      update public.timeline_events as event_row
         set event_kind = v_event_kind,
             title = left(v_title, 240),
             description = v_description,
             narrative_time = v_narrative_time,
             payload = event_payload,
             source_kind = 'manuscript',
             source_chapter_id = proposal.chapter_id,
             source_version_id = proposal.version_id,
             evidence = left(proposal.evidence, 10000),
             visibility = v_visibility,
             status = 'active',
             archived_at = null,
             updated_by = coalesce(auth.uid(), event_row.updated_by, event_row.created_by),
             updated_at = now()
       where event_row.id = v_event_id;
      delete from public.timeline_event_entities as event_entity
       where event_entity.event_id = v_event_id;
    else
      insert into public.timeline_events (
        book_id, event_kind, title, description, narrative_time, payload,
        source_kind, source_chapter_id, source_version_id, evidence, visibility,
        status, created_by, updated_by
      ) values (
        proposal.book_id, v_event_kind, left(v_title, 240), v_description, v_narrative_time,
        event_payload, 'manuscript', proposal.chapter_id, proposal.version_id,
        left(proposal.evidence, 10000), v_visibility, 'active',
        coalesce(auth.uid(), proposal.created_by), coalesce(auth.uid(), proposal.created_by)
      )
      returning id into v_event_id;
    end if;

    if jsonb_typeof(event_payload->'entities_involved') = 'array' then
      for candidate_name in
        select value from jsonb_array_elements_text(event_payload->'entities_involved') as value
      loop
        v_entity_id := public.resolve_memory_entity(proposal.book_id, candidate_name);
        if v_entity_id is not null then
          insert into public.timeline_event_entities (event_id, entity_id)
          values (v_event_id, v_entity_id)
          on conflict (event_id, entity_id) do nothing;
        end if;
      end loop;
    end if;

    result := jsonb_build_object(
      'event_id', v_event_id,
      'created', v_existing_event_id is null,
      'updated_existing', v_existing_event_id is not null
    );

  elsif proposal.proposal_kind = 'open_thread' then
    v_title := nullif(btrim(coalesce(payload->>'title', proposal.title)), '');
    if v_title is null then
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
    v_description := left(coalesce(payload->>'description', ''), 4000);

    insert into public.open_threads (
      book_id, title, description, status, priority, source_kind,
      source_chapter_id, source_version_id, evidence, visibility,
      created_by, updated_by
    ) values (
      proposal.book_id, left(v_title, 240), v_description, thread_status, priority,
      'manuscript', proposal.chapter_id, proposal.version_id,
      left(proposal.evidence, 10000), v_visibility,
      coalesce(auth.uid(), proposal.created_by), coalesce(auth.uid(), proposal.created_by)
    )
    returning id into v_thread_id;

    if jsonb_typeof(payload->'entities_involved') = 'array' then
      for candidate_name in
        select value from jsonb_array_elements_text(payload->'entities_involved') as value
      loop
        v_entity_id := public.resolve_memory_entity(proposal.book_id, candidate_name);
        if v_entity_id is not null then
          insert into public.open_thread_entities (thread_id, entity_id)
          values (v_thread_id, v_entity_id)
          on conflict (thread_id, entity_id) do nothing;
        end if;
      end loop;
    end if;

    result := jsonb_build_object('thread_id', v_thread_id, 'created', true);

  else
    raise exception 'Tipo de proposta não suportado';
  end if;

  update public.memory_proposals as proposal_row
     set status = 'approved',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         approved_records = jsonb_build_array(result),
         review_note = case
           when edited_payload is null then proposal_row.review_note
           else 'Payload editado pelos autores durante a aprovação.'
         end
   where proposal_row.id = proposal.id;

  return result || jsonb_build_object(
    'proposal_id', proposal.id,
    'status', 'approved',
    'already_approved', false
  );
end;
$$;

grant execute on function public.approve_memory_proposal(uuid, jsonb) to authenticated;

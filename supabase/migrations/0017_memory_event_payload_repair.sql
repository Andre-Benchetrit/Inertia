-- Sprint 3G.1 — preservação completa e reparo de eventos aprovados.
--
-- A migration 0016 já criou os eventos, mas a RPC original só copiava alguns
-- campos do payload. Esta migration é aditiva e corrige a persistência sem
-- apagar o histórico nem duplicar eventos já aprovados.

alter table public.timeline_events
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table public.timeline_events
  drop constraint if exists timeline_events_payload_object_check;

alter table public.timeline_events
  add constraint timeline_events_payload_object_check
  check (jsonb_typeof(payload) = 'object');

-- A migration pode ser executada pelo SQL Editor, onde auth.uid() é NULL.
-- O trigger original da 0016 sobrescrevia updated_by com NULL em qualquer
-- UPDATE, quebrando registros legados. Em uma sessão autenticada, o usuário
-- atual continua prevalecendo; fora dela, preservamos o valor existente ou o
-- autor original do registro.
create or replace function public.set_narrative_updated_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_by = coalesce(auth.uid(), new.updated_by, old.updated_by, old.created_by);
  new.updated_at = now();
  return new;
end;
$$;

-- Registros antigos recebem uma representação mínima. Eventos aprovados por
-- proposta serão reconstruídos com o payload original durante a reapertura.
update public.timeline_events
   set payload = jsonb_build_object(
     'title', title,
     'description', description,
     'event_kind', event_kind,
     'narrative_time', narrative_time,
     'entities_involved', '[]'::jsonb,
     'source_kind', source_kind
   )
 where payload = '{}'::jsonb;

create or replace function public.normalize_memory_event_payload(
  raw_payload jsonb,
  fallback_title text default ''
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized jsonb;
  nested_event jsonb;
  title text;
  description text;
  event_kind text;
  narrative_time text;
  entities_involved jsonb;
begin
  normalized := case
    when jsonb_typeof(raw_payload) = 'object' then raw_payload
    else '{}'::jsonb
  end;

  -- Aceita tanto o contrato atual, com campos no topo, quanto respostas mais
  -- antigas que envolveram os dados em payload.event.
  if jsonb_typeof(normalized->'event') = 'object' then
    nested_event := normalized->'event';
    normalized := nested_event || normalized;
  end if;

  title := nullif(
    btrim(coalesce(
      nullif(normalized->>'title', ''),
      nullif(normalized->>'event_title', ''),
      nullif(normalized->>'name', ''),
      nullif(fallback_title, '')
    )),
    ''
  );

  description := left(coalesce(
    nullif(normalized->>'description', ''),
    nullif(normalized->>'what_happened', ''),
    nullif(normalized->>'event_description', ''),
    nullif(normalized->>'summary', ''),
    nullif(normalized->>'details', ''),
    ''
  ), 4000);

  event_kind := case lower(coalesce(
    nullif(normalized->>'event_kind', ''),
    nullif(normalized->>'kind', ''),
    nullif(normalized->>'type', ''),
    'other'
  ))
    when 'action' then 'action'
    when 'revelation' then 'revelation'
    when 'conflict' then 'conflict'
    when 'relationship_change' then 'relationship_change'
    when 'relationship change' then 'relationship_change'
    when 'discovery' then 'discovery'
    when 'scene' then 'scene'
    else 'other'
  end;

  narrative_time := left(coalesce(
    nullif(normalized->>'narrative_time', ''),
    nullif(normalized->>'time', ''),
    nullif(normalized->>'when', ''),
    ''
  ), 240);

  entities_involved := case
    when jsonb_typeof(normalized->'entities_involved') = 'array'
      then normalized->'entities_involved'
    when jsonb_typeof(normalized->'entities') = 'array'
      then normalized->'entities'
    when jsonb_typeof(normalized->'participants') = 'array'
      then normalized->'participants'
    else '[]'::jsonb
  end;

  return normalized || jsonb_build_object(
    'title', coalesce(title, ''),
    'description', description,
    'event_kind', event_kind,
    'narrative_time', narrative_time,
    'entities_involved', entities_involved,
    'source_kind', coalesce(nullif(normalized->>'source_kind', ''), 'memory_analysis')
  );
end;
$$;

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
  entity_id uuid;
  existing_entity_id uuid;
  v_from_entity_id uuid;
  v_to_entity_id uuid;
  existing_relation_id uuid;
  fact_id uuid;
  relation_id uuid;
  event_id uuid;
  existing_event_id uuid;
  thread_id uuid;
  candidate_name text;
  entity_name text;
  entity_type text;
  v_title text;
  summary text;
  statement text;
  relation_type text;
  v_description text;
  visibility text;
  aliases text[];
  attributes jsonb;
  v_event_kind text;
  v_narrative_time text;
  thread_status text;
  priority text;
  approved_record jsonb;
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
        v_description, 'manuscript', proposal.chapter_id, proposal.version_id,
        visibility, auth.uid(), auth.uid()
      )
      returning id into relation_id;
    end if;

    result := jsonb_build_object(
      'relation_id', relation_id,
      'created', existing_relation_id is null
    );

  elsif proposal.proposal_kind = 'event' then
    event_payload := public.normalize_memory_event_payload(payload, proposal.title);
    v_title := nullif(btrim(event_payload->>'title'), '');
    if v_title is null then
      raise exception 'O evento precisa ter um título';
    end if;

    v_event_kind := event_payload->>'event_kind';
    v_description := left(coalesce(event_payload->>'description', ''), 4000);
    v_narrative_time := left(coalesce(event_payload->>'narrative_time', ''), 240);

    -- Se a proposta foi reaberta, reutilizamos o evento original em vez de
    -- criar uma segunda linha canônica para a mesma decisão editorial.
    if jsonb_typeof(proposal.approved_records) = 'array' then
      select (record->>'event_id')::uuid
        into existing_event_id
        from jsonb_array_elements(proposal.approved_records) as record
       where record->>'event_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       limit 1;
    end if;

    if existing_event_id is not null and exists (
      select 1
        from public.timeline_events e
       where e.id = existing_event_id
         and e.book_id = proposal.book_id
    ) then
      event_id := existing_event_id;
      update public.timeline_events e
         set event_kind = v_event_kind,
             title = left(v_title, 240),
             description = v_description,
             narrative_time = v_narrative_time,
             payload = event_payload,
             source_kind = 'manuscript',
             source_chapter_id = proposal.chapter_id,
             source_version_id = proposal.version_id,
             evidence = left(proposal.evidence, 10000),
             visibility = visibility,
             status = 'active',
             archived_at = null,
             updated_by = auth.uid(),
             updated_at = now()
       where e.id = event_id;
      delete from public.timeline_event_entities tee
       where tee.event_id = event_id;
    else
      insert into public.timeline_events (
        book_id, event_kind, title, description, narrative_time, payload,
        source_kind, source_chapter_id, source_version_id, evidence, visibility,
        status, created_by, updated_by
      ) values (
        proposal.book_id, v_event_kind, left(v_title, 240), v_description, v_narrative_time,
        event_payload, 'manuscript', proposal.chapter_id, proposal.version_id,
        left(proposal.evidence, 10000), visibility, 'active', auth.uid(), auth.uid()
      )
      returning id into event_id;
    end if;

    if jsonb_typeof(event_payload->'entities_involved') = 'array' then
      for candidate_name in
        select value from jsonb_array_elements_text(event_payload->'entities_involved') as value
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
      'created', existing_event_id is null,
      'updated_existing', existing_event_id is not null,
      'unresolved_entity_names', coalesce(
        (
          select jsonb_agg(value)
            from jsonb_array_elements_text(coalesce(event_payload->'entities_involved', '[]'::jsonb)) as value
           where public.resolve_memory_entity(proposal.book_id, value) is null
        ),
        '[]'::jsonb
      )
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

create or replace function public.reopen_memory_event_for_approval(
  target_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.timeline_events;
  proposal public.memory_proposals;
begin
  select e.*
    into event_row
    from public.timeline_events e
   where e.id = target_event_id
     and public.is_book_member(e.book_id)
   for update;

  if event_row.id is null then
    raise exception 'Evento não encontrado ou acesso negado';
  end if;

  select p.*
    into proposal
    from public.memory_proposals p
   where p.book_id = event_row.book_id
     and p.proposal_kind = 'event'
     and p.status = 'approved'
     and exists (
       select 1
         from jsonb_array_elements(coalesce(p.approved_records, '[]'::jsonb)) as record
        where record->>'event_id' = target_event_id::text
     )
   order by p.reviewed_at desc nulls last, p.created_at desc
   limit 1
   for update;

  if proposal.id is null then
    raise exception 'Não foi encontrada uma proposta aprovada vinculada a este evento';
  end if;

  update public.timeline_events
     set status = 'active',
         archived_at = null,
         updated_by = auth.uid(),
         updated_at = now()
   where id = target_event_id;

  update public.memory_proposals
     set status = 'pending',
         reviewed_by = null,
         reviewed_at = null,
         review_note = left(
           case
             when nullif(review_note, '') is null then
               'Reaberta pelos autores para corrigir e aprovar novamente.'
             else
               review_note || E'\nReaberta pelos autores para corrigir e aprovar novamente.'
           end,
           4000
         )
   where id = proposal.id;

  return jsonb_build_object(
    'event_id', target_event_id,
    'proposal_id', proposal.id,
    'status', 'pending',
    'reopened', true
  );
end;
$$;

grant execute on function public.normalize_memory_event_payload(jsonb, text) to authenticated;
grant execute on function public.approve_memory_proposal(uuid, jsonb) to authenticated;
grant execute on function public.reopen_memory_event_for_approval(uuid) to authenticated;

comment on column public.timeline_events.payload is
  'Payload JSON completo aprovado pelos autores, além dos campos canônicos indexáveis.';
comment on function public.reopen_memory_event_for_approval(uuid) is
  'Desarquiva um evento aprovado e reabre sua proposta vinculada para nova aprovação, sem criar duplicata.';

-- Sprint 3D: decisão humana sobre propostas de memória.
-- Nenhuma proposta pendente entra no Universo. A aprovação abaixo é a única
-- operação que transforma uma proposta em registro canônico.

alter table public.memory_proposals
  add column if not exists approved_records jsonb not null default '[]'::jsonb;

alter table public.memory_proposals
  drop constraint if exists memory_proposals_approved_records_object_check;

alter table public.memory_proposals
  add constraint memory_proposals_approved_records_array_check
  check (jsonb_typeof(approved_records) = 'array');

create or replace function public.resolve_memory_entity(
  target_book_id uuid,
  candidate_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
begin
  if nullif(btrim(coalesce(candidate_name, '')), '') is null then
    return null;
  end if;

  select e.id
    into result_id
    from public.universe_entities e
   where e.book_id = target_book_id
     and e.archived_at is null
     and (
       lower(e.name) = lower(btrim(candidate_name))
       or exists (
         select 1
           from unnest(e.aliases) alias
          where lower(alias) = lower(btrim(candidate_name))
       )
     )
   order by e.created_at
   limit 1;

  return result_id;
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
  result jsonb;
  entity_id uuid;
  existing_entity_id uuid;
  v_from_entity_id uuid;
  v_to_entity_id uuid;
  existing_relation_id uuid;
  fact_id uuid;
  relation_id uuid;
  candidate_name text;
  entity_name text;
  entity_type text;
  summary text;
  statement text;
  relation_type text;
  description text;
  visibility text;
  aliases text[];
  attributes jsonb;
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

create or replace function public.reject_memory_proposal(
  target_proposal_id uuid,
  review_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal public.memory_proposals;
  clean_note text;
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

  if proposal.status = 'rejected' then
    return jsonb_build_object(
      'proposal_id', proposal.id,
      'status', proposal.status,
      'already_rejected', true
    );
  end if;

  if proposal.status <> 'pending' then
    raise exception 'Somente propostas pendentes podem ser ignoradas';
  end if;

  clean_note := left(coalesce(review_note, ''), 4000);
  update public.memory_proposals
     set status = 'rejected',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = clean_note
   where id = proposal.id;

  return jsonb_build_object(
    'proposal_id', proposal.id,
    'status', 'rejected',
    'already_rejected', false
  );
end;
$$;

grant execute on function public.resolve_memory_entity(uuid, text) to authenticated;
grant execute on function public.approve_memory_proposal(uuid, jsonb) to authenticated;
grant execute on function public.reject_memory_proposal(uuid, text) to authenticated;

comment on function public.approve_memory_proposal(uuid, jsonb) is
  'Aprova uma proposta de memória e cria seu registro canônico em uma transação atômica.';
comment on function public.reject_memory_proposal(uuid, text) is
  'Rejeita uma proposta de memória sem criar registros no Universo.';

-- A coluna é estruturalmente um array de referências ao(s) registro(s) criado(s).
-- A aprovação idempotente consulta esse histórico e nunca duplica o cânone.';

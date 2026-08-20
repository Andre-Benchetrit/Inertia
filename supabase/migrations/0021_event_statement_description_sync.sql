-- Migration 0021: sincroniza propostas de evento que usam `statement`.
-- O extractor pode descrever um evento como um fato explícito, usando `statement`.
-- No cânone, esse conteúdo deve ocupar timeline_events.description.

begin;

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
  nested_payload jsonb := '{}'::jsonb;
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

  -- Compatibilidade com propostas antigas que envolviam o evento em payload
  -- ou event, sem descartar os campos originais do JSON.
  if jsonb_typeof(normalized->'payload') = 'object' then
    nested_payload := normalized->'payload';
  elsif jsonb_typeof(normalized->'event') = 'object' then
    nested_payload := normalized->'event';
  end if;

  title := nullif(
    btrim(coalesce(
      nullif(normalized->>'title', ''),
      nullif(nested_payload->>'title', ''),
      nullif(normalized->>'event_title', ''),
      nullif(nested_payload->>'event_title', ''),
      nullif(normalized->>'name', ''),
      nullif(nested_payload->>'name', ''),
      nullif(fallback_title, '')
    )),
    ''
  );

  description := left(coalesce(
    nullif(normalized->>'description', ''),
    nullif(nested_payload->>'description', ''),
    nullif(normalized->>'statement', ''),
    nullif(nested_payload->>'statement', ''),
    nullif(normalized->>'what_happened', ''),
    nullif(nested_payload->>'what_happened', ''),
    nullif(normalized->>'event_description', ''),
    nullif(nested_payload->>'event_description', ''),
    nullif(normalized->>'summary', ''),
    nullif(nested_payload->>'summary', ''),
    nullif(normalized->>'details', ''),
    nullif(nested_payload->>'details', ''),
    ''
  ), 4000);

  event_kind := case lower(coalesce(
    nullif(normalized->>'event_kind', ''),
    nullif(nested_payload->>'event_kind', ''),
    nullif(normalized->>'kind', ''),
    nullif(nested_payload->>'kind', ''),
    nullif(normalized->>'type', ''),
    nullif(nested_payload->>'type', ''),
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
    nullif(nested_payload->>'narrative_time', ''),
    nullif(normalized->>'time', ''),
    nullif(nested_payload->>'time', ''),
    nullif(normalized->>'when', ''),
    nullif(nested_payload->>'when', ''),
    ''
  ), 240);

  entities_involved := case
    when jsonb_typeof(normalized->'entities_involved') = 'array'
      and jsonb_array_length(normalized->'entities_involved') > 0
      then normalized->'entities_involved'
    when jsonb_typeof(nested_payload->'entities_involved') = 'array'
      then nested_payload->'entities_involved'
    when jsonb_typeof(normalized->'entities') = 'array'
      and jsonb_array_length(normalized->'entities') > 0
      then normalized->'entities'
    when jsonb_typeof(nested_payload->'entities') = 'array'
      then nested_payload->'entities'
    when jsonb_typeof(normalized->'participants') = 'array'
      and jsonb_array_length(normalized->'participants') > 0
      then normalized->'participants'
    when jsonb_typeof(nested_payload->'participants') = 'array'
      then nested_payload->'participants'
    else '[]'::jsonb
  end;

  return normalized || jsonb_build_object(
    'title', coalesce(title, ''),
    'description', description,
    'event_kind', event_kind,
    'narrative_time', narrative_time,
    'entities_involved', entities_involved,
    'source_kind', coalesce(
      nullif(normalized->>'source_kind', ''),
      nullif(nested_payload->>'source_kind', ''),
      'memory_analysis'
    )
  );
end;
$$;

-- Repara registros que já possuem o JSON completo, mas foram aprovados com
-- description/narrative_time vazios por versões anteriores da normalização.
-- A CTE materializada evita referenciar a tabela-alvo dentro de um LATERAL
-- correlacionado, que o PostgreSQL rejeita em UPDATE ... FROM.
with normalized_events as materialized (
  select
    event_row.id,
    event_row.updated_by,
    event_row.created_by,
    public.normalize_memory_event_payload(event_row.payload, event_row.title) as event_payload
  from public.timeline_events as event_row
  where event_row.payload <> '{}'::jsonb
    and (
      nullif(event_row.description, '') is null
      or nullif(event_row.narrative_time, '') is null
      or event_row.payload->>'statement' is not null
      or event_row.payload->'payload' is not null
      or event_row.payload->'event' is not null
    )
)
update public.timeline_events as event_row
   set event_kind = normalized_events.event_payload->>'event_kind',
       title = left(normalized_events.event_payload->>'title', 240),
       description = left(normalized_events.event_payload->>'description', 4000),
       narrative_time = left(normalized_events.event_payload->>'narrative_time', 240),
       payload = normalized_events.event_payload,
       updated_by = coalesce(normalized_events.updated_by, normalized_events.created_by),
       updated_at = now()
  from normalized_events
 where event_row.id = normalized_events.id;

commit;

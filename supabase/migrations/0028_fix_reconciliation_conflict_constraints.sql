-- Corrige bancos em que as tabelas de associação foram criadas antes das
-- chaves compostas de 0016. O ON CONFLICT da aplicação atômica precisa de um
-- índice UNIQUE exatamente sobre (event_id, entity_id) e (thread_id, entity_id).

with duplicated_event_entities as (
  select ctid,
         row_number() over (
           partition by event_id, entity_id
           order by created_at, ctid
         ) as duplicate_number
    from public.timeline_event_entities
)
delete from public.timeline_event_entities target
 using duplicated_event_entities duplicate
 where target.ctid = duplicate.ctid
   and duplicate.duplicate_number > 1;

with duplicated_thread_entities as (
  select ctid,
         row_number() over (
           partition by thread_id, entity_id
           order by created_at, ctid
         ) as duplicate_number
    from public.open_thread_entities
)
delete from public.open_thread_entities target
 using duplicated_thread_entities duplicate
 where target.ctid = duplicate.ctid
   and duplicate.duplicate_number > 1;

create unique index if not exists timeline_event_entities_event_entity_unique_idx
  on public.timeline_event_entities (event_id, entity_id);

create unique index if not exists open_thread_entities_thread_entity_unique_idx
  on public.open_thread_entities (thread_id, entity_id);

comment on index public.timeline_event_entities_event_entity_unique_idx is
  'Permite aplicação idempotente de relações entre eventos e entidades.';

comment on index public.open_thread_entities_thread_entity_unique_idx is
  'Permite aplicação idempotente de relações entre threads e entidades.';

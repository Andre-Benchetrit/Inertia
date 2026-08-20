-- Migration 0018: compatibilidade da recuperação de eventos com o SQL Editor
--
-- O SQL Editor do Supabase não fornece auth.uid(). A função anterior usava
-- is_book_member(book_id) sem considerar esse contexto e retornava "acesso
-- negado" mesmo quando o UUID do evento existia. A aplicação continua exigindo
-- que chamadas autenticadas pertençam ao livro; somente a sessão privilegiada
-- do SQL Editor pode executar a recuperação administrativa.

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
     and (
       auth.uid() is null
       or public.is_book_member(e.book_id)
     )
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
         updated_by = coalesce(auth.uid(), updated_by, created_by),
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

grant execute on function public.reopen_memory_event_for_approval(uuid) to authenticated;

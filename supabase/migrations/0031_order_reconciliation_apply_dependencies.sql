-- Garante que o lote aplique entidades provisórias antes das relações que
-- dependem delas, independentemente da ordem em que as proposals foram criadas.

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
     order by case
       when p.proposal_kind = 'entity' and p.operation = 'create' then 0
       when p.proposal_kind = 'entity' then 1
       when p.proposal_kind = 'fact' and p.operation = 'create' then 2
       when p.proposal_kind = 'relation' then 3
       when p.proposal_kind = 'event' then 4
       when p.proposal_kind = 'open_thread' then 5
       else 6
     end,
     p.created_at,
     p.id
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

revoke execute on function public.apply_approved_canon_reconciliation(uuid, text) from public;
grant execute on function public.apply_approved_canon_reconciliation(uuid, text) to authenticated;

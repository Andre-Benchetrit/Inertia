-- Inertia: leitura segura de mensagens
-- Mensagens removidas continuam visíveis pela posição e metadados,
-- mas seu conteúdo original nunca é devolvido pela leitura do chat.

create or replace function public.get_chapter_messages(target_chapter_id uuid)
returns table (
  id uuid,
  author_id uuid,
  content text,
  message_type public.message_type,
  sequence_number bigint,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  edited_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.author_id,
    case when m.deleted_at is null then m.content else null end as content,
    m.message_type,
    m.sequence_number,
    m.created_at,
    m.updated_at,
    m.deleted_at,
    m.edited_at
  from public.messages m
  join public.chapters c on c.id = m.chapter_id
  where m.chapter_id = target_chapter_id
    and public.is_book_member(c.book_id)
  order by m.sequence_number, m.id;
$$;

revoke all on function public.get_chapter_messages(uuid) from public;
grant execute on function public.get_chapter_messages(uuid) to authenticated;
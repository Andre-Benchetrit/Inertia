-- Sprint 3G hotfix: não acessar NEW.entity_id durante triggers de relações.
-- A expressão anterior combinava tg_table_name com NEW.entity_id na mesma
-- condição; em um registro de universe_relations, NEW não possui esse campo.

create or replace function public.validate_universe_reference_books()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  referenced_book_id uuid;
  source_book_id uuid;
begin
  if tg_table_name = 'canon_facts' then
    if new.entity_id is not null then
      select book_id
        into referenced_book_id
        from public.universe_entities
       where id = new.entity_id;

      if referenced_book_id is null or referenced_book_id <> new.book_id then
        raise exception 'A entidade do fato pertence a outro livro';
      end if;
    end if;
  elsif tg_table_name = 'universe_relations' then
    select book_id
      into referenced_book_id
      from public.universe_entities
     where id = new.from_entity_id;

    if referenced_book_id is null or referenced_book_id <> new.book_id then
      raise exception 'A entidade de origem pertence a outro livro';
    end if;

    select book_id
      into referenced_book_id
      from public.universe_entities
     where id = new.to_entity_id;

    if referenced_book_id is null or referenced_book_id <> new.book_id then
      raise exception 'A entidade de destino pertence a outro livro';
    end if;
  end if;

  if new.source_chapter_id is not null then
    select book_id
      into source_book_id
      from public.chapters
     where id = new.source_chapter_id;

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

grant execute on function public.validate_universe_reference_books() to authenticated;

grant execute on function public.validate_universe_reference_books() to service_role;

comment on function public.validate_universe_reference_books() is
  'Valida referências de livro para fatos e relações sem acessar campos inexistentes no registro do trigger.';

notify pgrst, 'reload schema';

-- Separar o resumo da obra das instruções editoriais usadas pela IA.
alter table public.books
  add column if not exists ai_instructions text not null default '';

alter table public.books
  drop constraint if exists books_ai_instructions_length_check;

alter table public.books
  add constraint books_ai_instructions_length_check
  check (char_length(ai_instructions) <= 30000);

comment on column public.books.description is
  'Resumo da obra, apresentado aos colaboradores e usado como contexto narrativo.';

comment on column public.books.ai_instructions is
  'Instruções editoriais do livro para orientar a compilação e a revisão por IA.';

notify pgrst, 'reload schema';

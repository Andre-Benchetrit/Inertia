-- Inertia Sprint 3 — metadados de capítulos
-- Adiciona uma descrição opcional para contextualizar cada capítulo.
-- A descrição pode ser usada futuramente como contexto para IA, sem alterar
-- mensagens da Fonte ou versões do Manuscrito já existentes.

alter table public.chapters
  add column if not exists description text not null default '';

alter table public.chapters
  drop constraint if exists chapters_description_length_check;
alter table public.chapters
  add constraint chapters_description_length_check
  check (char_length(description) <= 2000);

# Sprint — Canon Reconciler semântico

## Objetivo

Evoluir o reconciliador atual, que hoje executa somente regras locais de atributos legados e deduplicação, para um consolidador de consequências canônicas. O fluxo continuará conservador: a IA descobre consequências, os autores aprovam, e somente uma ação explícita aplica alterações ao Universo.

## Linha de base auditada

A linha de base histórica executava apenas `runCanonReconciliationRules`, com regras locais de atributos e deduplicação. Após o sprint, o painel deixou de usar esse motor: `reconcileCanonWithOllama` é o único caminho de geração, recebe o contrato V5 e grava somente proposals pendentes para revisão humana. A API local legada permanece como compatibilidade e retorna sempre uma lista vazia; ela não cria proposals.

A infraestrutura de runs, fontes, propostas pendentes, aprovação humana e aplicação atômica já existe nas migrations `0025_canon_reconciliation_foundation.sql` e `0026_canon_reconciliation_apply.sql`, mas precisa ser alinhada aos payloads V5 para suportar corretamente relações, resolução de threads, provenance e transições de estado.

## Correspondência com o plano original

| Plano original                   | Implementação do sprint                                                                                     | Situação                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Auditoria antes da implementação | Checklist, preservação das alterações locais e revisão das migrations e do fluxo atual                      | Concluído                                           |
| Contrato `UNIVERSE_CONTRACT_V5`  | Tipos, schemas de validação e adapter V4→V5                                                                 | Concluído                                           |
| Geração de consequências pela IA | `reconcileCanonWithOllama` como único produtor; motor local legado desativado                               | Concluído                                           |
| `CANON_RECONCILIATION_V1`        | Prompt separado, contexto limitado e retorno JSON V5                                                        | Concluído                                           |
| Context Builder dedicado         | Entradas aprovadas + contexto relacionado, com `fact_mentions`, `event_participants` e lacunas de endpoints | Concluído                                           |
| Resolução de open threads        | Instrução explícita para relação direta entre fatos/eventos e pergunta da thread                            | Concluído                                           |
| Entidades provisórias            | Instrução semântica para itens, poderes e personagens citados sem registro                                  | Concluído                                           |
| Conflitos e temporalidade        | Instruções para alertas de conflito e transição `active/former` sem apagar histórico                        | Concluído                                           |
| Provenance e prevenção de loops  | Origem, basis, run e bloqueio de auto-reconciliação da própria derivação                                    | Concluído                                           |
| UI e aplicação atômica           | Cards por tipo de operação, revisão humana, aplicação explícita e idempotência                              | Concluído                                           |
| QA de Eleutheria                 | Smoke test do contexto/prompt e validação da ausência de proposals determinísticas                          | Concluído; cobertura Ollama depende de modelo local |
| Migrations de aplicação          | `0028` → `0030` → `0031` precisam ser aplicadas manualmente no Supabase                                     | Pendente operacional                                |

## Critérios de aceite deste sprint

1. Um fato explícito de parentesco gera uma proposta `relation/create` quando a relação não existe.
2. Um fato de posse ou recebimento gera entidade provisória de item, quando necessário, e relação de posse/equipamento.
3. Um fato de poder gera entidade provisória de poder e relação `has_power`; manifestações de poder existente não criam poderes novos por padrão.
4. Uma entidade citada em fato ou evento pode ser proposta como provisória, sem inventar atributos fora da allowlist.
5. Um fato ou evento que responde diretamente a uma thread pode gerar `open_thread/resolve`; similaridade temática fraca não resolve a thread.
6. Conflitos canônicos geram alerta/proposta para revisão, sem escolher automaticamente um lado.
7. Perdas e mudanças de estado preservam histórico e não usam `delete` destrutivo.
8. Cada proposta possui `basis`, `evidence`, `certainty`, `source_anchor` e `reconciliation_run_id` rastreável.
9. Reexecutar sobre as mesmas fontes não cria propostas equivalentes duplicadas.
10. O caminho de IA usa o contexto de reconciliação e o Ollama local, mantendo a aprovação humana e sem escrita automática no cânone.
11. O smoke test valida o contrato do prompt, menções de Jhin/Elise, participantes com papéis, endpoints ausentes, guardrails contra falsos positivos e que o motor local retorna zero proposals; a resposta real do Ollama deve ser validada com um modelo local selecionado.
12. TypeScript, lint e build passam; falhas preexistentes são separadas das introduzidas pelo sprint.

## Guardrails

Nenhum dado existente deve ser apagado ou reprocessado automaticamente. As alterações locais já presentes no repositório devem ser preservadas. A implementação deve preferir novas funções e migrations compatíveis, usando adapters para dados V4, em vez de reformulação destrutiva.

A IA não pode inventar UUIDs, nomes de lore, motivações, poderes não sustentados, relações românticas ou resoluções especulativas. `confidence` representa confiança da IA, não canonização. Toda alteração continua pendente até decisão humana explícita.

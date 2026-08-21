# Relatório — Sprint do Canon Reconciler semântico

## Resultado

O Canon Reconciler deixou de ser apenas um detector de duplicidades. O fluxo agora combina regras determinísticas de consequências canônicas com uma camada semântica opcional baseada no Ollama local. A aprovação dos autores continua obrigatória: a análise cria apenas proposals pendentes, e a escrita no Universo permanece uma ação explícita e separada.

## Implementações principais

| Área | Implementação |
| --- | --- |
| Contrato V5 | O contexto canônico ganhou campos de tipo de entidade, tipo de fato, sujeito, entidades relacionadas, escopo, certeza, participantes, outcomes, pergunta e resolução de threads. |
| Adapter V4→V5 | `adaptCanonContextToV5` preenche defaults compatíveis sem exigir reprocessamento dos dados antigos. |
| Rule Engine | Fatos explícitos podem gerar relações de parentesco, afiliação, posse, equipamento, poder, localização e criação. Também há entidades provisórias de itens e poderes, resolução direta de threads e alertas de conflito. |
| Ollama | Foi criado o prompt `CANON_RECONCILIATION_V1` e a função de chamada JSON estruturada ao Ollama local. Falha do modelo deixa o run parcial, preservando as propostas determinísticas. |
| Proveniência | A migration `0027_canon_reconciliation_provenance.sql` cria provenance por registro afetado e uma fila de fontes aguardando consolidação após aprovação de memória. |
| Temporalidade | `relation_status=former` é traduzido de modo compatível para arquivamento histórico da relação, sem exclusão destrutiva. |
| Idempotência | A dedupe key passou a considerar nome, statement, endpoints e tipo da relação. O painel também evita inserir uma proposta equivalente já pendente, aprovada ou aplicada em outro run. |
| UI | Os cards mostram o tipo da consequência semântica, distinguem entidades provisórias, resoluções de thread, conflitos e consolidações históricas. |
| QA | Foi adicionado `scripts/canon-reconciler-smoke.ts` com os casos de parentesco, item, poder, thread resolvida, thread não resolvida e conflito. |

## Casos validados

O teste de fumaça foi executado com sucesso e gerou sete propostas semânticas: entidade provisória de item, entidade provisória de poder, relação `owns`, relação `has_power`, relação `sibling_of`, resolução direta de thread e alerta de conflito. O caso “Cod odiava X” não resolveu indevidamente a thread “Quem matou X?”. Fatos de aparência, como olhos e cabelos, não foram transformados em itens ou relações de posse.

O comando usado foi:

```bash
npx tsx scripts/canon-reconciler-smoke.ts
```

A checagem TypeScript também foi executada com sucesso:

```bash
npx tsc --noEmit
```

A verificação `git diff --check` não encontrou erros de whitespace. O lint foi tentado, mas o executor remoto apresentou desconexões intermitentes antes de concluir a execução final; portanto, essa validação deve ser repetida no ambiente de desenvolvimento após a sincronização.

## Aplicação

A nova migration deve ser aplicada depois de `0026_canon_reconciliation_apply.sql`:

```text
0027_canon_reconciliation_provenance.sql
```

Ela não deve ser aplicada automaticamente pelo frontend. A migration cria a tabela de provenance, os triggers de registro pós-aplicação, o tratamento compatível de relações `former` e a fila de fontes aprovadas aguardando reconciliação.

## Limitações conhecidas

A seleção do modelo continua dependente de `localStorage` na chave `inertia:ollama:model`. Quando nenhum modelo é selecionado, o painel executa as regras determinísticas e informa que a camada do Ollama não foi executada. Quando um modelo está selecionado, o browser chama o Ollama local usando o contexto V5.

A fila de fontes pendentes já é criada no banco, mas a interface ainda usa as proposals aprovadas carregadas na página para montar as fontes incrementais. Uma evolução posterior pode substituir essa derivação por uma consulta direta à fila, incluindo botão específico para consolidar somente fontes não consumidas.

As alterações locais que já existiam antes deste sprint foram preservadas e não foram revertidas.

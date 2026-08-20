# Tutorial do Sprint 3 — Memória do Universo

O Sprint 3 transforma o Inertia em um espaço de memória controlada para cada livro, sem abandonar a proposta original de um chat simples organizado por capítulos. A **Fonte** continua sendo formada pelas mensagens dos autores e nunca é alterada pela inteligência artificial. O **Manuscrito** continua sendo uma versão compilada e editável. A nova camada é o **Universo**: um conjunto de entidades, fatos, relações, eventos e tramas abertas que só se tornam canônicos depois de uma decisão humana.

> **Regra central:** a IA pode observar o Manuscrito e propor informações, mas nunca decide o que é cânone. Uma proposta pendente não é enviada ao revisor como verdade e não aparece automaticamente no Universo canônico.

## 1. O modelo mental do Inertia

O fluxo editorial agora possui quatro momentos distintos. Primeiro, os autores conversam normalmente no chat do capítulo; essas mensagens são a Fonte. Em seguida, uma versão do Manuscrito pode ser compilada a partir somente das mensagens classificadas como História. Depois, os autores podem aprovar uma versão específica como base imutável para a análise de memória. Por fim, o Ollama analisa essa versão em blocos e produz propostas que ficam aguardando **Adicionar**, **Editar** ou **Ignorar**.

| Camada         | Conteúdo                                                        | A IA pode alterar?  | Como o autor interfere                                                                           |
| -------------- | --------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| **Fonte**      | Mensagens da conversa, incluindo História e Comentário          | Não                 | O autor edita ou remove apenas suas próprias mensagens, conforme as regras existentes            |
| **Manuscrito** | Versão compilada, com Markdown editorial e histórico de versões | Não automaticamente | O autor escolhe a versão e trabalha com as sugestões sem modificar a Fonte                       |
| **Sugestões**  | Correções propostas pelo revisor ou propostas de memória        | Não automaticamente | O autor aceita, rejeita, edita ou mantém pendente                                                |
| **Universo**   | Entidades, fatos, relações, eventos e tramas aprovados          | Não pela IA         | Os dois autores podem criar, editar e aprovar; o proprietário controla arquivamentos estruturais |

Os tipos de memória têm funções diferentes. **Entidade** é um cartão de identidade estável, como um personagem, local ou objeto recorrente. **Fato** é uma informação estável do mundo. **Relação** liga duas entidades em uma direção. **Evento** registra algo que aconteceu na narrativa. **Trama aberta** registra uma pergunta, conflito, mistério ou promessa ainda não resolvida.

## 2. Aplicar as migrations do Sprint 3

As migrations precisam ser executadas no SQL Editor do Supabase antes de usar os recursos de produção. A ordem correta é a seguinte:

| Ordem | Arquivo                                                       | Finalidade                                                                  |
| ----- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1     | `supabase/migrations/0011_approved_version_memory_status.sql` | Aprovação de versão e estado da memória no capítulo                         |
| 2     | `supabase/migrations/0012_universe_core.sql`                  | Entidades, fatos, relações, validações e RLS do Universo                    |
| 3     | `supabase/migrations/0014_memory_analysis.sql`                | Runs de análise, propostas, progresso e deduplicação                        |
| 4     | `supabase/migrations/0015_memory_approval_rpcs.sql`           | Aprovação, edição e rejeição atômicas das propostas existentes              |
| 5     | `supabase/migrations/0016_universe_events_open_threads.sql`   | Eventos, tramas abertas, vínculos com entidades e aprovação dos tipos novos |

A numeração `0013` foi intencionalmente pulada. A extensão foi criada como `0016` para preservar a sequência já aplicada em produção e não reexecutar ou substituir migrations anteriores. **Não altere os arquivos 0011, 0012, 0014 ou 0015 depois de aplicá-los.** No SQL Editor, cole e execute cada arquivo inteiro, aguardando a conclusão de um antes de executar o próximo.

Depois da aplicação, confirme no Supabase se existem as tabelas `universe_entities`, `canon_facts`, `universe_relations`, `timeline_events`, `timeline_event_entities`, `open_threads`, `open_thread_entities`, `memory_analysis_runs` e `memory_proposals`. Confirme também as funções `set_chapter_approved_version`, `start_memory_analysis`, `update_memory_analysis_progress`, `approve_memory_proposal` e `reject_memory_proposal`.

A migration 0016 mantém os dados anteriores intactos. Eventos e tramas usam tabelas próprias e tabelas auxiliares para ligar entidades do mesmo livro. O banco valida a origem do capítulo e da versão, impede vínculos entre livros diferentes e mantém RLS separado para membros e proprietário.

## 3. Cadastrar o Universo manualmente

Na página do livro, abra **Abrir Universo**. A tela possui as abas **Entidades**, **Fatos**, **Relações**, **Eventos**, **Tramas abertas** e **Propostas**. Os dois autores podem cadastrar e editar registros. Arquivar é uma exclusão lógica e preserva o histórico; a interface não apaga esses registros.

Uma entidade representa algo recorrente da obra, como personagem, local, facção, organização, poder, item, criatura ou conceito. Informe um nome, um tipo, um resumo, eventuais apelidos e, se necessário, atributos em JSON. Evite colocar ações episódicas, emoções momentâneas ou reações de uma cena nos atributos da entidade. Essas informações pertencem a um fato ou evento.

Fatos devem ser afirmações objetivas e estáveis, como “Paulo conhece a estação desde a infância”. Relações ligam duas entidades, como “Paulo — conhece — Estação”. Para aprovar uma relação proposta, as duas entidades precisam existir no Universo; isso evita a criação de vínculos sem referência.

### Eventos

Na aba **Eventos**, registre acontecimentos importantes, como um ataque, uma revelação, uma descoberta, uma mudança de relação ou uma cena decisiva. O formulário aceita tipo, título, descrição, tempo narrativo, entidades participantes e visibilidade.

Os eventos manuais são criados com origem `author`. Eventos aprovados a partir da análise de memória são criados com origem `manuscript`, capítulo, versão e evidência da proposta. Um evento pode permanecer sem entidades vinculadas quando os nomes ainda não foram aprovados; isso não bloqueia sua criação.

### Tramas abertas

Na aba **Tramas abertas**, registre mistérios, perguntas, conflitos e promessas narrativas que ainda precisam de resolução. O autor pode acompanhar o status **Aberta**, **Em andamento**, **Resolvida**, **Abandonada** ou **Contradita**, além de indicar prioridade baixa, normal ou alta.

Uma trama aberta não é uma afirmação de que algo já aconteceu. Ela é uma pendência narrativa que pode orientar continuidade e revisão. Por isso, deve ser descrita como questão ou conflito, e não como um fato concluído. Ela também pode ter entidades relacionadas opcionais.

A visibilidade `canon` é enviada ao revisor como memória autorizada. A visibilidade `author_only` permanece disponível para os autores, mas não é enviada ao revisor por padrão. Esse filtro preserva notas privadas, hipóteses e ideias ainda não consolidadas.

## 4. Aprovar uma versão como base

No capítulo, abra o painel **INERTIA - AI** e expanda Manuscrito. Em cada versão aparece o controle **Aprovar como base**. A aprovação registra uma fotografia imutável da versão escolhida: a análise de memória lerá exatamente aquele conteúdo, sem modificar o Manuscrito ou as mensagens.

O capítulo mostra um dos três estados seguintes:

| Estado                          | Significado                                                               |
| ------------------------------- | ------------------------------------------------------------------------- |
| **Memória ainda não analisada** | O capítulo ainda não possui uma análise concluída                         |
| **Memória desatualizada**       | A versão aprovada mudou, foi removida ou existe uma nova versão posterior |
| **Memória atualizada**          | A análise da versão aprovada foi concluída integralmente                  |

Quando uma nova versão é criada, a aprovação anterior é revogada e a memória volta a ficar desatualizada. Isso evita que fatos extraídos de um texto antigo sejam tratados como se viessem da versão mais recente.

## 5. Executar “Analisar Memória”

Com uma versão aprovada, Ollama disponível e um modelo local selecionado, clique em **Analisar Memória**. A análise é diferente de **Revisar com Ollama**: Revisar procura problemas de gramática, clareza, coerência, continuidade e organização editorial; Analisar Memória procura informações do universo que possam ser úteis no futuro.

A inferência permanece estritamente no navegador:

`Navegador → http://localhost:11434 → Ollama local`

A Vercel não funciona como proxy de inferência. O texto é dividido em blocos, e cada bloco é processado com JSON estruturado. O contrato atual é `MEMORY_EXTRACTION_V3`; ele inclui os cinco tipos de memória e invalida automaticamente runs antigos produzidos pelo contrato V2.

Para cada proposta, o sistema registra tipo, título, payload, evidência, explicação, confiança, bloco de origem e chave de deduplicação. A evidência deve ser um trecho curto realmente encontrado no bloco analisado. Entidades devem permanecer como identidades estáveis; ações, emoções, reações e acontecimentos episódicos devem ser classificados como eventos, fatos ou tramas abertas quando fizer sentido.

Se um bloco falhar depois de outros terem sido salvos, o run fica como parcial e as propostas já extraídas permanecem visíveis. A retomada também é feita por blocos. A deduplicação impede que a mesma proposta seja inserida repetidamente na mesma análise. Quando dois blocos apresentam informações complementares sobre a mesma entidade, fato, relação, evento ou trama, o sistema tenta consolidá-las; divergências são mantidas como conflito para decisão humana, não descartadas silenciosamente.

## 6. Revisar e decidir propostas

Abra a aba **Propostas** na página do Universo. Cada card informa o tipo de proposta, título, confiança, evidência, explicação, bloco de origem e payload sugerido. Enquanto estiver pendente, a proposta não é cânone.

| Ação                      | Resultado                                                                |
| ------------------------- | ------------------------------------------------------------------------ |
| **Adicionar ao Universo** | Cria o registro canônico correspondente e marca a proposta como aprovada |
| **Editar**                | Abre o payload JSON para correção humana antes da aprovação              |
| **Ignorar**               | Marca a proposta como rejeitada sem criar registro canônico              |

A aprovação é atômica no banco. Isso significa que a criação do registro no Universo, os vínculos de entidades e a mudança de status da proposta acontecem na mesma transação. Um duplo clique não duplica a decisão: uma proposta já aprovada retorna o resultado existente.

Para uma proposta de **evento**, o banco cria um registro em `timeline_events` e tenta resolver cada nome de `entities_involved` contra entidades já existentes do mesmo livro. Nomes não resolvidos são informados no resultado e não impedem o evento de ser aprovado. Para uma proposta de **trama aberta**, o banco cria um registro em `open_threads` e aplica o status e a prioridade válidos. As entidades relacionadas também são opcionais.

Relações continuam exigindo as duas entidades aprovadas. Fatos podem existir sem entidade vinculada, quando forem informações gerais da obra. Depois da aprovação, a proposta deixa de ser pendente, mas continua registrada para fins de histórico. O registro canônico guarda a origem como `manuscript`, o capítulo, a versão e a evidência usada na decisão.

## 7. Como o revisor usa a memória

Ao revisar um bloco, o Inertia carrega somente registros canônicos, ativos e relevantes para aquele texto. O construtor de contexto procura nomes e apelidos de entidades que aparecem no bloco, seleciona fatos e relações ligados a essas entidades e também procura eventos e tramas por entidades ou palavras relevantes do título e da descrição.

O contexto inclui:

| Tipo             | Como aparece no contexto                                  |
| ---------------- | --------------------------------------------------------- |
| **Entidade**     | Nome, apelidos, resumo e atributos estáveis               |
| **Fato**         | Afirmação e evidência disponível                          |
| **Relação**      | Entidade de origem, tipo e entidade de destino            |
| **Evento**       | Título, descrição, tempo narrativo e entidades envolvidas |
| **Trama aberta** | Título, descrição, estado e entidades relacionadas        |

Propostas pendentes, itens rejeitados, registros arquivados e itens `author_only` ficam fora desse contexto. O revisor recebe a memória como contexto de leitura e não pode transformá-la em canon. Ela serve para apontar possível continuidade, contradição ou incoerência, sempre como sugestão editorial.

As **Instruções para IA** continuam sendo o Style Bible do Inertia. Não existe uma segunda tabela de estilo. O resumo da obra permanece um resumo narrativo; as instruções são o espaço adequado para gênero, tom, limites editoriais e preferências dos autores.

## 8. Backup no formato 4

O botão de backup do livro agora gera `formatVersion: 4`. O formato mantém os dados anteriores e acrescenta eventos, vínculos de eventos, tramas abertas e vínculos de tramas dentro da seção `universe`.

| Seção                           | Conteúdo                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `universe.entities`             | Entidades ativas e arquivadas, com aliases e atributos                                |
| `universe.facts`                | Fatos, evidência, origem e status                                                     |
| `universe.relations`            | Relações direcionais e suas entidades de origem e destino                             |
| `universe.events`               | Eventos narrativos, tipo, descrição, origem, evidência e status                       |
| `universe.event_entities`       | Vínculos entre eventos e entidades, incluindo o papel da entidade                     |
| `universe.open_threads`         | Mistérios, conflitos e perguntas, com status e prioridade                             |
| `universe.open_thread_entities` | Vínculos entre tramas abertas e entidades relacionadas                                |
| `memory.chapter_statuses`       | Versão aprovada e estado da memória por capítulo                                      |
| `memory.analysis_runs`          | Modelo, hash da Fonte, progresso e status de cada análise                             |
| `memory.proposals`              | Propostas pendentes, aprovadas, rejeitadas ou superseded                              |
| `export_warnings`               | Consultas opcionais que não puderam ser exportadas, caso alguma migration ainda falte |

O backup não altera mensagens, Manuscritos, sugestões ou registros do Universo. Ele apenas lê as camadas permitidas pelo Supabase e gera um arquivo JSON local. A mudança para v4 é aditiva: backups anteriores continuam identificáveis por suas versões e não perdem os dados que já possuíam.

## 9. Checklist pessoal do autor

Para colocar o Sprint 3 completo em funcionamento, execute as cinco migrations no Supabase, inicie o Ollama localmente, confirme que o modelo escolhido está instalado e mantenha `OLLAMA_ORIGINS` incluindo `https://inertia-dekode.vercel.app` e `http://localhost:3000` quando também testar localmente. Depois, crie ou aprove uma versão de teste, execute uma análise curta, revise pelo menos uma proposta de cada tipo relevante e baixe um backup v4.

Antes de analisar o primeiro capítulo real, confira se a migration 0016 foi aplicada e se as abas **Eventos** e **Tramas abertas** carregam sem erro. A análise pode gerar propostas em inglês; nesse caso, use a tradução em lote da aba Propostas para converter títulos, explicações e payloads para português sem executar uma nova análise.

É importante que os autores decidam conscientemente o que é cânone. A confiança retornada pela IA é apenas uma indicação auxiliar; ela não substitui a leitura da evidência. Notas privadas devem permanecer `author_only`, e hipóteses que ainda não foram discutidas devem continuar como propostas pendentes ou fora do Universo.

## 10. Diagnóstico rápido

| Sintoma                                               | Verificação                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Análise de memória não inicia**                     | Confirme que a versão está aprovada e que as migrations 0011, 0012, 0014, 0015 e 0016 foram aplicadas                             |
| **Modelo não encontrado**                             | Execute `ollama list` e, se necessário, `ollama pull qwen3:4b`                                                                    |
| **Ollama inacessível**                                | Verifique `http://localhost:11434/api/tags` no navegador e o valor de `OLLAMA_ORIGINS`                                            |
| **Eventos ou tramas não aparecem**                    | Confirme as tabelas `timeline_events`, `timeline_event_entities`, `open_threads` e `open_thread_entities`, além das políticas RLS |
| **Proposta de relação não pode ser adicionada**       | Aprove ou crie antes as duas entidades referenciadas                                                                              |
| **Proposta de evento não vincula uma entidade**       | O evento pode ser aprovado mesmo assim; confirme se o nome da entidade está igual ao nome ou alias canônico                       |
| **Propostas aparecem, mas não podem ser adicionadas** | Aplique as migrations 0015 e 0016 e confirme a função RPC `approve_memory_proposal`                                               |
| **Memória continua desatualizada**                    | Confirme que o run terminou como `completed`; runs `partial` e `failed` não tornam a memória atual                                |
| **Backup v4 traz `export_warnings`**                  | Leia as mensagens listadas e aplique as migrations que ainda faltam                                                               |
| **Revisor não usa a memória**                         | Confirme que a entidade aparece no texto por nome ou apelido e que o registro está visível como `canon`, não arquivado e ativo    |

## Resultado esperado

Ao final do Sprint 3, o Inertia continua sendo um chat caseiro por capítulo, mas passa a preservar conhecimento recorrente de forma controlada. Entidades, fatos, relações, eventos e tramas abertas formam uma memória útil sem canonização automática. A IA observa e propõe; os autores decidem; o Universo guarda apenas o que foi aprovado. Esse desenho protege a Fonte e cria uma base segura para os próximos recursos, como recuperação contextual mais avançada e acompanhamento de continuidade narrativa.

> **Ordem prática recomendada:** aplicar 0016, confirmar as novas abas, aprovar a versão do capítulo 1, executar a análise V3, revisar as propostas, aprovar somente o que estiver sustentado pela evidência e então baixar o backup v4.

## 11. O que ainda precisa ser feito pessoalmente

A aplicação não consegue instalar o Ollama no computador do autor nem decidir o cânone por ele. Cada autor deve manter o Ollama em execução quando usar IA, selecionar um modelo local disponível e ler a evidência antes de aprovar uma proposta. Também cabe aos autores decidir se um registro é realmente estável, se deve ser apenas `author_only` ou se ainda deve permanecer como proposta pendente.

No ambiente de produção, o autor deve executar a migration 0016 no projeto Supabase correto, verificar as tabelas e políticas no painel do Supabase e publicar a versão atualizada na Vercel. Depois, deve abrir o primeiro capítulo, testar uma análise pequena e conferir no DevTools que as requisições de inferência vão diretamente para `http://localhost:11434`, nunca para uma rota `/api/ollama` da Vercel.

Como etapa final de segurança, baixe o backup v4 e guarde-o fora do navegador. O backup é uma cópia de leitura; ele não substitui a decisão editorial nem modifica a Fonte original.

## Referências de implementação

- Migration de eventos e tramas: `supabase/migrations/0016_universe_events_open_threads.sql`
- Extractor e contexto local do Ollama: `src/lib/ollama-browser.ts`
- Painel editorial e análise por blocos: `src/app/app/livro/[bookId]/capitulo/[chapterId]/EditorialPanel.tsx`
- Página do Universo: `src/app/app/livro/[bookId]/universo/page.tsx`
- Exportação de backup: `src/app/app/livro/[bookId]/page.tsx`

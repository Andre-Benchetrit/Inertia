# Plano futuro — Evolução do Memory Extractor

> Este documento registra o plano de melhoria analisado e aprovado para implementação posterior. Nesta etapa, nenhum código, migration ou dado de produção deve ser alterado.

## Objetivo

Fazer o Memory Extractor privilegiar memória narrativa reutilizável, evitando transformar ações pontuais, falas específicas, emoções temporárias ou inferências psicológicas em atributos permanentes de entidades.

A regra central será:

> Uma entidade representa quem ou o que algo é, não um histórico completo de tudo que fez naquele bloco.

## Etapa A — Precisão com o schema atual

A primeira etapa deve funcionar sem nova migration e alterar apenas o contrato do extractor, a normalização e, se necessário, os textos da interface.

### Entidades enxutas

Para `proposal_kind = entity`, priorizar somente `entity_type`, `name`, aliases reais, resumo curto e aparência ou identidade estável quando explicitamente sustentadas pelo texto.

Não colocar na entidade falas específicas, reações, ações pontuais, objetivos momentâneos, estados emocionais temporários ou interpretações psicológicas fortes.

Usar uma allowlist semântica para atributos estáveis, como aparência, idade, origem, espécie, ocupação, parentesco e capacidades, sempre condicionada a evidência explícita. Campos episódicos como `actions`, `reaction`, `response`, `emotion`, `mood`, `personality` e `current_goal` devem ser proibidos ou removidos da entidade.

### Aliases reais

Alias deve ser somente um nome, apelido ou forma textual pela qual a entidade é realmente chamada. Descrições genéricas como “garoto de seis anos”, “homem alto” ou “criatura pequena” não devem entrar em `aliases`. Quando não houver apelido real, usar `aliases: []`.

### Evidência antes do atributo

A extração deve localizar primeiro uma citação curta e consecutiva, identificar a entidade explicitamente relacionada a ela e somente depois derivar o payload. Se um atributo não puder ser sustentado por uma evidência curta associada à entidade correta, ele deve ser omitido.

A evidência deve ter aproximadamente 200–250 caracteres. `source_anchor` deve ser um localizador curto e não uma cópia da evidência.

### Anti-inferência

Não transformar ações momentâneas, falas específicas ou estados emocionais de uma cena em personalidade permanente. Uma formulação como “demonstra timidez nesta cena” deve ser tratada como observação, e não como “é tímido”.

Usar um contrato único de certeza, preferencialmente `certainty: explicit_fact | observed_trait | possible_inference`, mantendo `confidence` como a confiança numérica da IA na extração.

### Explanation curta

Manter `explanation` por compatibilidade com o fluxo atual, mas limitar a aproximadamente 120–180 caracteres e usá-la somente para explicar incertezas ou a necessidade de revisão humana.

## Etapa B — Memória episódica completa

Depois de estabilizar a Etapa A, criar uma migration posterior às já aplicadas (`0011`, `0012`, `0014` e `0015`). Não inserir uma migration `0013` retroativamente. A extensão deverá receber um novo número, por exemplo `0016_universe_events_open_threads.sql`.

### Tipos futuros

- `event`: acontecimento situado em trecho, capítulo ou período narrativo.
- `open_thread`: mistério, promessa, conflito ou pergunta ainda não resolvida.
- `observed_trait`: comportamento observado sem afirmar personalidade permanente.
- `voice_sample`: exemplo real de fala associado a uma entidade.

A primeira versão da extensão deve priorizar `event` e `open_thread`. `observed_trait` e `voice_sample` podem ser adicionados em seguida se a experiência demonstrar necessidade.

### Integrações obrigatórias

A extensão deverá atualizar o contrato TypeScript, a tabela de propostas, as RPCs de aprovação atômica, a interface de revisão, o Context Builder e o backup. Propostas pendentes nunca entrarão no cânone nem no contexto do revisor.

## Consolidação entre blocos

A análise por blocos pode gerar a mesma entidade em blocos diferentes. A evolução deverá incluir deduplicação e consolidação por nome, alias, tipo e conteúdo principal, sem simplesmente descartar informações complementares.

O fluxo recomendado é:

```text
Fonte do capítulo
  -> extração por blocos
  -> propostas locais
  -> deduplicação por chave normalizada
  -> consolidação de informações complementares
  -> propostas pendentes
  -> aprovação humana
  -> Universo canônico
```

A consolidação não deve decidir canon. Ela apenas pode unir propostas equivalentes ou apresentar uma proposta consolidada para aprovação humana.

## Prioridades

| Prioridade | Trabalho | Motivo |
| --- | --- | --- |
| P0 | Separar ações e emoções de entidades | Evita contaminar o Universo imediatamente |
| P0 | Corrigir aliases e atributos inventados | Resolve erros observados em personagens e objetos |
| P0 | Evidência curta orientada à entidade correta | Reduz atribuições incorretas como a cor de Zeca |
| P1 | Melhorar `certainty` e observed traits | Evita transformar interpretação em fato |
| P1 | Criar eventos e plots abertos | Completa a visão de memória do livro |
| P2 | Adicionar voice samples | Melhora a memória de voz sem bloquear o Universo |
| P2 | Consolidar entidades e relações entre blocos | Reduz duplicidades e melhora contexto global |

## Critérios de aceite

A implementação futura somente estará pronta quando:

1. Uma fala isolada não aparecer como atributo permanente de uma entidade.
2. Uma ação pontual não aparecer em `attributes.actions` de uma entidade.
3. Um estado emocional de uma cena não virar automaticamente `personality`.
4. Descrições de outra entidade não forem atribuídas por proximidade textual.
5. Aliases genéricos forem rejeitados ou removidos.
6. Evidência e `source_anchor` não duplicarem parágrafos longos.
7. Entidades repetidas em blocos diferentes puderem ser consolidadas sem perder dados complementares.
8. Eventos e plots aprovados puderem ser usados pelo Context Builder, enquanto propostas pendentes permanecerem excluídas.
9. A aprovação continuar sendo exclusivamente humana e idempotente.

## Regra operacional para a implementação

Não interromper nem modificar uma análise de produção em andamento. Usar o resultado atual como linha de base. Depois da conclusão, comparar a quantidade de entidades indevidas, atributos episódicos, aliases inválidos e evidências incorretas antes de implementar a Etapa A e reanalisar o primeiro capítulo.

## Implementação V5 — contexto progressivo e reanálise incremental

A implementação V5 mantém a aprovação humana como única entrada no cânone e adiciona duas camadas de memória progressiva. Durante a mesma execução, entidades canônicas e propostas `entity` já encontradas são mescladas ao contexto antes de cada bloco. Em uma nova execução sobre a mesma versão aprovada, todas as propostas pendentes da versão são carregadas pela `dedupe_key`, consolidadas pela mesma função de merge e mantidas como uma única proposta pendente visível.

Quando duas propostas pendentes equivalentes são encontradas entre execuções, a proposta mais antiga é preservada como registro principal e recebe a evidência, explicação, confiança, atributos e descrição complementares. A outra não é apagada: recebe status `superseded` e uma nota de consolidação. A interface filtra esse status para que os autores não vejam duplicatas, enquanto o histórico permanece no banco.

A recuperação de entidades relevantes prioriza automaticamente, dentro do contexto enviado ao Ollama, nomes e aliases que aparecem no bloco corrente. Entidades aprovadas no cânone continuam sendo carregadas em análises futuras; propostas pendentes anteriores podem orientar a consolidação da nova análise, mas não entram no cânone nem são tratadas como aprovadas.

O limite local foi aumentado de cinco para oito propostas por bloco, permitindo que blocos com muitos personagens, relações e acontecimentos mantenham mais candidatos antes da aprovação humana. O contrato de fonte foi atualizado para `MEMORY_EXTRACTION_V5`.

**Status:** consolidação stateful entre blocos e execuções implementada; validação de formatação, lint e build concluída.

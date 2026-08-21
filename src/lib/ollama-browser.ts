export type OllamaModel = {
  name: string
  modified_at?: string
  size?: number
  digest?: string
}

export type OllamaStatus = {
  available: boolean
  models: OllamaModel[]
  modelAvailable?: boolean
  recommendedModel?: string | null
  modelWarning?: string | null
  error?: string
}

export type OllamaModelCheck = {
  ok: boolean
  available: boolean
  models: string[]
  modelAvailable: boolean
  modelWarning: string | null
  recommendedModel: string | null
  error?: string
}

export type CompileSourceRow = {
  id: string
  content: string | null
  message_type: string
  sequence_number: number
  created_at: string
  author_id?: string
}

export type ReviewSuggestion = {
  suggestion_type: string
  severity: string
  explanation: string
  original_text: string | null
  suggested_text: string | null
  anchor: string | null
}

export type ReviewProgress = {
  block: number
  totalBlocks: number
}

export type ReviewBlockResult = {
  suggestions: ReviewSuggestion[]
  noIssuesReason: string | null
  done_reason?: string
}

export type CanonicalMemoryEntity = {
  id: string
  name: string
  aliases?: string[]
  entity_type?: string
  summary?: string
  knowledge_status?: "provisional" | "confirmed"
  attributes?: Record<string, unknown>
  visibility?: string
}

export type CanonicalMemoryFact = {
  id?: string
  entity_id?: string | null
  title?: string
  statement: string
  fact_type?:
    | "identity"
    | "appearance"
    | "origin"
    | "occupation"
    | "ability"
    | "possession"
    | "status"
    | "knowledge"
    | "condition"
    | "world_rule"
    | "lore"
    | "other"
  subject_entity?: string | null
  related_entities?: string[]
  scope?: "timeless" | "current" | "historical" | "temporary"
  certainty?: "explicit_fact" | "direct_derivation" | "possible_inference" | "author_defined"
  evidence?: string
  source_kind?: string
  source_chapter_id?: string | null
  source_version_id?: string | null
  source_chapter_label?: string
  source_version_label?: string
  visibility?: string
  status?: string
}

export type CanonicalMemoryRelation = {
  id?: string
  from_entity_id: string
  to_entity_id: string
  relation_type: string
  relation_status?: "active" | "former" | "unknown"
  description?: string
  certainty?: "explicit_fact" | "direct_derivation" | "possible_inference" | "author_defined"
  source_kind?: string
  source_chapter_id?: string | null
  source_version_id?: string | null
  source_chapter_label?: string
  source_version_label?: string
  visibility?: string
}

export type CanonicalMemoryEvent = {
  id: string
  title: string
  description: string
  event_kind?: string
  narrative_time?: string
  entity_ids?: string[]
  participants?: Array<{ entity_name: string; role: string }>
  outcomes?: string[]
  certainty?: "explicit_fact" | "direct_derivation" | "possible_inference" | "author_defined"
  source_kind?: string
  source_chapter_id?: string | null
  source_version_id?: string | null
  source_chapter_label?: string
  source_version_label?: string
  visibility?: string
  status?: string
}

export type CanonicalMemoryOpenThread = {
  id: string
  title: string
  question?: string
  description: string
  thread_type?: string
  status?: string
  thread_status?: string
  priority?: string
  entity_ids?: string[]
  resolution?: Record<string, unknown> | null
  certainty?: "explicit_fact" | "direct_derivation" | "possible_inference" | "author_defined"
  source_kind?: string
  source_chapter_id?: string | null
  source_version_id?: string | null
  source_chapter_label?: string
  source_version_label?: string
  visibility?: string
}

export type CanonicalMemorySourceRef = {
  record_type: "entity" | "fact" | "relation" | "event" | "open_thread"
  record_id: string
  source_role?: "approved_input" | "related_context"
}

export type CanonicalMemoryContext = {
  entities: CanonicalMemoryEntity[]
  facts: CanonicalMemoryFact[]
  relations: CanonicalMemoryRelation[]
  events?: CanonicalMemoryEvent[]
  openThreads?: CanonicalMemoryOpenThread[]
  approvedSources?: CanonicalMemorySourceRef[]
}

export type MemoryProposalRaw = {
  proposal_kind: "entity" | "fact" | "relation" | "event" | "open_thread"
  title: string
  payload: Record<string, unknown>
  evidence: string
  explanation: string
  confidence: number
  source_anchor: string
  dedupe_key: string
}

export type MemoryExtractionBlockResult = {
  proposals: MemoryProposalRaw[]
  done_reason?: string
}

export type ExistingMemoryEntity = {
  name: string
  aliases?: string[]
  entity_type?: string
  summary?: string
  attributes?: Record<string, unknown>
  context_source?: "canonical" | "current_run" | "canonical_and_current_run"
}

export class OllamaError extends Error {
  code: string

  constructor(message: string, code = "OLLAMA_ERROR") {
    super(message)
    this.name = "OllamaError"
    this.code = code
  }
}

const OLLAMA_URL = "http://localhost:11434"
const MAX_SOURCE_CHARS = 180000
const REVIEW_BLOCK_CHARS = 9000
const REVIEW_MAX_SUGGESTIONS_PER_BLOCK = 4
const REVIEW_OUTPUT_TOKENS = 3072
const REVIEW_BLOCK_TIMEOUT_MS = 180000
const COMPILE_BLOCK_CHARS = 9000
const COMPILE_BLOCK_OUTPUT_TOKENS = 4096
const COMPILE_BLOCK_TIMEOUT_MS = 180000
const AI_INSTRUCTIONS_CONTEXT_TOKENS = 16384
export const MEMORY_BLOCK_CHARS = 4500
const MEMORY_EXTRACTION_CONTEXT_TOKENS = 8192
const MEMORY_EXTRACTION_OUTPUT_TOKENS = 4096
const MEMORY_EXTRACTION_TIMEOUT_MS = 600000
const MEMORY_MAX_PROPOSALS_PER_BLOCK = 8
const MEMORY_EVIDENCE_CHARS = 260
const MEMORY_EXPLANATION_CHARS = 180
const MEMORY_SOURCE_ANCHOR_CHARS = 160

async function request<T>(
  path: string,
  init: RequestInit | undefined,
  timeoutMs = 5000,
): Promise<T> {
  let response: Response
  try {
    const headers = new Headers(init?.headers)
    if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
    response = await fetch(`${OLLAMA_URL}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
      headers,
    })
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError"
    throw new OllamaError(
      isTimeout
        ? `O Ollama demorou mais de ${Math.round(timeoutMs / 1000)} segundos para responder.`
        : `Não foi possível alcançar o Ollama em ${OLLAMA_URL}. Abra o Ollama e tente novamente.`,
      isTimeout ? "OLLAMA_TIMEOUT" : "OLLAMA_UNREACHABLE",
    )
  }

  if (!response.ok) {
    throw new OllamaError(
      `Ollama respondeu com HTTP ${response.status}`,
      response.status === 404 ? "OLLAMA_MODEL_NOT_FOUND" : "OLLAMA_HTTP_ERROR",
    )
  }
  return response.json() as Promise<T>
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  try {
    const data = await request<{ models?: OllamaModel[] }>("/api/tags", undefined, 5000)
    return { available: true, models: data.models ?? [] }
  } catch (error) {
    return {
      available: false,
      models: [],
      error: error instanceof Error ? error.message : "Ollama indisponível",
    }
  }
}

export async function checkOllamaModel(model: string): Promise<OllamaModelCheck> {
  try {
    const data = await request<{ models?: Array<{ name?: string }> }>("/api/tags", undefined, 5000)
    const models = (data.models ?? [])
      .map((item) => item.name)
      .filter((name): name is string => Boolean(name))
    const modelAvailable = Boolean(model && models.some((name) => name === model))
    const recommendedModel = models.find((name) => /instruct/i.test(name)) ?? null
    const modelWarning =
      model && /^qwen3(?::|$)/i.test(model) && !/instruct/i.test(model) && recommendedModel
        ? `O modelo "${model}" está respondendo em modo de raciocínio nesta instalação. Para compilar mais rápido, prefira "${recommendedModel}".`
        : null

    return {
      ok: true,
      available: true,
      models,
      modelAvailable,
      modelWarning,
      recommendedModel,
    }
  } catch (error) {
    return {
      ok: false,
      available: false,
      models: [],
      modelAvailable: false,
      modelWarning: null,
      recommendedModel: null,
      error: error instanceof Error ? error.message : "Ollama indisponível",
    }
  }
}

export function buildCompilePrompt(sourceText: string) {
  return `Você é um editor de ficção e formatador editorial para leitura em estilo Wattpad. Compile apenas o conteúdo de História abaixo, preservando fatos, voz, ordem e intenção. Não invente acontecimentos, personagens, lugares ou diálogos; não acrescente informações e não inclua Comentários dos autores. Retorne somente o manuscrito final em Markdown editorial, sem análise, prefácio, rótulos ou bloco de código.

Regras de formatação:
- Separe todos os parágrafos com uma linha em branco. Una mensagens que forem continuação da mesma frase ou parágrafo e crie uma nova quebra quando houver mudança real de ideia, cena ou ritmo.
- Coloque cada fala ou bloco de diálogo em seu próprio parágrafo, preservando o sentido e a voz.
- Remova os números de sequência das mensagens, como #1 ou #24.
- Use ## para um título curto de capítulo ou de seção somente quando houver uma mudança clara de cena ou uma abertura que comporte título; se não houver base suficiente, não crie título. Um título pode ser editorialmente provisório, mas não pode inventar fatos.
- Use **negrito** com moderação para uma ênfase narrativa realmente forte e *itálico* para pensamentos, palavras estrangeiras ou uma ênfase leve. Não formate cada frase.
- Use --- apenas para uma mudança clara de cena.
- Nunca use HTML, links, emojis, listas ou comentários sobre o próprio processo.

FONTE:
${sourceText}`
}

export async function compileManuscript(model: string, prompt: string, outputTokens: number) {
  return request<{ response?: string; done_reason?: string }>(
    "/api/generate",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        think: false,
        options: { num_predict: outputTokens, temperature: 0.2 },
      }),
    },
    180000,
  )
}

export const compileWithOllamaLocal = compileManuscript

export type CompileBlockProgress = {
  block: number
  totalBlocks: number
  content: string
}

export function buildCompileBlockPrompt(
  block: string,
  blockNumber: number,
  totalBlocks: number,
  previousTail: string,
  storyContext = "",
  editorialInstructions = "",
) {
  const continuity = previousTail
    ? `Use o final do bloco anterior apenas para manter continuidade de voz, cena e parágrafo. Não repita esse trecho na resposta.\n\nFINAL DO BLOCO ANTERIOR:\n${previousTail}`
    : "Este é o primeiro bloco. Comece diretamente pelo texto editorial, sem prefácio."
  const summary = storyContext.trim()
    ? `RESUMO DA OBRA:\n${storyContext.trim()}`
    : "RESUMO DA OBRA:\nNão informado pelos autores."
  const instructions = editorialInstructions.trim()
    ? `INSTRUÇÕES EDITORIAIS DOS AUTORES:\n${editorialInstructions.trim()}`
    : "INSTRUÇÕES EDITORIAIS DOS AUTORES:\nNenhuma instrução adicional foi informada."

  return `Você é um editor de ficção e formatador editorial para leitura em estilo Wattpad. Compile somente este bloco da História, preservando fatos, voz, ordem e intenção. Não invente acontecimentos, personagens, lugares ou diálogos; não acrescente informações e não inclua Comentários dos autores. Retorne somente o bloco compilado em Markdown editorial, sem análise, prefácio, rótulos ou bloco de código.

${summary}

${instructions}

Este é o bloco ${blockNumber} de ${totalBlocks}. ${continuity}

Regras de formatação:
- Separe todos os parágrafos com uma linha em branco. Una mensagens que forem continuação da mesma frase ou parágrafo e crie uma nova quebra quando houver mudança real de ideia, cena ou ritmo.
- Coloque cada fala ou bloco de diálogo em seu próprio parágrafo, preservando o sentido e a voz.
- Não carregue números de sequência das mensagens para a resposta.
- Não crie um título de capítulo em blocos posteriores. Use ## somente no primeiro bloco, se houver base suficiente, ou para uma mudança clara de cena que realmente comporte um título de seção. Não repita títulos.
- Use **negrito** com moderação para uma ênfase narrativa realmente forte e *itálico* para pensamentos, palavras estrangeiras ou uma ênfase leve. Não formate cada frase.
- Use --- apenas para uma mudança clara de cena.
- Nunca use HTML, links, emojis, listas ou comentários sobre o próprio processo.
- Preserve a continuidade com o final do bloco anterior e não recapitule acontecimentos já apresentados.

BLOCO DA FONTE:
${block}`
}

export async function compileBlockLocal(
  model: string,
  block: string,
  blockNumber: number,
  totalBlocks: number,
  previousTail: string,
  storyContext = "",
  editorialInstructions = "",
): Promise<{ response?: string; done_reason?: string }> {
  const raw = await request<{ response?: string; done_reason?: string }>(
    "/api/generate",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: buildCompileBlockPrompt(
          block,
          blockNumber,
          totalBlocks,
          previousTail,
          storyContext,
          editorialInstructions,
        ),
        stream: false,
        think: false,
        options: {
          num_predict: COMPILE_BLOCK_OUTPUT_TOKENS,
          temperature: 0.2,
          num_ctx: AI_INSTRUCTIONS_CONTEXT_TOKENS,
        },
      }),
    },
    COMPILE_BLOCK_TIMEOUT_MS,
  )

  if (raw.done_reason === "length")
    throw new OllamaError(
      `O Ollama atingiu o limite de saída ao compilar o bloco ${blockNumber} de ${totalBlocks}. O bloco não foi salvo.`,
      "OLLAMA_OUTPUT_LIMIT",
    )

  const response = raw.response?.trim()
  if (!response)
    throw new OllamaError(
      `O Ollama não retornou conteúdo para o bloco ${blockNumber} de ${totalBlocks}.`,
      "OLLAMA_EMPTY_RESPONSE",
    )

  return { response, done_reason: raw.done_reason }
}

function normalizePart(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR")
}

function normalizeNoIssuesReason(value: unknown) {
  if (typeof value !== "string") return null
  const reason = value.replace(/\s+/g, " ").trim()
  return reason ? reason.slice(0, 320) : null
}

export function suggestionKeyBrowser(item: ReviewSuggestion) {
  const original = normalizePart(item.original_text)
  const suggested = normalizePart(item.suggested_text)
  return [item.suggestion_type, original || normalizePart(item.anchor), suggested].join("|")
}

function canonicalSourceLabel(item: {
  source_kind?: string
  source_chapter_label?: string
  source_version_label?: string
}) {
  const parts = [
    item.source_chapter_label,
    item.source_version_label,
    item.source_kind === "manuscript" ? "manuscrito" : item.source_kind === "author" ? "autor" : "",
  ].filter(Boolean)
  return parts.length ? ` Origem: ${parts.join(" — ")}.` : ""
}

export function buildReviewerContext(
  reviewText: string,
  memory: CanonicalMemoryContext,
  maxChars = 7000,
) {
  const searchableText = normalizePart(reviewText)
  const visibleEntities = memory.entities.filter(
    (entity) => !entity.visibility || entity.visibility === "canon",
  )
  const relevantEntities = visibleEntities.filter((entity) => {
    const names = [entity.name, ...(entity.aliases ?? [])]
      .map((value) => normalizePart(value))
      .filter(Boolean)
    return names.some((name) => searchableText.includes(name))
  })
  const relevantIds = new Set(relevantEntities.map((entity) => entity.id))
  const visibleFacts = memory.facts.filter(
    (fact) =>
      (!fact.visibility || fact.visibility === "canon") &&
      (!fact.status || fact.status === "active"),
  )
  const relevantFacts = visibleFacts.filter((fact) => {
    if (fact.entity_id && relevantIds.has(fact.entity_id)) return true
    return normalizePart(fact.statement)
      .split(" ")
      .filter((word) => word.length >= 4)
      .some((word) => searchableText.includes(word))
  })
  const relevantRelations = memory.relations.filter(
    (relation) =>
      (!relation.visibility || relation.visibility === "canon") &&
      relevantIds.has(relation.from_entity_id) &&
      relevantIds.has(relation.to_entity_id),
  )
  const visibleEvents = (memory.events ?? []).filter(
    (event) =>
      (!event.visibility || event.visibility === "canon") &&
      (!event.status || event.status === "active"),
  )
  const relevantEvents = visibleEvents.filter((event) => {
    if ((event.entity_ids ?? []).some((entityId) => relevantIds.has(entityId))) return true
    return [event.title, event.description, event.narrative_time]
      .filter(Boolean)
      .map((value) => normalizePart(value))
      .some((value) =>
        value
          .split(" ")
          .filter((word) => word.length >= 4)
          .some((word) => searchableText.includes(word)),
      )
  })
  const visibleOpenThreads = (memory.openThreads ?? []).filter(
    (thread) => !thread.visibility || thread.visibility === "canon",
  )
  const relevantOpenThreads = visibleOpenThreads.filter((thread) => {
    if ((thread.entity_ids ?? []).some((entityId) => relevantIds.has(entityId))) return true
    return [thread.title, thread.description]
      .filter(Boolean)
      .map((value) => normalizePart(value))
      .some((value) =>
        value
          .split(" ")
          .filter((word) => word.length >= 4)
          .some((word) => searchableText.includes(word)),
      )
  })

  const lines = [
    "MEMÓRIA CANÔNICA RELEVANTE DO UNIVERSO (somente leitura; não altere nem invente canon):",
  ]
  const entityNames = new Map(relevantEntities.map((entity) => [entity.id, entity.name]))
  for (const entity of relevantEntities) {
    const aliases = entity.aliases?.filter(Boolean).join(", ")
    const attributes =
      entity.attributes && Object.keys(entity.attributes).length
        ? ` Atributos: ${JSON.stringify(entity.attributes)}.`
        : ""
    lines.push(
      `- Entidade: ${entity.name}.${aliases ? ` Apelidos: ${aliases}.` : ""}${entity.summary ? ` Resumo: ${entity.summary}.` : ""}${attributes}`,
    )
  }
  for (const fact of relevantFacts) {
    lines.push(
      `- Fato canônico: ${fact.statement}${fact.evidence ? ` Evidência: ${fact.evidence}` : ""}${canonicalSourceLabel(fact)}`,
    )
  }
  for (const relation of relevantRelations) {
    const from = entityNames.get(relation.from_entity_id) ?? "entidade de origem"
    const to = entityNames.get(relation.to_entity_id) ?? "entidade de destino"
    lines.push(
      `- Relação canônica: ${from} — ${relation.relation_type} — ${to}.${relation.description ? ` ${relation.description}` : ""}${canonicalSourceLabel(relation)}`,
    )
  }
  for (const event of relevantEvents) {
    const involved = (event.entity_ids ?? [])
      .map((entityId) => entityNames.get(entityId))
      .filter(Boolean)
      .join(", ")
    lines.push(
      `- Evento canônico: ${event.title}.${event.description ? ` ${event.description}` : ""}${event.narrative_time ? ` Quando: ${event.narrative_time}.` : ""}${involved ? ` Envolve: ${involved}.` : ""}${canonicalSourceLabel(event)}`,
    )
  }
  for (const thread of relevantOpenThreads) {
    const involved = (thread.entity_ids ?? [])
      .map((entityId) => entityNames.get(entityId))
      .filter(Boolean)
      .join(", ")
    lines.push(
      `- Trama aberta canônica: ${thread.title}.${thread.description ? ` ${thread.description}` : ""}${thread.status ? ` Estado: ${thread.status}.` : ""}${involved ? ` Relacionada a: ${involved}.` : ""}${canonicalSourceLabel(thread)}`,
    )
  }

  if (lines.length === 1) {
    return "MEMÓRIA CANÔNICA RELEVANTE DO UNIVERSO:\nNenhum registro canônico foi identificado como relevante para este bloco. Não invente contexto ausente."
  }

  const result: string[] = [lines[0]]
  let length = lines[0].length
  for (const line of lines.slice(1)) {
    if (length + line.length + 1 > maxChars) break
    result.push(line)
    length += line.length + 1
  }
  return result.join("\n")
}

export function splitIntoBlocks(text: string, blockChars = REVIEW_BLOCK_CHARS) {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const blocks: string[] = []
  let current = ""

  for (const paragraph of paragraphs) {
    const parts =
      paragraph.length > blockChars
        ? Array.from({ length: Math.ceil(paragraph.length / blockChars) }, (_, index) =>
            paragraph.slice(index * blockChars, (index + 1) * blockChars),
          )
        : [paragraph]
    for (const part of parts) {
      const candidate = current ? `${current}\n\n${part}` : part
      if (current && candidate.length > blockChars) {
        blocks.push(current)
        current = part
      } else {
        current = candidate
      }
    }
  }
  if (current) blocks.push(current)
  return blocks.length ? blocks : [text.slice(0, blockChars)]
}

export function normalizeSuggestions(
  rawSuggestions: unknown[],
  maxPerBlock = REVIEW_MAX_SUGGESTIONS_PER_BLOCK,
): ReviewSuggestion[] {
  return rawSuggestions
    .map((item) => {
      const value = item as Record<string, unknown>
      return {
        suggestion_type: String(value.suggestion_type ?? "editorial"),
        severity: String(value.severity ?? "medium"),
        explanation: String(value.explanation ?? ""),
        original_text: value.original_text == null ? null : String(value.original_text),
        suggested_text: value.suggested_text == null ? null : String(value.suggested_text),
        anchor: value.anchor == null ? null : String(value.anchor),
      }
    })
    .filter(
      (item) =>
        new Set(["grammar", "style", "coherence", "continuity", "editorial"]).has(
          item.suggestion_type,
        ) &&
        new Set(["low", "medium", "high"]).has(item.severity) &&
        item.explanation.trim(),
    )
    .slice(0, maxPerBlock)
}

function reviewPrompt(
  block: string,
  blockNumber: number,
  totalBlocks: number,
  storyContext: string,
  editorialInstructions = "",
  reviewerMemoryContext = "",
) {
  const instructions = editorialInstructions.trim()
    ? `INSTRUÇÕES EDITORIAIS DOS AUTORES:\n${editorialInstructions.trim()}`
    : "INSTRUÇÕES EDITORIAIS DOS AUTORES:\nNenhuma instrução adicional foi informada."

  return `Revise somente o bloco abaixo com postura conservadora e respeitando o gênero e o contexto da obra. O contexto foi fornecido pelos autores e serve como orientação editorial, não como texto para copiar.

RESUMO DA OBRA:
${storyContext || "Não informado pelos autores."}

${instructions}

${reviewerMemoryContext || "MEMÓRIA CANÔNICA RELEVANTE DO UNIVERSO:\nNenhum registro canônico foi identificado como relevante para este bloco."}

O texto usa Markdown editorial para leitura em estilo Wattpad: ## indica título, linhas em branco indicam parágrafos, **texto** indica negrito, *texto* indica itálico e --- indica mudança de cena. Não trate esses marcadores como erros. Não corrija ação exagerada, onomatopeias, humor, linguagem coloquial, metáforas fortes ou escolhas típicas de ficção científica apenas por serem ousadas. Só sugira mudança de estilo quando houver um problema real de clareza, coerência ou adequação ao contexto fornecido.

Procure problemas reais de gramática, coerência, continuidade e oportunidades pontuais de organização editorial. Sugira estilo apenas quando necessário. Não reescreva o texto inteiro e não aplique nenhuma sugestão automaticamente. Uma revisão sem sugestões é um resultado válido e preferível a um falso positivo: não crie propostas apenas para preencher o limite. Retorne somente JSON válido com as chaves suggestions e no_issues_reason. suggestions deve conter no máximo ${REVIEW_MAX_SUGGESTIONS_PER_BLOCK} objetos. Cada objeto deve ter suggestion_type (grammar, style, coherence, continuity ou editorial), severity (low, medium ou high), explanation, original_text, suggested_text e anchor. original_text deve ser um trecho inteiro e consecutivo do bloco, preservando exatamente os espaços e quebras de linha presentes no texto. Não misture trechos separados nem inclua texto de outro parágrafo. suggested_text deve substituir exatamente original_text e pode conter Markdown editorial. Se não houver problema relevante, retorne suggestions como lista vazia e escreva em no_issues_reason uma justificativa curta, objetiva e específica sobre por que o bloco foi considerado adequado. Não use uma frase genérica como “não há erros”; mencione os aspectos realmente observados, como gramática, clareza, coerência, continuidade ou respeito às instruções editoriais. Se houver sugestões, retorne no_issues_reason como null.

BLOCO ${blockNumber} DE ${totalBlocks}:
${block}`
}

export async function reviewBlockLocal(
  model: string,
  block: string,
  blockNumber: number,
  totalBlocks: number,
  storyContext: string,
  editorialInstructions = "",
  reviewerMemoryContext = "",
): Promise<ReviewBlockResult> {
  const raw = await request<{ response?: string; done_reason?: string }>(
    "/api/generate",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: reviewPrompt(
          block,
          blockNumber,
          totalBlocks,
          storyContext,
          editorialInstructions,
          reviewerMemoryContext,
        ),
        stream: false,
        think: false,
        format: "json",
        options: {
          num_predict: REVIEW_OUTPUT_TOKENS,
          temperature: 0.2,
          num_ctx: AI_INSTRUCTIONS_CONTEXT_TOKENS,
        },
      }),
    },
    REVIEW_BLOCK_TIMEOUT_MS,
  )

  if (raw.done_reason === "length")
    throw new OllamaError(
      `O Ollama atingiu o limite de saída ao revisar o bloco ${blockNumber} de ${totalBlocks}. O bloco não foi salvo.`,
      "OLLAMA_OUTPUT_LIMIT",
    )

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.response ?? "{}")
  } catch {
    throw new OllamaError(
      `A resposta do Ollama para o bloco ${blockNumber} não veio em JSON válido.`,
      "OLLAMA_INVALID_JSON",
    )
  }

  const parsedObject = parsed as {
    suggestions?: unknown
    no_issues_reason?: unknown
  }
  const suggestions = Array.isArray(parsedObject.suggestions) ? parsedObject.suggestions : []
  const normalizedSuggestions = normalizeSuggestions(suggestions)
  return {
    suggestions: normalizedSuggestions,
    noIssuesReason:
      normalizedSuggestions.length === 0
        ? normalizeNoIssuesReason(parsedObject.no_issues_reason)
        : null,
    done_reason: raw.done_reason,
  }
}

export async function reviewWithOllama(
  model: string,
  content: string,
  storyContext: string,
  onProgress?: (progress: ReviewProgress) => void,
): Promise<{ suggestions: ReviewSuggestion[]; blocksProcessed: number }> {
  const blocks = splitIntoBlocks(content.slice(0, MAX_SOURCE_CHARS))
  const generated: ReviewSuggestion[] = []

  for (let index = 0; index < blocks.length; index += 1) {
    const blockNumber = index + 1
    const generatedBlock = await reviewBlockLocal(
      model,
      blocks[index],
      blockNumber,
      blocks.length,
      storyContext,
    )
    generated.push(...generatedBlock.suggestions)
    onProgress?.({ block: blockNumber, totalBlocks: blocks.length })
  }

  const seen = new Set<string>()
  const unique = generated.filter((item) => {
    const key = suggestionKeyBrowser(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { suggestions: unique, blocksProcessed: blocks.length }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

const MEMORY_ENTITY_TRANSIENT_KEYS = new Set([
  "action",
  "actions",
  "current_action",
  "current_goal",
  "dialogue",
  "emotion",
  "mood",
  "motivation",
  "personality",
  "reaction",
  "response",
  "scene_behavior",
  "temporary_state",
  "thought",
  "voice",
])

function normalizeMemoryKey(value: string) {
  return normalizePart(value)
    .replace(/[|:;,]+/g, "|")
    .replace(/\|+/g, "|")
    .replace(/^\|+|\|+$/g, "")
}

function memoryEntityNames(entity: ExistingMemoryEntity) {
  return [entity.name, ...(entity.aliases ?? [])]
    .map((value) => normalizePart(value))
    .filter(Boolean)
}

export function mergeMemoryEntityContexts(entities: ExistingMemoryEntity[]) {
  const merged: ExistingMemoryEntity[] = []

  for (const incoming of entities) {
    const incomingNames = memoryEntityNames(incoming)
    if (!incomingNames.length) continue
    const existingIndex = merged.findIndex((current) => {
      const currentNames = memoryEntityNames(current)
      return incomingNames.some((name) => currentNames.includes(name))
    })

    if (existingIndex < 0) {
      merged.push({
        ...incoming,
        aliases: [...(incoming.aliases ?? [])],
        attributes: incoming.attributes ? { ...incoming.attributes } : undefined,
      })
      continue
    }

    const current = merged[existingIndex]
    const aliases = [...(current.aliases ?? []), ...(incoming.aliases ?? [])]
      .map((alias) => String(alias).trim())
      .filter(Boolean)
      .filter(
        (alias, index, values) =>
          values.findIndex((value) => normalizePart(value) === normalizePart(alias)) === index,
      )
      .slice(0, 8)
    const summaries = [current.summary, incoming.summary]
      .map((summary) =>
        String(summary ?? "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)
      .filter(
        (summary, index, values) =>
          values.findIndex((value) => normalizePart(value) === normalizePart(summary)) === index,
      )
    const attributes = { ...(current.attributes ?? {}), ...(incoming.attributes ?? {}) }
    const hasCanonicalSource =
      current.context_source === "canonical" || incoming.context_source === "canonical"
    const hasCurrentRunSource =
      current.context_source === "current_run" || incoming.context_source === "current_run"
    const context_source: ExistingMemoryEntity["context_source"] =
      hasCanonicalSource && hasCurrentRunSource
        ? "canonical_and_current_run"
        : hasCurrentRunSource
          ? "current_run"
          : hasCanonicalSource
            ? "canonical"
            : undefined

    merged[existingIndex] = {
      ...current,
      aliases,
      summary: summaries.join(" ").slice(0, 420) || undefined,
      attributes: Object.keys(attributes).length ? attributes : undefined,
      entity_type: current.entity_type || incoming.entity_type,
      context_source,
    }
  }

  return merged
}

function sanitizeEntityPayload(payload: Record<string, unknown>, title: string) {
  const result: Record<string, unknown> = { ...payload }
  const name = String(result.name ?? title)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160)
  if (name) result.name = name

  if (Array.isArray(result.aliases)) {
    result.aliases = result.aliases
      .map((alias) => String(alias).replace(/\s+/g, " ").trim().slice(0, 120))
      .filter(
        (alias, index, aliases) =>
          alias && normalizePart(alias) !== normalizePart(name) && aliases.indexOf(alias) === index,
      )
      .slice(0, 8)
  }

  if (typeof result.summary === "string") {
    result.summary = result.summary.replace(/\s+/g, " ").trim().slice(0, 420)
  }

  const rawAttributes = asObject(result.attributes)
  const stableAttributes = Object.fromEntries(
    Object.entries(rawAttributes).filter(([key]) => {
      const normalizedKey = normalizePart(key).replace(/\s+/g, "_")
      return !MEMORY_ENTITY_TRANSIENT_KEYS.has(normalizedKey)
    }),
  )
  result.attributes = stableAttributes
  return result
}

function normalizedMemoryProposal(value: unknown, sourceBlock = ""): MemoryProposalRaw | null {
  const item = asObject(value)
  const kind = item.proposal_kind
  if (
    kind !== "entity" &&
    kind !== "fact" &&
    kind !== "relation" &&
    kind !== "event" &&
    kind !== "open_thread"
  )
    return null

  const title = String(item.title ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160)
  const evidence = String(item.evidence ?? "")
    .trim()
    .slice(0, MEMORY_EVIDENCE_CHARS)
  const explanation = String(item.explanation ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEMORY_EXPLANATION_CHARS)
  const sourceAnchor = String(item.source_anchor ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEMORY_SOURCE_ANCHOR_CHARS)
  const rawPayload = asObject(item.payload)
  const payload = kind === "entity" ? sanitizeEntityPayload(rawPayload, title) : rawPayload
  if (kind === "event" || kind === "open_thread") {
    if (typeof payload.description === "string") {
      payload.description = payload.description.replace(/\s+/g, " ").trim().slice(0, 1200)
    }
    if (Array.isArray(payload.entities_involved)) {
      payload.entities_involved = payload.entities_involved
        .map((name) => String(name).replace(/\s+/g, " ").trim().slice(0, 160))
        .filter(
          (name, index, names) =>
            name &&
            names.findIndex((item) => normalizePart(item) === normalizePart(name)) === index,
        )
        .slice(0, 12)
    }
  }
  const numericConfidence = Number(item.confidence)
  const confidence = Number.isFinite(numericConfidence)
    ? Math.max(0, Math.min(1, numericConfidence))
    : 0
  const fallbackKey = [
    kind,
    normalizeMemoryKey(String(payload.name ?? title)),
    normalizeMemoryKey(
      String(payload.statement ?? payload.relation_type ?? payload.description ?? ""),
    ),
  ]
    .filter(Boolean)
    .join("|")
  const dedupeKey = normalizeMemoryKey(String(item.dedupe_key ?? fallbackKey)).slice(0, 500)
  const normalizedEvidence = normalizePart(evidence)
  const normalizedSourceBlock = normalizePart(sourceBlock)
  const evidenceIsGrounded =
    !normalizedSourceBlock ||
    normalizedEvidence.length < 8 ||
    normalizedSourceBlock.includes(normalizedEvidence)

  if (!title || !evidence || !explanation || !sourceAnchor || !dedupeKey || !evidenceIsGrounded)
    return null

  return {
    proposal_kind: kind,
    title,
    payload,
    evidence,
    explanation,
    confidence,
    source_anchor: sourceAnchor,
    dedupe_key: dedupeKey,
  }
}

export function buildMemoryExtractionPrompt(
  block: string,
  blockNumber: number,
  totalBlocks: number,
  storyContext: string,
  editorialInstructions: string,
  existingEntities: ExistingMemoryEntity[] = [],
) {
  const summary = storyContext.trim()
    ? storyContext.trim().slice(0, 1800)
    : "Não informado pelos autores."
  const instructions = editorialInstructions.trim()
    ? editorialInstructions.trim().slice(0, 3000)
    : "Nenhuma instrução editorial adicional foi informada."
  const normalizedBlock = normalizePart(block)
  const knownEntities = existingEntities.length
    ? [...existingEntities]
        .sort((left, right) => {
          const leftRelevant = memoryEntityNames(left).some((name) =>
            normalizedBlock.includes(name),
          )
          const rightRelevant = memoryEntityNames(right).some((name) =>
            normalizedBlock.includes(name),
          )
          return Number(rightRelevant) - Number(leftRelevant)
        })
        .slice(0, 30)
        .map((entity) => {
          const aliases = entity.aliases?.filter(Boolean).join(", ")
          const type = entity.entity_type ? `; tipo: ${entity.entity_type}` : ""
          const summary = entity.summary ? `; resumo: ${entity.summary.slice(0, 240)}` : ""
          const attributes =
            entity.attributes && Object.keys(entity.attributes).length
              ? `; dados estáveis: ${Object.entries(entity.attributes)
                  .slice(0, 6)
                  .map(
                    ([key, value]) =>
                      `${key}=${String(JSON.stringify(value) ?? value).slice(0, 100)}`,
                  )
                  .join(", ")}`
              : ""
          const source =
            entity.context_source === "current_run"
              ? "proposta pendente desta análise"
              : entity.context_source === "canonical_and_current_run"
                ? "cânone e proposta pendente desta análise"
                : "cânone atual"
          return `- ${entity.name}${aliases ? ` (apelidos: ${aliases})` : ""}${type}${summary}${attributes} [${source}]`
        })
        .join("\n")
    : "Nenhuma entidade conhecida foi cadastrada ou proposta ainda."

  return `Você é um arquivista conservador de memória narrativa. Analise somente o bloco de História abaixo e proponha registros estruturados para que os autores decidam depois. Você NÃO pode criar cânone, alterar o Universo, completar lacunas ou inventar lore. Comentários dos autores não fazem parte deste bloco.

Retorne somente JSON válido, sem Markdown, prefácio ou bloco de código, no formato:
{"proposals":[{"proposal_kind":"entity|fact|relation|event|open_thread","title":"...","payload":{},"evidence":"...","explanation":"...","confidence":0.0,"source_anchor":"...","dedupe_key":"..."}]}

Regras de segurança e interpretação:
- Extraia somente informações sustentadas pelo texto. Se algo for apenas uma possibilidade, marque isso no payload como "certainty": "possible_inference" e explique a incerteza; nunca apresente uma inferência como fato explícito.
- Diferencie explicitamente no payload entre "certainty": "explicit_fact" e "certainty": "possible_inference". Prefira não propor uma inferência fraca.
- Não transforme uma menção passageira em uma regra do mundo sem evidência. Não invente nomes, atributos, relações, cronologia ou intenções.
- Uma entidade é uma ficha estável de identidade. Não coloque em entity summary ou attributes ações pontuais, falas, respostas, reações, emoções da cena, humor passageiro, pensamentos, objetivos momentâneos, aparência de um objeto próximo ou acontecimentos do bloco.
- Para uma entidade nova, exija nome ou identidade clara e use payload com entity_type, name, summary, aliases e attributes. entity_type deve ser character, location, faction, organization, power, item, creature, concept ou other.
- Um alias deve ser somente um nome, apelido ou forma textual pela qual a entidade é chamada. Não use descrições como alias. Se não houver alias real, retorne aliases como lista vazia.
- Não ignore uma entidade já conhecida. Se o bloco trouxer identidade, aparência, espécie, origem, ocupação, parentesco, capacidade, alias ou resumo estável novo, use uma proposta entity com o mesmo nome para enriquecer a ficha; não converta esse enriquecimento em fact. Use fact apenas para informação estável que não pertence à identidade da entidade ou para uma afirmação do mundo associada a entity_name.
- Informações temporárias de cena, comportamento observado, falas e acontecimentos não devem ser forçadas para dentro de entity ou fact.
- Para um fato, use payload com entity_name (ou null), statement, certainty e source_kind: "memory_analysis". O fato deve ser estável ou explicitamente apresentado como informação do mundo, não uma ação isolada.
- Para uma relação, use payload com from_entity, to_entity, relation_type, description e certainty. Só proponha uma relação quando o texto sustentar o vínculo, não apenas porque duas entidades apareceram na mesma cena.
- Para um event, registre algo que realmente aconteceu no trecho. Use payload com title, description, event_kind, entities_involved (array de nomes), certainty e source_kind: "memory_analysis". event_kind deve ser action, revelation, conflict, relationship_change, discovery, scene ou other.
- Para um open_thread, registre uma pergunta, mistério, conflito ou objetivo ainda não resolvido. Use payload com title, description, thread_status: "open", entities_involved (array de nomes), certainty e source_kind: "memory_analysis". Não transforme um acontecimento já resolvido em trama aberta.
- Eventos e tramas abertas podem mencionar entidades que ainda não existem no Universo; mantenha os nomes no array entities_involved e não invente fichas para elas.
- evidence deve ser uma citação curta, consecutiva e copiada exatamente do bloco que sustenta a proposta, com no máximo 260 caracteres. Se você não conseguir apontar um trecho que sustente a informação principal, não faça a proposta.
- source_anchor deve ser uma referência curta e útil para localizar o trecho, com no máximo 160 caracteres.
- explanation deve dizer em português, em no máximo 180 caracteres, por que a proposta merece revisão humana e mencionar qualquer incerteza.
- title, explanation e os valores textuais livres do payload devem ser escritos em português brasileiro. Preserve nomes próprios, aliases, identificadores, enums, valores de certainty, source_kind e dedupe_key; evidence e source_anchor devem ser copiados exatamente do bloco original.
- confidence deve ser um número entre 0 e 1, representando a confiança da extração, não uma decisão de canonização.
- dedupe_key deve ser estável, minúsculo e específico, combinando tipo, nome ou título e conteúdo principal; não use o número do bloco como parte da chave. Use a mesma chave para a mesma afirmação em blocos diferentes.
- Se não houver informação nova e sustentada, retorne {"proposals":[]}.
- Não inclua propostas de revisão linguística, formatação ou estilo.
- No máximo ${MEMORY_MAX_PROPOSALS_PER_BLOCK} propostas neste bloco. Priorize entidades novas e enriquecimentos de entidades conhecidas antes de eventos secundários, mas preserve eventos ou tramas claramente relevantes. Mantenha title curto, payload conciso e não repita a evidência inteira dentro do payload.
- Use a mesma dedupe_key para o mesmo evento ou a mesma trama em blocos diferentes: combine o tipo, o título e os nomes das entidades, sem usar o número do bloco. Para eventos, não use a descrição inteira como chave; para open_thread, não use o status como parte principal da chave.

RESUMO DA OBRA:
${summary}

INSTRUÇÕES EDITORIAIS DOS AUTORES:
${instructions}

ENTIDADES JÁ CONHECIDAS — NÃO DUPLIQUE SEM INFORMAÇÃO NOVA:
${knownEntities}

BLOCO ${blockNumber} DE ${totalBlocks}:
${block}`
}

export async function extractMemoryBlock(
  model: string,
  block: string,
  blockNumber: number,
  totalBlocks: number,
  storyContext: string,
  editorialInstructions: string,
  existingEntities: ExistingMemoryEntity[] = [],
): Promise<MemoryExtractionBlockResult> {
  const prompt = buildMemoryExtractionPrompt(
    block,
    blockNumber,
    totalBlocks,
    storyContext,
    editorialInstructions,
    existingEntities,
  )
  const callExtraction = (requestPrompt: string, outputTokens: number) =>
    request<{ response?: string; done_reason?: string }>(
      "/api/generate",
      {
        method: "POST",
        body: JSON.stringify({
          model,
          prompt: requestPrompt,
          stream: false,
          think: false,
          format: "json",
          options: {
            num_predict: outputTokens,
            temperature: 0.1,
            num_ctx: MEMORY_EXTRACTION_CONTEXT_TOKENS,
          },
        }),
      },
      MEMORY_EXTRACTION_TIMEOUT_MS,
    )

  let raw = await callExtraction(prompt, MEMORY_EXTRACTION_OUTPUT_TOKENS)
  if (raw.done_reason === "length") {
    raw = await callExtraction(
      `${prompt}\n\nMODO COMPACTO DE RECUPERAÇÃO: retorne no máximo uma proposta realmente nova. Use um payload mínimo com apenas os campos exigidos para o tipo. evidence deve ter no máximo 240 caracteres, source_anchor no máximo 80 caracteres e explanation no máximo 160 caracteres. Se não conseguir completar o JSON, retorne {"proposals":[]}.`,
      2048,
    )
  }

  if (raw.done_reason === "length") {
    throw new OllamaError(
      `O Ollama atingiu o limite de saída ao analisar o bloco ${blockNumber} de ${totalBlocks}.`,
      "OLLAMA_OUTPUT_LIMIT",
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.response ?? "{}")
  } catch {
    throw new OllamaError(
      `A resposta do Ollama para a memória do bloco ${blockNumber} não veio em JSON válido.`,
      "OLLAMA_INVALID_JSON",
    )
  }

  const parsedObject = asObject(parsed)
  const rawProposals = parsedObject.proposals
  const proposals = Array.isArray(rawProposals)
    ? rawProposals
        .map((proposal: unknown) => normalizedMemoryProposal(proposal, block))
        .filter((proposal): proposal is MemoryProposalRaw => Boolean(proposal))
        .slice(0, MEMORY_MAX_PROPOSALS_PER_BLOCK)
    : []

  return {
    proposals,
    done_reason: raw.done_reason,
  }
}

export type MemoryProposalTranslation = {
  title: string
  explanation: string
  payload: Record<string, unknown>
}

const MEMORY_TRANSLATION_OUTPUT_TOKENS = 3072
const MEMORY_TRANSLATION_TIMEOUT_MS = 180000

export function buildMemoryProposalTranslationPrompt(
  proposalKind: MemoryProposalRaw["proposal_kind"],
  title: string,
  payload: Record<string, unknown>,
  explanation: string,
) {
  return `Traduza os campos explicativos desta proposta de memória narrativa para português brasileiro. Não reanalise a história, não crie informação e não altere o sentido.

Retorne somente JSON válido, sem Markdown, exatamente neste formato:
{"title":"...","explanation":"...","payload":{}}

Regras obrigatórias:
- Traduza apenas linguagem natural. Preserve a estrutura do objeto, as chaves, tipos, números, booleanos e arrays.
- Preserve exatamente nomes próprios, nomes de entidades, aliases, identificadores, valores de entity_type, certainty, source_kind, relation_type e qualquer código ou enum.
- Se title for apenas o nome de uma entidade ou relação, mantenha-o sem tradução. Traduza title somente quando ele for uma descrição comum.
- Traduza summary, statement, description, background, personality, actions e outros valores descritivos livres do payload, mantendo nomes próprios dentro das frases.
- Não traduza nem reescreva evidências, âncoras, citações, nomes de personagens ou trechos que funcionem como identificadores.
- Não acrescente comentários, campos, inferências ou justificativas novas.
- proposta_kind: ${proposalKind}

TITLE:
${title}

EXPLANATION:
${explanation}

PAYLOAD JSON:
${JSON.stringify(payload)}`
}

export async function translateMemoryProposalToPortuguese(
  model: string,
  proposal: Pick<MemoryProposalRaw, "proposal_kind" | "title" | "payload" | "explanation">,
): Promise<MemoryProposalTranslation> {
  const raw = await request<{ response?: string; done_reason?: string }>(
    "/api/generate",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: buildMemoryProposalTranslationPrompt(
          proposal.proposal_kind,
          proposal.title,
          proposal.payload,
          proposal.explanation,
        ),
        stream: false,
        think: false,
        format: "json",
        options: {
          num_predict: MEMORY_TRANSLATION_OUTPUT_TOKENS,
          temperature: 0.1,
          num_ctx: AI_INSTRUCTIONS_CONTEXT_TOKENS,
        },
      }),
    },
    MEMORY_TRANSLATION_TIMEOUT_MS,
  )

  if (raw.done_reason === "length")
    throw new OllamaError(
      "O Ollama atingiu o limite ao traduzir a proposta.",
      "OLLAMA_OUTPUT_LIMIT",
    )

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.response ?? "{}")
  } catch {
    throw new OllamaError("A tradução da proposta não veio em JSON válido.", "OLLAMA_INVALID_JSON")
  }
  const value = asObject(parsed)
  const payloadValue = value.payload
  if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue))
    throw new OllamaError(
      "A tradução da proposta retornou um payload inválido.",
      "OLLAMA_INVALID_JSON",
    )
  const translatedPayload = payloadValue as Record<string, unknown>
  const missingPayloadKeys = Object.keys(proposal.payload).filter(
    (key) => !(key in translatedPayload),
  )
  if (missingPayloadKeys.length)
    throw new OllamaError(
      "A tradução da proposta omitiu dados estruturados existentes.",
      "OLLAMA_INVALID_JSON",
    )
  const translatedTitle = typeof value.title === "string" ? value.title.trim() : ""
  const translatedExplanation =
    typeof value.explanation === "string" ? value.explanation.trim() : ""
  if (!translatedTitle || !translatedExplanation)
    throw new OllamaError(
      "A tradução da proposta retornou campos incompletos.",
      "OLLAMA_INVALID_JSON",
    )

  return {
    title: translatedTitle,
    explanation: translatedExplanation,
    payload: translatedPayload,
  }
}

function mergeTextValues(values: string[], maxLength: number) {
  const unique = values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter(
      (value, index, items) =>
        items.findIndex((item) => normalizePart(item) === normalizePart(value)) === index,
    )
  return unique.join("\n\n").slice(0, maxLength)
}

function mergeEntityPayload(
  basePayload: Record<string, unknown>,
  incomingPayload: Record<string, unknown>,
) {
  const merged: Record<string, unknown> = { ...basePayload }
  const conflicts: string[] = []

  const baseAliases = Array.isArray(basePayload.aliases) ? basePayload.aliases : []
  const incomingAliases = Array.isArray(incomingPayload.aliases) ? incomingPayload.aliases : []
  const aliases = [...baseAliases, ...incomingAliases]
    .map((alias) => String(alias).trim())
    .filter(Boolean)
    .filter(
      (alias, index, items) =>
        items.findIndex((item) => normalizePart(item) === normalizePart(alias)) === index,
    )
    .slice(0, 8)
  if (aliases.length) merged.aliases = aliases

  const baseSummary = typeof basePayload.summary === "string" ? basePayload.summary : ""
  const incomingSummary = typeof incomingPayload.summary === "string" ? incomingPayload.summary : ""
  if (incomingSummary && !normalizePart(baseSummary).includes(normalizePart(incomingSummary))) {
    merged.summary = mergeTextValues([baseSummary, incomingSummary], 420)
  }

  const baseEntityType = String(basePayload.entity_type ?? "").trim()
  const incomingEntityType = String(incomingPayload.entity_type ?? "").trim()
  if (!baseEntityType && incomingEntityType) {
    merged.entity_type = incomingEntityType
  } else if (
    baseEntityType &&
    incomingEntityType &&
    normalizePart(baseEntityType) !== normalizePart(incomingEntityType)
  ) {
    conflicts.push("entity_type")
  }

  const baseAttributes = asObject(basePayload.attributes)
  const incomingAttributes = asObject(incomingPayload.attributes)
  const mergedAttributes: Record<string, unknown> = { ...baseAttributes }
  Object.entries(incomingAttributes).forEach(([key, incomingValue]) => {
    if (!(key in mergedAttributes)) {
      mergedAttributes[key] = incomingValue
      return
    }
    const currentValue = mergedAttributes[key]
    if (JSON.stringify(currentValue) === JSON.stringify(incomingValue)) return
    if (Array.isArray(currentValue) && Array.isArray(incomingValue)) {
      mergedAttributes[key] = [...currentValue, ...incomingValue].filter(
        (value, index, items) =>
          items.findIndex((item) => JSON.stringify(item) === JSON.stringify(value)) === index,
      )
      return
    }
    mergedAttributes[key] = [currentValue, incomingValue].filter(
      (value, index, items) =>
        items.findIndex((item) => JSON.stringify(item) === JSON.stringify(value)) === index,
    )
    conflicts.push(key)
  })
  merged.attributes = mergedAttributes

  return { payload: merged, conflicts }
}

export function memoryProposalKeyBrowser(item: MemoryProposalRaw) {
  const payload = asObject(item.payload)
  if (item.proposal_kind === "entity") {
    return ["entity", normalizeMemoryKey(String(payload.name ?? item.title))].join("|")
  }
  if (item.proposal_kind === "fact") {
    return [
      "fact",
      normalizeMemoryKey(String(payload.entity_name ?? "")),
      normalizeMemoryKey(String(payload.statement ?? item.title)),
    ].join("|")
  }
  if (item.proposal_kind === "relation") {
    return [
      "relation",
      normalizeMemoryKey(String(payload.from_entity ?? "")),
      normalizeMemoryKey(String(payload.relation_type ?? item.title)),
      normalizeMemoryKey(String(payload.to_entity ?? "")),
    ].join("|")
  }
  const involved = Array.isArray(payload.entities_involved)
    ? payload.entities_involved
        .map((name) => normalizeMemoryKey(String(name)))
        .sort()
        .join(",")
    : ""
  return [item.proposal_kind, normalizeMemoryKey(item.title), involved].filter(Boolean).join("|")
}

export function mergeMemoryProposalsBrowser(
  base: MemoryProposalRaw,
  incoming: MemoryProposalRaw,
): MemoryProposalRaw {
  if (base.proposal_kind !== incoming.proposal_kind) return base

  let payload = base.payload
  let conflicts: string[] = []
  if (base.proposal_kind === "entity") {
    const merged = mergeEntityPayload(base.payload, incoming.payload)
    payload = merged.payload
    conflicts = merged.conflicts
  } else if (base.proposal_kind === "event" || base.proposal_kind === "open_thread") {
    const baseDescription =
      typeof base.payload.description === "string" ? base.payload.description : ""
    const incomingDescription =
      typeof incoming.payload.description === "string" ? incoming.payload.description : ""
    const baseEntities = Array.isArray(base.payload.entities_involved)
      ? base.payload.entities_involved
      : []
    const incomingEntities = Array.isArray(incoming.payload.entities_involved)
      ? incoming.payload.entities_involved
      : []
    const entities = [...baseEntities, ...incomingEntities]
      .map((name) => String(name).trim())
      .filter(Boolean)
      .filter(
        (name, index, names) =>
          names.findIndex((item) => normalizePart(item) === normalizePart(name)) === index,
      )
      .slice(0, 12)
    payload = {
      ...base.payload,
      description: mergeTextValues([baseDescription, incomingDescription], 1200),
      entities_involved: entities,
    }
    const baseStatus = String(base.payload.thread_status ?? "")
    const incomingStatus = String(incoming.payload.thread_status ?? "")
    if (
      base.proposal_kind === "open_thread" &&
      baseStatus &&
      incomingStatus &&
      baseStatus !== incomingStatus
    ) {
      conflicts.push("thread_status")
    }
    const baseEventKind = String(base.payload.event_kind ?? "")
    const incomingEventKind = String(incoming.payload.event_kind ?? "")
    if (
      base.proposal_kind === "event" &&
      baseEventKind &&
      incomingEventKind &&
      baseEventKind !== incomingEventKind
    ) {
      conflicts.push("event_kind")
    }
  }

  const conflictNote = conflicts.length
    ? ` Conflito para decisão humana nos campos: ${conflicts.join(", ")}.`
    : ""
  const explanation = mergeTextValues(
    [base.explanation, incoming.explanation, conflictNote],
    MEMORY_EXPLANATION_CHARS,
  )
  const merged = {
    ...base,
    payload,
    evidence: mergeTextValues([base.evidence, incoming.evidence], 900),
    explanation,
    confidence: Math.max(base.confidence, incoming.confidence),
    source_anchor: mergeTextValues([base.source_anchor, incoming.source_anchor], 320),
  }

  return { ...merged, dedupe_key: memoryProposalKeyBrowser(merged) }
}


export type CanonReconciliationAiResult = {
  proposals: unknown[]
  done_reason?: string
}

function reconciliationContextJson(context: CanonicalMemoryContext) {
  const compact = {
    entities: context.entities.slice(0, 160),
    facts: context.facts.slice(0, 240),
    relations: context.relations.slice(0, 240),
    events: (context.events ?? []).slice(0, 160),
    open_threads: (context.openThreads ?? []).slice(0, 160),
    approved_sources: context.approvedSources ?? [],
  }
  return JSON.stringify(compact)
}

export function buildCanonReconciliationPrompt(
  context: CanonicalMemoryContext,
  deterministicCandidates: unknown[] = [],
) {
  const contextJson = reconciliationContextJson(context).slice(0, 115000)
  const candidatesJson = JSON.stringify(deterministicCandidates.slice(0, 80)).slice(0, 24000)

  return `Você é o Canon Reconciler de um Universo ficcional. Analise somente consequências estruturais diretamente sustentadas pelo cânone fornecido. Você NÃO está escrevendo a história, não está criando lore e não pode alterar o cânone. Sua saída será uma lista de propostas pendentes para revisão humana.

Retorne somente JSON válido neste formato:
{"schema_version":"universe-proposal-v5","proposals":[{"proposal_kind":"entity|fact|relation|event|open_thread","operation":"create|update|resolve|merge|archive","title":"...","target":{},"payload":{},"basis":[{"record_type":"fact","record_id":"UUID_EXISTENTE","role":"primary|supporting|conflict"}],"evidence_kind":"canon_record","evidence":"...","explanation":"...","certainty":"direct_derivation|possible_inference","confidence":0.0,"source_anchor":"...","dedupe_key":"..."}]}

Regras obrigatórias:
- Proponha somente consequências diretamente derivadas de registros canônicos presentes no CONTEXTO. Retorne proposals: [] quando não houver consequência estrutural segura.
- Nunca invente UUID. Só use IDs existentes no contexto e em basis/target.
- Não invente nomes, poderes, motivações, relações românticas, cronologia ou resolução de mistérios por teoria.
- Uma inferência possível deve usar certainty=possible_inference e nunca deve ser aplicada automaticamente; prefira não propor inferências fracas.
- Para relação, use payload.relation_type controlado: friend_of, sibling_of, parent_of, child_of, enemy_of, allied_with, member_of, owns, equipped_with, has_power, located_in, created_by, uses, associated_with ou other.
- Para posse ou equipamento, não trate uma ação temporária como posse permanente. Para perda, prefira relation_status=former ou uma atualização histórica; nunca apague a relação.
- Se um item, poder ou personagem for necessário para uma consequência diretamente sustentada e não existir, proponha entity/create com knowledge_status=provisional e atributos mínimos. Não invente detalhes.
- Se uma thread aberta for respondida diretamente, proponha open_thread/resolve com target.record_id da thread e resolution.resolved_by referenciando os fatos/eventos usados. Similaridade temática não basta.
- Se dois fatos parecerem conflitantes, proponha um alerta estruturado para revisão humana sem decidir qual é verdadeiro. Não arquive nenhum fato automaticamente.
- Preserve a normalização: equipamentos, poderes, afiliações e família devem ser relações, não arrays dentro de entity.attributes.
- Toda proposta deve ter basis com referências aos registros do contexto, evidence curta e fiel ao registro canônico, explanation curta, source_anchor e dedupe_key estável.
- Nunca proponha uma alteração semanticamente equivalente a uma relação, entidade, evento ou thread já existente, salvo quando a operação for update, resolve, archive ou merge.
- O campo confidence é a confiança da análise, não canonização.

CONTEXTO CANÔNICO V5:
${contextJson}

CANDIDATOS DETERMINÍSTICOS PARA VALIDAR OU COMPLEMENTAR:
${candidatesJson}

Se os candidatos já cobrirem todas as consequências diretas, retorne somente as propostas adicionais que estejam faltando.`
}

export async function reconcileCanonWithOllama(
  model: string,
  context: CanonicalMemoryContext,
  deterministicCandidates: unknown[] = [],
): Promise<CanonReconciliationAiResult> {
  const raw = await request<{ response?: string; done_reason?: string }>(
    "/api/generate",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: buildCanonReconciliationPrompt(context, deterministicCandidates),
        stream: false,
        think: false,
        format: "json",
        options: {
          num_predict: 6144,
          temperature: 0.1,
          num_ctx: AI_INSTRUCTIONS_CONTEXT_TOKENS,
        },
      }),
    },
    600000,
  )

  if (raw.done_reason === "length")
    throw new OllamaError(
      "O Ollama atingiu o limite ao analisar as consequências do cânone.",
      "OLLAMA_OUTPUT_LIMIT",
    )

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.response ?? "{}")
  } catch {
    throw new OllamaError(
      "A resposta do Canon Reconciler não veio em JSON válido.",
      "OLLAMA_INVALID_JSON",
    )
  }

  const value = asObject(parsed)
  const proposals = Array.isArray(value.proposals) ? value.proposals : []
  return { proposals, done_reason: raw.done_reason }
}

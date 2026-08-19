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
) {
  const instructions = editorialInstructions.trim()
    ? `INSTRUÇÕES EDITORIAIS DOS AUTORES:\n${editorialInstructions.trim()}`
    : "INSTRUÇÕES EDITORIAIS DOS AUTORES:\nNenhuma instrução adicional foi informada."

  return `Revise somente o bloco abaixo com postura conservadora e respeitando o gênero e o contexto da obra. O contexto foi fornecido pelos autores e serve como orientação editorial, não como texto para copiar.

RESUMO DA OBRA:
${storyContext || "Não informado pelos autores."}

${instructions}

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
): Promise<ReviewBlockResult> {
  const raw = await request<{ response?: string; done_reason?: string }>(
    "/api/generate",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: reviewPrompt(block, blockNumber, totalBlocks, storyContext, editorialInstructions),
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

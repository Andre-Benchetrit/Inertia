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
const REVIEW_OUTPUT_TOKENS = 2048

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

function normalizeCompileSource(rows: CompileSourceRow[]) {
  return rows
    .filter(
      (row) =>
        row.message_type === "story" && row.content && row.content.trim() && row.content.trim(),
    )
    .map((row) => ({
      id: row.id,
      author_id: row.author_id,
      sequence_number: row.sequence_number,
      created_at: row.created_at,
      content: row.content!.trim(),
    }))
    .sort((left, right) => left.sequence_number - right.sequence_number)
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

function normalizePart(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR")
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
) {
  return `Revise somente o bloco abaixo com postura conservadora e respeitando o gênero e o contexto da obra. O contexto foi fornecido pelos autores e serve como orientação editorial, não como texto para copiar.

CONTEXTO DA OBRA:
${storyContext || "Não informado pelos autores."}

O texto usa Markdown editorial para leitura em estilo Wattpad: ## indica título, linhas em branco indicam parágrafos, **texto** indica negrito, *texto* indica itálico e --- indica mudança de cena. Não trate esses marcadores como erros. Não corrija ação exagerada, onomatopeias, humor, linguagem coloquial, metáforas fortes ou escolhas típicas de ficção científica apenas por serem ousadas. Só sugira mudança de estilo quando houver um problema real de clareza, coerência ou adequação ao contexto fornecido.

Procure problemas reais de gramática, coerência, continuidade e oportunidades pontuais de organização editorial. Sugira estilo apenas quando necessário. Não reescreva o texto inteiro e não aplique nenhuma sugestão automaticamente. Retorne somente JSON válido com uma chave suggestions contendo no máximo ${REVIEW_MAX_SUGGESTIONS_PER_BLOCK} objetos. Cada objeto deve ter suggestion_type (grammar, style, coherence, continuity ou editorial), severity (low, medium ou high), explanation, original_text, suggested_text e anchor. original_text deve ser um trecho inteiro e consecutivo do bloco, preservando exatamente os espaços e quebras de linha presentes no texto. Não misture trechos separados nem inclua texto de outro parágrafo. suggested_text deve substituir exatamente original_text e pode conter Markdown editorial. Se não houver problema relevante, retorne uma lista vazia.

BLOCO ${blockNumber} DE ${totalBlocks}:
${block}`
}

export async function reviewBlockLocal(
  model: string,
  block: string,
  blockNumber: number,
  totalBlocks: number,
  storyContext: string,
): Promise<{ suggestions: ReviewSuggestion[]; done_reason?: string }> {
  const raw = await request<{ response?: string; done_reason?: string }>(
    "/api/generate",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: reviewPrompt(block, blockNumber, totalBlocks, storyContext),
        stream: false,
        think: false,
        format: "json",
        options: { num_predict: REVIEW_OUTPUT_TOKENS, temperature: 0.2 },
      }),
    },
    60000,
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

  const suggestions = Array.isArray((parsed as { suggestions?: unknown })?.suggestions)
    ? (parsed as { suggestions: unknown[] }).suggestions
    : []
  return { suggestions: normalizeSuggestions(suggestions), done_reason: raw.done_reason }
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

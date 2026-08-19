import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
const allowedTypes = new Set(["grammar", "style", "coherence", "continuity", "editorial"])
const allowedSeverities = new Set(["low", "medium", "high"])
const REVIEW_BLOCK_CHARS = 9000
const REVIEW_MAX_SUGGESTIONS_PER_BLOCK = 4
const REVIEW_OUTPUT_TOKENS = 2048
const REVIEW_BLOCK_TIMEOUT_MS = 60000

type ReviewSuggestion = {
  suggestion_type: string
  severity: string
  explanation: string
  original_text: string | null
  suggested_text: string | null
  anchor: string | null
}

type ReviewResult =
  | { ok: true; suggestions: ReviewSuggestion[] }
  | { ok: false; code: string; error: string; status: number }

function normalizePart(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR")
}

function suggestionKey(item: {
  suggestion_type: string
  original_text: string | null
  suggested_text: string | null
  anchor: string | null
}) {
  const original = normalizePart(item.original_text)
  const suggested = normalizePart(item.suggested_text)
  return [item.suggestion_type, original || normalizePart(item.anchor), suggested].join("|")
}

function splitIntoBlocks(text: string) {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const blocks: string[] = []
  let current = ""

  for (const paragraph of paragraphs) {
    const parts =
      paragraph.length > REVIEW_BLOCK_CHARS
        ? Array.from({ length: Math.ceil(paragraph.length / REVIEW_BLOCK_CHARS) }, (_, index) =>
            paragraph.slice(index * REVIEW_BLOCK_CHARS, (index + 1) * REVIEW_BLOCK_CHARS),
          )
        : [paragraph]
    for (const part of parts) {
      const candidate = current ? `${current}\n\n${part}` : part
      if (current && candidate.length > REVIEW_BLOCK_CHARS) {
        blocks.push(current)
        current = part
      } else {
        current = candidate
      }
    }
  }
  if (current) blocks.push(current)
  return blocks.length ? blocks : [text.slice(0, REVIEW_BLOCK_CHARS)]
}

function normalizeSuggestions(rawSuggestions: unknown[]): ReviewSuggestion[] {
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
        allowedTypes.has(item.suggestion_type) &&
        allowedSeverities.has(item.severity) &&
        item.explanation.trim(),
    )
    .slice(0, REVIEW_MAX_SUGGESTIONS_PER_BLOCK)
}

async function reviewBlock(
  model: string,
  block: string,
  blockNumber: number,
  totalBlocks: number,
  storyContext: string,
): Promise<ReviewResult> {
  const prompt = `Você é um revisor editorial de fidelidade, não um censor, crítico de conteúdo ou coautor.

Sua função é revisar somente o bloco fornecido, corrigindo problemas objetivos e apontando possíveis dificuldades de clareza ou continuidade sem descaracterizar o estilo, o tom, os personagens, o universo ou as escolhas criativas dos autores.

Neste prompt, “revisão conservadora” significa alterar o mínimo possível da obra original. Não significa tornar o conteúdo mais comportado, realista, moderado, formal ou socialmente neutro.

CONTEXTO DA OBRA:
${storyContext || "Não informado pelos autores."}

O texto usa Markdown editorial para leitura em estilo Wattpad: ## indica título, linhas em branco indicam parágrafos, **texto** indica negrito, *texto* indica itálico e --- indica mudança de cena. Não trate esses marcadores como erros. Não corrija ação exagerada, onomatopeias, humor, linguagem coloquial, metáforas fortes ou escolhas típicas de ficção científica apenas por serem ousadas. Só sugira mudança de estilo quando houver um problema real de clareza, coerência ou adequação ao contexto fornecido.

Procure problemas reais de gramática, coerência, continuidade e oportunidades pontuais de organização editorial. Sugira estilo apenas quando necessário. Não reescreva o texto inteiro e não aplique nenhuma sugestão automaticamente. Retorne somente JSON válido com uma chave suggestions contendo no máximo ${REVIEW_MAX_SUGGESTIONS_PER_BLOCK} objetos. Cada objeto deve ter suggestion_type (grammar, style, coherence, continuity ou editorial), severity (low, medium ou high), explanation, original_text, suggested_text e anchor. original_text deve ser um trecho inteiro e consecutivo do bloco, preservando exatamente os espaços e quebras de linha presentes no texto. Não misture trechos separados nem inclua texto de outro parágrafo. suggested_text deve substituir exatamente original_text e pode conter Markdown editorial. Se não houver problema relevante, retorne uma lista vazia.

BLOCO ${blockNumber} DE ${totalBlocks}:
${block}`

  let response: Response
  try {
    response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        think: false,
        format: "json",
        options: { num_predict: REVIEW_OUTPUT_TOKENS, temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(REVIEW_BLOCK_TIMEOUT_MS),
    })
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError"
    return {
      ok: false,
      code: isTimeout ? "OLLAMA_REVIEW_BLOCK_TIMEOUT" : "OLLAMA_UNREACHABLE",
      error: isTimeout
        ? `O Ollama demorou mais de 60 segundos para revisar o bloco ${blockNumber} de ${totalBlocks}. Reduza o tamanho da Fonte ou use um modelo mais rápido.`
        : `Não foi possível alcançar o Ollama em ${OLLAMA_URL}. Abra o Ollama e tente novamente.`,
      status: 504,
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      code: response.status === 404 ? "OLLAMA_MODEL_NOT_FOUND" : "OLLAMA_HTTP_ERROR",
      error:
        response.status === 404
          ? `O modelo "${model}" não foi encontrado no Ollama. Execute: ollama pull ${model}`
          : `Ollama respondeu com HTTP ${response.status} ao revisar o bloco ${blockNumber}.`,
      status: 502,
    }
  }

  const raw = (await response.json()) as { response?: string; done_reason?: string }
  if (raw.done_reason === "length")
    return {
      ok: false,
      code: "OLLAMA_OUTPUT_LIMIT",
      error: `O Ollama atingiu o limite de saída ao revisar o bloco ${blockNumber} de ${totalBlocks}. O bloco não foi salvo.`,
      status: 502,
    }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.response ?? "{}")
  } catch {
    return {
      ok: false,
      code: "OLLAMA_INVALID_JSON",
      error: `A resposta do Ollama para o bloco ${blockNumber} não veio em JSON válido.`,
      status: 502,
    }
  }

  const suggestions = Array.isArray((parsed as { suggestions?: unknown })?.suggestions)
    ? (parsed as { suggestions: unknown[] }).suggestions
    : []
  return { ok: true, suggestions: normalizeSuggestions(suggestions) }
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    chapterId?: string
    versionId?: string
    model?: string
  } | null
  const chapterId = body?.chapterId?.trim()
  const versionId = body?.versionId?.trim()
  const model = body?.model?.trim()
  if (!chapterId || !versionId || !model)
    return NextResponse.json(
      { error: "Capítulo, versão e modelo são obrigatórios" },
      { status: 400 },
    )

  const { data: version, error: versionError } = await supabase
    .from("chapter_versions")
    .select("id,chapter_id,content,review_status")
    .eq("id", versionId)
    .eq("chapter_id", chapterId)
    .maybeSingle()
  if (versionError) return NextResponse.json({ error: versionError.message }, { status: 400 })
  if (!version) return NextResponse.json({ error: "Versão não encontrada" }, { status: 404 })

  const { data: chapter, error: chapterError } = await supabase
    .from("chapters")
    .select("book_id")
    .eq("id", chapterId)
    .maybeSingle()
  if (chapterError) return NextResponse.json({ error: chapterError.message }, { status: 400 })
  if (!chapter?.book_id)
    return NextResponse.json({ error: "Capítulo não encontrado" }, { status: 404 })

  const { data: book, error: bookError } = await supabase
    .from("books")
    .select("title,description")
    .eq("id", chapter.book_id)
    .maybeSingle()
  if (bookError) return NextResponse.json({ error: bookError.message }, { status: 400 })
  const storyContext = [
    book?.title ? `Título: ${book.title}` : "",
    book?.description ? `Descrição e possível gênero: ${book.description}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  const { data: startData, error: startError } = await supabase.rpc(
    "start_chapter_version_review",
    { target_version_id: versionId, requested_model: model },
  )
  if (startError)
    return NextResponse.json(
      {
        code: "REVIEW_LOCK_UNAVAILABLE",
        error: `Não foi possível iniciar o controle de revisão desta versão. Aplique a migration 0007_review_runs.sql no Supabase. Detalhe: ${startError.message}`,
      },
      { status: 400 },
    )
  const started = (Array.isArray(startData) ? startData[0] : startData) as {
    acquired?: boolean
    review_status?: string
  } | null
  if (!started?.acquired) {
    if (started?.review_status === "completed")
      return NextResponse.json(
        {
          code: "REVIEW_ALREADY_COMPLETED",
          error: "Esta versão já recebeu uma revisão. Crie uma nova versão para revisar novamente.",
        },
        { status: 409 },
      )
    return NextResponse.json(
      {
        code: "REVIEW_IN_PROGRESS",
        error: "Esta versão já está sendo revisada. Aguarde a conclusão antes de tentar novamente.",
      },
      { status: 409 },
    )
  }

  let reviewCompleted = false
  try {
    const blocks = splitIntoBlocks(String(version.content).slice(0, 180000))
    const generated: ReviewSuggestion[] = []
    for (let index = 0; index < blocks.length; index += 1) {
      const result = await reviewBlock(model, blocks[index], index + 1, blocks.length, storyContext)
      if (!result.ok)
        return NextResponse.json(
          { code: result.code, error: result.error, block: index + 1, total_blocks: blocks.length },
          { status: result.status },
        )
      generated.push(...result.suggestions)
    }

    const { data: existing, error: existingError } = await supabase
      .from("chapter_suggestions")
      .select("suggestion_type,original_text,suggested_text,anchor")
      .eq("chapter_id", chapterId)
      .eq("version_id", versionId)
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 400 })

    const seen = new Set((existing ?? []).map((item) => suggestionKey(item)))
    const unique = generated.filter((item) => {
      const key = suggestionKey(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    if (unique.length) {
      const { error } = await supabase.from("chapter_suggestions").insert(
        unique.map((item) => ({
          ...item,
          chapter_id: chapterId,
          version_id: versionId,
          created_by: user.id,
        })),
      )
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    const { error: completeError } = await supabase.rpc("complete_chapter_version_review", {
      target_version_id: versionId,
      processed_blocks: blocks.length,
      saved_suggestions: unique.length,
      requested_model: model,
    })
    if (completeError)
      return NextResponse.json(
        {
          code: "REVIEW_COMPLETE_FAILED",
          error: `As sugestões foram processadas, mas não foi possível concluir o estado da revisão. ${completeError.message}`,
        },
        { status: 400 },
      )
    reviewCompleted = true
    return NextResponse.json({
      suggestions: unique,
      blocks_processed: blocks.length,
      skipped_duplicates: generated.length - unique.length,
      context_used: Boolean(storyContext),
    })
  } finally {
    if (!reviewCompleted)
      await supabase.rpc("reset_chapter_version_review", { target_version_id: versionId })
  }
}

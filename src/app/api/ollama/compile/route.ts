import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
const MAX_SOURCE = 180000

function normalizeSource(
  rows: Array<{
    id: string
    author_id: string
    content: string | null
    message_type: string
    sequence_number: number
    created_at: string
  }>,
) {
  return rows
    .filter((row) => row.message_type === "story" && row.content && row.content.trim())
    .map((row) => ({
      id: row.id,
      author_id: row.author_id,
      sequence_number: row.sequence_number,
      created_at: row.created_at,
      content: row.content!.trim(),
    }))
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as {
    chapterId?: string
    model?: string
  } | null
  const chapterId = body?.chapterId?.trim()
  const model = body?.model?.trim()
  if (!chapterId || !model)
    return NextResponse.json({ error: "Capítulo e modelo são obrigatórios" }, { status: 400 })

  const { data: messages, error: sourceError } = await supabase.rpc("get_chapter_messages", {
    target_chapter_id: chapterId,
  })
  if (sourceError) return NextResponse.json({ error: sourceError.message }, { status: 400 })
  const source = normalizeSource(
    (messages ?? []) as Array<{
      id: string
      author_id: string
      content: string | null
      message_type: string
      sequence_number: number
      created_at: string
    }>,
  ).sort((a, b) => a.sequence_number - b.sequence_number)
  if (!source.length)
    return NextResponse.json(
      { error: "Não há conteúdo de História para compilar" },
      { status: 422 },
    )

  const sourceText = source
    .map((row) => row.content)
    .join("\n\n")
    .slice(0, MAX_SOURCE)
  const outputTokens = Math.min(2048, Math.max(512, Math.ceil(sourceText.length / 3)))
  const prompt = `Você é um editor de ficção e formatador editorial para leitura em estilo Wattpad. Compile apenas o conteúdo de História abaixo, preservando fatos, voz, ordem e intenção. Não invente acontecimentos, personagens, lugares ou diálogos; não acrescente informações e não inclua Comentários dos autores. Retorne somente o manuscrito final em Markdown editorial, sem análise, prefácio, rótulos ou bloco de código.\n\nRegras de formatação:\n- Separe todos os parágrafos com uma linha em branco. Una mensagens que forem continuação da mesma frase ou parágrafo e crie uma nova quebra quando houver mudança real de ideia, cena ou ritmo.\n- Coloque cada fala ou bloco de diálogo em seu próprio parágrafo, preservando o sentido e a voz.\n- Remova os números de sequência das mensagens, como #1 ou #24.\n- Use ## para um título curto de capítulo ou de seção somente quando houver uma mudança clara de cena ou uma abertura que comporte título; se não houver base suficiente, não crie título. Um título pode ser editorialmente provisório, mas não pode inventar fatos.\n- Use **negrito** com moderação para uma ênfase narrativa realmente forte e *itálico* para pensamentos, palavras estrangeiras ou uma ênfase leve. Não formate cada frase.\n- Use --- apenas para uma mudança clara de cena.\n- Nunca use HTML, links, emojis, listas ou comentários sobre o próprio processo.\n\nFONTE:\n${sourceText}`
  let ollamaResponse: Response
  try {
    ollamaResponse = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        think: false,
        options: { num_predict: outputTokens, temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(180000),
    })
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError"
    return NextResponse.json(
      {
        code: isTimeout ? "OLLAMA_TIMEOUT" : "OLLAMA_UNREACHABLE",
        error: isTimeout
          ? "O Ollama demorou mais de 3 minutos para responder. Tente novamente com uma Fonte menor ou um modelo mais rápido."
          : `Não foi possível alcançar o Ollama em ${OLLAMA_URL}. Abra o Ollama e tente novamente.`,
      },
      { status: 504 },
    )
  }
  if (!ollamaResponse.ok) {
    const errorCode = ollamaResponse.status === 404 ? "OLLAMA_MODEL_NOT_FOUND" : "OLLAMA_HTTP_ERROR"
    return NextResponse.json(
      {
        code: errorCode,
        error:
          ollamaResponse.status === 404
            ? `O modelo "${model}" não foi encontrado no Ollama. Execute: ollama pull ${model}`
            : `Ollama respondeu com HTTP ${ollamaResponse.status}`,
      },
      { status: 502 },
    )
  }
  const generated = (await ollamaResponse.json()) as { response?: string; done_reason?: string }
  if (generated.done_reason === "length")
    return NextResponse.json(
      {
        code: "OLLAMA_OUTPUT_LIMIT",
        error:
          "O Ollama atingiu o limite de saída antes de concluir o manuscrito. Reduza o tamanho da Fonte ou tente novamente com um modelo mais rápido. Nenhuma versão parcial foi salva.",
      },
      { status: 502 },
    )
  const content = generated.response?.trim()
  if (!content)
    return NextResponse.json({ error: "Ollama não retornou um manuscrito" }, { status: 502 })

  const snapshot = source.map((row) => ({
    message_id: row.id,
    author_id: row.author_id,
    sequence_number: row.sequence_number,
    created_at: row.created_at,
    content: row.content,
  }))
  const { data: version, error: versionError } = await supabase.rpc("create_chapter_version", {
    target_chapter_id: chapterId,
    version_content: content,
    version_source_snapshot: snapshot,
    version_provider: "ollama",
    version_model: model,
    version_prompt: "compile-chapter-v3-wattpad-markdown",
  })
  if (versionError) return NextResponse.json({ error: versionError.message }, { status: 400 })
  return NextResponse.json({ version })
}

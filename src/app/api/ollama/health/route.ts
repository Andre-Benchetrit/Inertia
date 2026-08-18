import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json(
      { ok: false, stage: "auth", error: "Não autenticado" },
      { status: 401 },
    )

  const model = new URL(request.url).searchParams.get("model")?.trim() ?? ""
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    })
    if (!response.ok)
      return NextResponse.json(
        { ok: false, stage: "ollama", error: `Ollama respondeu com HTTP ${response.status}` },
        { status: 503 },
      )
    const data = (await response.json()) as { models?: Array<{ name?: string }> }
    const models = (data.models ?? [])
      .map((item) => item.name)
      .filter((name): name is string => Boolean(name))
    const modelAvailable = Boolean(model && models.some((name) => name === model))
    const recommendedModel = models.find((name) => /instruct/i.test(name)) ?? null
    const modelWarning =
      model && /^qwen3(?::|$)/i.test(model) && !/instruct/i.test(model) && recommendedModel
        ? `O modelo "${model}" está respondendo em modo de raciocínio nesta instalação. Para compilar mais rápido, prefira "${recommendedModel}".`
        : null
    return NextResponse.json({
      ok: true,
      stage: "ollama",
      models,
      model,
      modelAvailable,
      recommendedModel,
      modelWarning,
      message: modelAvailable
        ? "Ollama e modelo acessíveis."
        : "Ollama acessível, mas o modelo escolhido não foi encontrado.",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida"
    return NextResponse.json(
      {
        ok: false,
        stage: "ollama",
        error: `Não foi possível alcançar o Ollama em ${OLLAMA_URL}: ${message}`,
      },
      { status: 503 },
    )
  }
}

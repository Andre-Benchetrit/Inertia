export type OllamaModel = {
  name: string
  modified_at?: string
  size?: number
  digest?: string
}

export type OllamaStatus = {
  available: boolean
  models: OllamaModel[]
  error?: string
}

const OLLAMA_URL = "http://localhost:11434"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${OLLAMA_URL}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(4000),
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  if (!response.ok) throw new Error(`Ollama respondeu com HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  try {
    const data = await request<{ models?: OllamaModel[] }>("/api/tags")
    return { available: true, models: data.models ?? [] }
  } catch (error) {
    return {
      available: false,
      models: [],
      error: error instanceof Error ? error.message : "Ollama indisponível",
    }
  }
}

export async function generateWithOllama(
  model: string,
  prompt: string,
  format?: "json",
): Promise<string> {
  const data = await request<{ response?: string }>("/api/generate", {
    method: "POST",
    body: JSON.stringify({ model, prompt, stream: false, ...(format ? { format } : {}) }),
    signal: AbortSignal.timeout(180000),
  })
  return data.response ?? ""
}

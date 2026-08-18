"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
import { WattpadPreview } from "@/lib/wattpad-markdown"

type SourceMessage = {
  id: string
  content: string | null
  message_type: "story" | "author_note"
  sequence_number: number
  created_at: string
}
type Manuscript = { id: string; content: string; updated_at: string }
type ReviewStatus = "not_reviewed" | "running" | "completed"
type Version = {
  id: string
  version_number: number
  content: string
  compilation_provider: string
  model_name: string | null
  prompt_version: string | null
  created_at: string
  review_status?: ReviewStatus
  review_started_at?: string | null
  reviewed_at?: string | null
  review_model_name?: string | null
  review_blocks?: number | null
  review_suggestion_count?: number | null
}
type Suggestion = {
  id: string
  version_id: string | null
  suggestion_type: string
  severity: string
  status: string
  explanation: string
  original_text: string | null
  suggested_text: string | null
  anchor: string | null
  created_at: string
}
type Props = { chapterId: string; messages: SourceMessage[] }
type AppliedChange = {
  suggestionId: string
  versionId: string
  originalText: string
  suggestedText: string
}
type HealthData = {
  ok?: boolean
  modelAvailable?: boolean
  modelWarning?: string | null
  error?: string
}

const stageLabels = {
  idle: "",
  checking: "Verificando Ollama...",
  sending: "Preparando Fonte...",
  waiting: "Compilando com IA (pode levar alguns minutos)...",
  saving: "Salvando versão...",
} as const

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR")
}

function suggestionKey(
  item: Pick<Suggestion, "suggestion_type" | "original_text" | "suggested_text" | "anchor">,
) {
  const original = normalizeText(item.original_text)
  const suggested = normalizeText(item.suggested_text)
  return [item.suggestion_type, original || normalizeText(item.anchor), suggested].join("|")
}

function findFlexibleRange(text: string, needle: string) {
  const source = text.replace(/\r\n?/g, "\n")
  const sought = needle.replace(/\r\n?/g, "\n").trim()
  if (!sought) return null
  const exactIndex = source.indexOf(sought)
  if (exactIndex >= 0)
    return {
      index: exactIndex,
      length: sought.length,
      originalText: source.slice(exactIndex, exactIndex + sought.length),
    }
  const pattern = sought
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+")
  if (!pattern) return null
  const match = new RegExp(pattern).exec(source)
  if (!match || match.index === undefined) return null
  return { index: match.index, length: match[0].length, originalText: match[0] }
}

function suggestionTypeLabel(type: string) {
  return (
    (
      {
        grammar: "Gramática",
        style: "Estilo",
        coherence: "Coerência",
        continuity: "Continuidade",
        editorial: "Editorial",
      } as Record<string, string>
    )[type] ?? type
  )
}

function suggestionSeverityLabel(severity: string) {
  return (
    ({ low: "Baixa", medium: "Média", high: "Alta" } as Record<string, string>)[severity] ??
    severity
  )
}

function suggestionStatusLabel(status: string) {
  if (status === "accepted") return "Proposta aceita e movida para o editor"
  if (status === "rejected") return "Proposta rejeitada"
  if (status === "obsolete") return "Proposta substituída"
  return "Pendente"
}

function reviewStatusLabel(status: ReviewStatus | undefined) {
  if (status === "completed") return "Revisada"
  if (status === "running") return "Revisão em andamento"
  return "Ainda não revisada"
}

function escapeHtml(value: string) {
  return value.replace(/[&<>\"]/g, (character) => {
    if (character === "&") return "&amp;"
    if (character === "<") return "&lt;"
    if (character === ">") return "&gt;"
    return "&quot;"
  })
}

function highlightedEditorHtml(content: string, changes: AppliedChange[]) {
  if (!changes.length) return escapeHtml(content)
  const orderedChanges = [...changes].sort(
    (left, right) => content.indexOf(left.suggestedText) - content.indexOf(right.suggestedText),
  )
  const chunks: string[] = []
  let cursor = 0
  let searchFrom = 0
  orderedChanges.forEach((change) => {
    const index = content.indexOf(change.suggestedText, searchFrom)
    if (index < 0) return
    if (index > cursor) chunks.push(escapeHtml(content.slice(cursor, index)))
    chunks.push(
      `<mark data-suggestion-id="${escapeHtml(change.suggestionId)}" class="relative rounded bg-[#f4dfa1] px-0.5 text-[#36552d]" title="Proposta aplicada — passe o mouse para restaurar">${escapeHtml(change.suggestedText)}<button type="button" data-restore-id="${escapeHtml(change.suggestionId)}" contenteditable="false" class="ml-1 hidden rounded-full bg-[#fffdf8] px-1 text-[10px] text-[#7b302b] shadow-sm hover:inline-flex" aria-label="Restaurar texto original" title="Restaurar texto original">↶</button></mark>`,
    )
    cursor = index + change.suggestedText.length
    searchFrom = cursor
  })
  if (cursor < content.length) chunks.push(escapeHtml(content.slice(cursor)))
  return chunks.join("")
}

function InlineManuscriptEditor({
  content,
  changes,
  onChange,
  onRestore,
}: {
  content: string
  changes: AppliedChange[]
  onChange: (value: string) => void
  onRestore: (change: AppliedChange) => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const renderedSignature = useRef("")
  const signature = `${content}\u0000${changes.map((change) => `${change.suggestionId}:${change.suggestedText}`).join("\u0001")}`

  useEffect(() => {
    if (!editorRef.current || renderedSignature.current === signature) return
    const snapshot = editorRef.current.cloneNode(true) as HTMLElement
    snapshot.querySelectorAll("button").forEach((button) => button.remove())
    const currentText = snapshot.innerText || snapshot.textContent || ""
    if (currentText !== content || !editorRef.current.innerHTML)
      editorRef.current.innerHTML = highlightedEditorHtml(content, changes)
    renderedSignature.current = signature
  }, [changes, content, signature])

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      onInput={(event) => {
        const snapshot = event.currentTarget.cloneNode(true) as HTMLElement
        snapshot.querySelectorAll("button").forEach((button) => button.remove())
        onChange(snapshot.innerText || snapshot.textContent || "")
      }}
      onClick={(event) => {
        const target = event.target as HTMLElement
        const restoreId = target.closest<HTMLElement>("[data-restore-id]")?.dataset.restoreId
        if (!restoreId) return
        event.preventDefault()
        const change = changes.find((item) => item.suggestionId === restoreId)
        if (change) onRestore(change)
      }}
      className="min-h-72 max-h-[70vh] w-full overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-[#d9cfc3] bg-white p-3 font-serif text-[1.05rem] leading-8 outline-none focus:border-[#65735f] [&_mark:hover_button]:inline-flex"
      aria-label="Editor do Manuscrito"
    />
  )
}

export default function EditorialPanel({ chapterId, messages }: Props) {
  const supabase = createSupabaseBrowserClient()
  const [tab, setTab] = useState<"source" | "manuscript">("source")
  const [isExpanded, setIsExpanded] = useState(false)
  const [manuscript, setManuscript] = useState<Manuscript | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selectedVersion, setSelectedVersion] = useState("")
  const [suggestionVersionFilter, setSuggestionVersionFilter] = useState("latest")
  const [model] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (window.localStorage.getItem("inertia:ollama:model") ?? ""),
  )
  const [draft, setDraft] = useState("")
  const [appliedChanges, setAppliedChanges] = useState<AppliedChange[]>([])
  const [manuscriptView, setManuscriptView] = useState<"edit" | "preview">("preview")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [compileProgress, setCompileProgress] = useState(0)
  const [compileStage, setCompileStage] = useState<keyof typeof stageLabels>("idle")
  const [ollamaCheck, setOllamaCheck] = useState("")
  const [reviewing, setReviewing] = useState(false)
  const [reviewStage, setReviewStage] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [importText, setImportText] = useState("")
  const [importFileName, setImportFileName] = useState("")
  const [importing, setImporting] = useState(false)

  const source = useMemo(
    () =>
      messages
        .filter(
          (message) =>
            message.message_type === "story" &&
            message.content &&
            !message.content.trim().startsWith("Mensagem removida"),
        )
        .sort((a, b) => a.sequence_number - b.sequence_number),
    [messages],
  )
  const selectedVersionData = useMemo(
    () => versions.find((version) => version.id === selectedVersion),
    [selectedVersion, versions],
  )
  const visibleSuggestions = useMemo(() => {
    const versionId =
      suggestionVersionFilter === "latest"
        ? versions[0]?.id
        : suggestionVersionFilter === "all"
          ? ""
          : suggestionVersionFilter
    const candidates = suggestions.filter(
      (suggestion) => !versionId || suggestion.version_id === versionId,
    )
    const seen = new Set<string>()
    return candidates.filter((suggestion) => {
      const key = suggestionKey(suggestion)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [suggestionVersionFilter, suggestions, versions])

  const loadEditorial = useCallback(async () => {
    setLoading(true)
    const [manuscriptResult, versionsResult, suggestionsResult] = await Promise.all([
      supabase.rpc("ensure_chapter_manuscript", { target_chapter_id: chapterId }),
      supabase
        .from("chapter_versions")
        .select(
          "id,version_number,content,compilation_provider,model_name,prompt_version,created_at,review_status,review_started_at,reviewed_at,review_model_name,review_blocks,review_suggestion_count",
        )
        .eq("chapter_id", chapterId)
        .order("version_number", { ascending: false }),
      supabase
        .from("chapter_suggestions")
        .select(
          "id,version_id,suggestion_type,severity,status,explanation,original_text,suggested_text,anchor,created_at",
        )
        .eq("chapter_id", chapterId)
        .order("created_at", { ascending: false }),
    ])
    if (manuscriptResult.error) setError(manuscriptResult.error.message)
    else {
      const value = Array.isArray(manuscriptResult.data)
        ? manuscriptResult.data[0]
        : manuscriptResult.data
      setManuscript(value as Manuscript | null)
      setDraft((value as Manuscript | null)?.content ?? "")
      setAppliedChanges([])
    }
    if (versionsResult.error) setError(versionsResult.error.message)
    else {
      const data = (versionsResult.data ?? []) as Version[]
      setVersions(data)
      setSelectedVersion((current) =>
        current && data.some((version) => version.id === current) ? current : data[0]?.id || "",
      )
    }
    if (suggestionsResult.error) setError(suggestionsResult.error.message)
    else setSuggestions((suggestionsResult.data ?? []) as Suggestion[])
    setLoading(false)
  }, [chapterId, supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEditorial()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadEditorial])

  async function importManuscript() {
    const content = importText.trim()
    if (!content) {
      setError("Cole um texto ou selecione um arquivo antes de importar.")
      return
    }
    if (content.length > 2000000) {
      setError("O texto importado excede o limite de 2 milhões de caracteres.")
      return
    }

    setImporting(true)
    setError("")
    setNotice("")
    const result = await supabase.rpc("create_chapter_version", {
      target_chapter_id: chapterId,
      version_content: content,
      version_source_snapshot: {
        type: "manual_import",
        source_name: importFileName || null,
      },
      version_provider: "manual",
      version_model: null,
      version_prompt: "manual-import-v1",
    })

    if (result.error) {
      setError("Não foi possível importar o capítulo: " + result.error.message)
    } else {
      setImportText("")
      setImportFileName("")
      setNotice("Capítulo importado como Manuscrito. A Fonte continua intacta.")
      await loadEditorial()
      setTab("manuscript")
      setManuscriptView("preview")
    }
    setImporting(false)
  }

  async function saveDraft() {
    if (!manuscript) return
    setSaving(true)
    setError("")
    setNotice("")
    const { data: userResult } = await supabase.auth.getUser()
    const { error: updateError } = await supabase
      .from("chapter_manuscripts")
      .update({ content: draft, updated_by: userResult.user?.id ?? null })
      .eq("id", manuscript.id)
    if (updateError) setError(updateError.message)
    else {
      setManuscript({ ...manuscript, content: draft, updated_at: new Date().toISOString() })
      setNotice("Manuscrito salvo.")
    }
    setSaving(false)
  }

  async function compileWithOllama() {
    const activeModel =
      typeof window === "undefined"
        ? model
        : (window.localStorage.getItem("inertia:ollama:model") ?? model)
    if (!activeModel) {
      setError("Selecione um modelo no indicador de IA local antes de compilar.")
      return
    }

    setCompiling(true)
    setCompileProgress(5)
    setCompileStage("checking")
    setError("")
    setNotice("")
    setOllamaCheck("")
    try {
      const healthResponse = await fetch(
        `/api/ollama/health?model=${encodeURIComponent(activeModel)}`,
        { cache: "no-store" },
      )
      const healthData = (await healthResponse.json().catch(() => ({}))) as HealthData
      if (!healthResponse.ok || !healthData.ok)
        throw new Error(
          healthData.error ??
            "Ollama não está acessível. Verifique se ele está rodando em localhost:11434.",
        )
      if (!healthData.modelAvailable)
        throw new Error(
          `Ollama está acessível, mas o modelo "${activeModel}" não foi encontrado. Execute: ollama pull ${activeModel}`,
        )
      if (healthData.modelWarning) throw new Error(healthData.modelWarning)

      setOllamaCheck(`Conexão confirmada: ${activeModel} disponível em localhost:11434.`)
      setCompileProgress(18)
      setCompileStage("sending")
      await new Promise((resolve) => window.setTimeout(resolve, 150))
      setCompileProgress(30)
      setCompileStage("waiting")
      const response = await fetch("/api/ollama/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId, model: activeModel }),
      })
      setCompileProgress(82)
      setCompileStage("saving")
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? "Não foi possível compilar.")

      setCompileProgress(100)
      setNotice("Nova versão compilada com formatação editorial, sem alterar a Fonte.")
      await loadEditorial()
      setTab("manuscript")
      setManuscriptView("preview")
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Falha desconhecida durante a compilação.",
      )
    } finally {
      setCompiling(false)
      setCompileStage("idle")
      window.setTimeout(() => setCompileProgress(0), 400)
    }
  }

  async function reviewWithOllama() {
    const activeModel =
      typeof window === "undefined"
        ? model
        : (window.localStorage.getItem("inertia:ollama:model") ?? model)
    if (!activeModel) {
      setError("Selecione um modelo no indicador de IA local antes de revisar.")
      return
    }
    const versionId = selectedVersion || versions[0]?.id
    const targetVersion = versions.find((version) => version.id === versionId)
    if (!versionId || !targetVersion) {
      setError("Compile uma versão antes de pedir uma revisão.")
      return
    }
    if (targetVersion.review_status === "completed") {
      setError("Esta versão já foi revisada. Crie uma nova versão para pedir outra revisão.")
      return
    }

    setReviewing(true)
    setReviewStage("Preparando a revisão da versão...")
    setError("")
    setNotice("")
    const timer = window.setInterval(
      () =>
        setReviewStage((current) =>
          current.endsWith("...") ? current.slice(0, -3) : `${current}.`,
        ),
      700,
    )
    try {
      setReviewStage("Dividindo o Manuscrito em blocos...")
      await new Promise((resolve) => window.setTimeout(resolve, 250))
      setReviewStage("A IA está revisando os blocos...")
      const response = await fetch("/api/ollama/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId, versionId, model: activeModel }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? "Não foi possível revisar.")
      setReviewStage("Consolidando sugestões...")
      setNotice(
        `Revisão concluída: ${data.blocks_processed ?? 0} bloco(s), ${(data.suggestions ?? []).length} sugestão(ões) nova(s).`,
      )
      await loadEditorial()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha desconhecida durante a revisão.")
    } finally {
      window.clearInterval(timer)
      setReviewing(false)
      setReviewStage("")
    }
  }

  async function rejectSuggestion(id: string) {
    const { data: userResult } = await supabase.auth.getUser()
    const { error: updateError } = await supabase
      .from("chapter_suggestions")
      .update({
        status: "rejected",
        resolved_by: userResult.user?.id ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id)
    if (updateError) setError(updateError.message)
    else
      setSuggestions((items) =>
        items.map((item) => (item.id === id ? { ...item, status: "rejected" } : item)),
      )
  }

  async function acceptSuggestion(suggestion: Suggestion) {
    if (!suggestion.version_id || !suggestion.original_text || !suggestion.suggested_text) {
      setError("Esta sugestão não possui texto suficiente para ser movida ao editor.")
      return
    }
    const version = versions.find((item) => item.id === suggestion.version_id)
    if (!version) {
      setError("A versão de origem desta sugestão não está carregada.")
      return
    }
    const baseDraft = suggestion.version_id === selectedVersion ? draft : version.content
    const found = findFlexibleRange(baseDraft, suggestion.original_text)
    if (!found) {
      setError(
        "O trecho original não foi encontrado. A sugestão pode atravessar parágrafos; tente revisar o trecho no Manuscrito ou crie uma nova revisão.",
      )
      return
    }
    const replacement = suggestion.suggested_text.replace(/\r\n?/g, "\n")
    const updatedDraft = `${baseDraft.slice(0, found.index)}${replacement}${baseDraft.slice(found.index + found.length)}`
    const { data: userResult } = await supabase.auth.getUser()
    const { error: updateError } = await supabase
      .from("chapter_suggestions")
      .update({
        status: "accepted",
        resolved_by: userResult.user?.id ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", suggestion.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setSuggestions((items) =>
      items.map((item) => (item.id === suggestion.id ? { ...item, status: "accepted" } : item)),
    )
    setSelectedVersion(suggestion.version_id)
    setDraft(updatedDraft)
    setAppliedChanges((items) => [
      ...items.filter((item) => item.suggestionId !== suggestion.id),
      {
        suggestionId: suggestion.id,
        versionId: suggestion.version_id ?? "",
        originalText: found.originalText,
        suggestedText: replacement,
      },
    ])
    setManuscriptView("edit")
    setNotice(
      "Proposta aceita e movida para o editor. Revise o destaque e salve o Manuscrito para confirmar.",
    )
    setError("")
  }

  function restoreAppliedChange(change: AppliedChange) {
    const found = findFlexibleRange(draft, change.suggestedText)
    if (!found) {
      setError("A proposta não foi encontrada no rascunho atual para restauração.")
      return
    }
    const restoredDraft = `${draft.slice(0, found.index)}${change.originalText}${draft.slice(found.index + found.length)}`
    setDraft(restoredDraft)
    setAppliedChanges((items) => items.filter((item) => item.suggestionId !== change.suggestionId))
    setNotice("Texto original restaurado no editor. Salve o Manuscrito para confirmar.")
    setError("")
  }

  return (
    <section className="sticky top-0 z-20 border-b border-[#d5c9bd] bg-[#fffdf8]">
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-[#f8f3ec] sm:px-4"
        aria-expanded={isExpanded}
        aria-controls="editorial-panel-content"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#65735f]">
            INERTIA - AI
          </span>
          <span className="truncate text-xs text-[#9a8c7c]">
            · {tab === "source" ? "Fonte" : "Manuscrito"}
          </span>
        </span>
        <span
          className={`shrink-0 text-sm text-[#65735f] transition-transform ${isExpanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          ⌄
        </span>
      </button>
      {isExpanded && (
        <div
          id="editorial-panel-content"
          className="max-h-[70vh] overflow-y-auto overscroll-contain border-t border-[#eee6dc] px-3 pb-3 sm:px-4"
        >
          <div className="flex flex-wrap items-center justify-end gap-2 pt-3">
            <div className="flex gap-1 rounded-full bg-[#f0ebe3] p-1">
              <button
                type="button"
                onClick={() => setTab("source")}
                className={`rounded-full px-3 py-1 text-xs ${tab === "source" ? "bg-[#65735f] text-white" : "text-[#65735f]"}`}
              >
                Fonte
              </button>
              <button
                type="button"
                onClick={() => setTab("manuscript")}
                className={`rounded-full px-3 py-1 text-xs ${tab === "manuscript" ? "bg-[#65735f] text-white" : "text-[#65735f]"}`}
              >
                Manuscrito
              </button>
            </div>
          </div>
          {error && (
            <p className="mt-3 rounded-lg bg-[#f9e1dc] px-3 py-2 text-sm text-[#7b302b]">{error}</p>
          )}
          {notice && (
            <p className="mt-3 rounded-lg bg-[#e4f2dc] px-3 py-2 text-sm text-[#36552d]">
              {notice}
            </p>
          )}
          {compiling && (
            <div
              className="mt-3 rounded-lg border border-[#d5c9bd] bg-[#f7f2ea] px-3 py-2"
              role="status"
              aria-live="polite"
            >
              <div
                className="mb-2 h-1.5 overflow-hidden rounded-full bg-[#ded5ca]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={compileProgress}
              >
                <div
                  className="h-full rounded-full bg-[#65735f] transition-all duration-300"
                  style={{ width: `${compileProgress}%` }}
                />
              </div>
              <p className="text-sm font-medium text-[#36552d]">{stageLabels[compileStage]}</p>
              <p className="mt-1 text-xs text-[#65735f]">
                A Fonte será preservada. O Manuscrito receberá apenas a nova versão formatada.
              </p>
            </div>
          )}
          {reviewing && (
            <div
              className="mt-3 flex items-center gap-2 rounded-lg border border-[#d5c9bd] bg-[#f7f2ea] px-3 py-2 text-sm text-[#36552d]"
              role="status"
              aria-live="polite"
            >
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#65735f]" />{" "}
              <span>{reviewStage}</span>
              <span className="text-xs text-[#65735f]">A Fonte não será alterada.</span>
            </div>
          )}
          {ollamaCheck && !compiling && (
            <p className="mt-2 text-xs text-[#36552d]">{ollamaCheck}</p>
          )}
          {loading ? (
            <p className="mt-3 text-sm text-[#65735f]">Carregando camada editorial…</p>
          ) : tab === "source" ? (
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="space-y-2 rounded-xl border border-[#e3d8cc] bg-[#f8f3ec] p-3">
                {source.length ? (
                  source.map((message) => (
                    <p key={message.id} className="text-sm leading-6 text-[#253126]">
                      <span className="mr-2 text-xs text-[#65735f]">
                        #{message.sequence_number}
                      </span>
                      {message.content}
                    </p>
                  ))
                ) : (
                  <p className="text-sm text-[#65735f]">
                    Ainda não há mensagens de História para compilar.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void compileWithOllama()}
                  disabled={compiling || !source.length}
                  className="rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {compiling ? "Compilando…" : "Compilar com Ollama"}
                </button>
                <p className="max-w-48 text-xs leading-5 text-[#65735f]">
                  A Fonte é somente leitura. A IA organiza parágrafos e pode sugerir títulos e
                  ênfases.
                </p>
              </div>
              <div className="rounded-xl border border-[#d9cfc3] bg-[#fffdf8] p-3 md:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[#36552d]">
                      Importar capítulo existente
                    </p>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-[#65735f]">
                      Cole um texto ou selecione um arquivo .txt/.md. A importação cria uma versão
                      manual do Manuscrito e não transforma o conteúdo em mensagens da Fonte.
                    </p>
                  </div>
                  <span className="rounded-full bg-[#f0ebe3] px-2 py-1 text-[10px] text-[#65735f]">
                    Fonte intacta
                  </span>
                </div>
                <textarea
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  rows={5}
                  placeholder="Cole aqui o texto do capítulo…"
                  className="mt-3 w-full resize-y rounded-xl border border-[#d9cfc3] bg-white p-3 text-sm leading-6 outline-none focus:border-[#65735f]"
                  aria-label="Texto do capítulo para importar"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="cursor-pointer rounded-full border border-[#d9cfc3] px-3 py-1.5 text-xs font-semibold text-[#65735f] hover:bg-[#f0ebe3]">
                    Selecionar arquivo
                    <input
                      type="file"
                      accept=".txt,.md,text/plain,text/markdown"
                      className="sr-only"
                      onChange={async (event) => {
                        const file = event.target.files?.[0]
                        if (!file) return
                        setImportFileName(file.name)
                        setImportText(await file.text())
                      }}
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    {importFileName && (
                      <span className="max-w-48 truncate text-xs text-[#65735f]">
                        {importFileName}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void importManuscript()}
                      disabled={importing || !importText.trim()}
                      className="rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {importing ? "Importando…" : "Importar para o Manuscrito"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1 rounded-lg bg-[#f0ebe3] p-1">
                  <button
                    type="button"
                    onClick={() => setManuscriptView("preview")}
                    className={`rounded-md px-3 py-1 text-xs font-semibold ${manuscriptView === "preview" ? "bg-white text-[#36552d] shadow-sm" : "text-[#65735f]"}`}
                  >
                    Pré-visualizar
                  </button>
                  <button
                    type="button"
                    onClick={() => setManuscriptView("edit")}
                    className={`rounded-md px-3 py-1 text-xs font-semibold ${manuscriptView === "edit" ? "bg-white text-[#36552d] shadow-sm" : "text-[#65735f]"}`}
                  >
                    Editar texto
                  </button>
                </div>
                <p className="text-xs text-[#65735f]">
                  Markdown editorial: <code>## título</code> · <code>**negrito**</code> ·{" "}
                  <code>*itálico*</code> · <code>---</code>
                </p>
              </div>
              {manuscriptView === "preview" ? (
                <WattpadPreview content={draft} />
              ) : (
                <InlineManuscriptEditor
                  content={draft}
                  changes={appliedChanges}
                  onChange={setDraft}
                  onRestore={restoreAppliedChange}
                />
              )}
              {manuscriptView === "edit" && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveDraft()}
                    disabled={saving || !manuscript}
                    className="rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {saving ? "Salvando…" : "Salvar manuscrito"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setManuscriptView("preview")}
                    className="rounded-xl border border-[#d9cfc3] px-3 py-2 text-sm font-semibold text-[#65735f]"
                  >
                    Ver formatação
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void reviewWithOllama()}
                  disabled={
                    reviewing ||
                    !versions.length ||
                    selectedVersionData?.review_status === "completed"
                  }
                  className="rounded-xl border border-[#65735f] px-3 py-2 text-sm font-semibold text-[#65735f] disabled:opacity-50"
                >
                  {reviewing
                    ? "Revisando…"
                    : selectedVersionData?.review_status === "completed"
                      ? "Versão já revisada"
                      : "Revisar com Ollama"}
                </button>
                <label className="text-xs text-[#65735f]">
                  Versão
                  <select
                    value={selectedVersion}
                    onChange={(event) => {
                      setSelectedVersion(event.target.value)
                      const version = versions.find((item) => item.id === event.target.value)
                      if (version) {
                        setDraft(version.content)
                        setAppliedChanges([])
                        setManuscriptView("preview")
                      }
                    }}
                    className="ml-1 rounded-lg border border-[#d9cfc3] bg-white px-2 py-1"
                  >
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        V{version.version_number} · {version.compilation_provider}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="border-t border-[#e3d8cc] pt-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-[#65735f]">
                  Versões e sugestões
                </p>
                {versions.length ? (
                  versions.map((version) => (
                    <div
                      key={version.id}
                      className="mt-2 rounded-lg border border-[#e3d8cc] p-2 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedVersion(version.id)
                          setDraft(version.content)
                          setAppliedChanges([])
                          setManuscriptView("preview")
                        }}
                        className="font-semibold text-[#65735f]"
                      >
                        V{version.version_number}
                      </button>
                      <span className="ml-2 text-[#65735f]">
                        {version.compilation_provider}
                        {version.model_name ? ` · ${version.model_name}` : ""}
                      </span>
                      <span className="ml-2 rounded-full bg-[#f0ebe3] px-2 py-0.5 text-[#65735f]">
                        {reviewStatusLabel(version.review_status)}
                      </span>
                      {version.review_status === "completed" && (
                        <span className="ml-2 text-[#65735f]">
                          {version.review_suggestion_count ?? 0} sugestão(ões)
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="mt-2 text-sm text-[#65735f]">Nenhuma versão criada.</p>
                )}
                {visibleSuggestions.length ? (
                  <div className="mt-3 space-y-2">
                    <label className="flex items-center gap-2 text-xs text-[#65735f]">
                      Mostrar sugestões de{" "}
                      <select
                        value={suggestionVersionFilter}
                        onChange={(event) => setSuggestionVersionFilter(event.target.value)}
                        className="rounded-lg border border-[#d9cfc3] bg-white px-2 py-1"
                      >
                        <option value="latest">
                          V{versions[0]?.version_number ?? "mais recente"}
                        </option>
                        <option value="all">Todas as versões</option>
                        {versions.map((version) => (
                          <option key={`filter-${version.id}`} value={version.id}>
                            V{version.version_number}
                          </option>
                        ))}
                      </select>
                      <span>({visibleSuggestions.length} únicas)</span>
                    </label>
                    {visibleSuggestions.map((suggestion) => (
                      <article
                        key={suggestion.id}
                        className="rounded-lg border border-[#e3d8cc] bg-[#f8f3ec] p-3 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <strong>{suggestionTypeLabel(suggestion.suggestion_type)}</strong>
                          <span className="text-xs text-[#65735f]">
                            {suggestionSeverityLabel(suggestion.severity)} ·{" "}
                            {suggestionStatusLabel(suggestion.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-[#253126]">{suggestion.explanation}</p>
                        {suggestion.original_text && (
                          <p className="mt-2 whitespace-pre-wrap text-xs text-[#7b302b]">
                            Fonte: {suggestion.original_text}
                          </p>
                        )}
                        {suggestion.suggested_text && (
                          <p className="mt-1 whitespace-pre-wrap text-xs text-[#36552d]">
                            Proposta: {suggestion.suggested_text}
                          </p>
                        )}
                        {suggestion.status === "pending" && (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void acceptSuggestion(suggestion)}
                              className="text-xs font-semibold text-[#36552d]"
                            >
                              Aceitar proposta
                            </button>
                            <button
                              type="button"
                              onClick={() => void rejectSuggestion(suggestion.id)}
                              className="text-xs font-semibold text-[#7b302b]"
                            >
                              Rejeitar proposta
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[#65735f]">
                    Nenhuma sugestão registrada. As decisões são sempre manuais.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

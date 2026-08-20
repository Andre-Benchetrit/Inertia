"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  buildReviewerContext,
  checkOllamaModel,
  compileBlockLocal,
  extractMemoryBlock,
  memoryProposalKeyBrowser,
  mergeMemoryEntityContexts,
  mergeMemoryProposalsBrowser,
  MEMORY_BLOCK_CHARS,
  reviewBlockLocal,
  splitIntoBlocks,
  suggestionKeyBrowser,
  type CanonicalMemoryEntity,
  type CanonicalMemoryEvent,
  type CanonicalMemoryFact,
  type CanonicalMemoryOpenThread,
  type CanonicalMemoryRelation,
  type ExistingMemoryEntity,
  type MemoryProposalRaw,
  type ReviewSuggestion,
} from "@/lib/ollama-browser"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
import { WattpadPreview } from "@/lib/wattpad-markdown"

type SourceMessage = {
  id: string
  author_id?: string
  content: string | null
  message_type: "story" | "author_note"
  sequence_number: number
  created_at: string
}
type Manuscript = { id: string; content: string; updated_at: string }
type ReviewStatus = "not_reviewed" | "running" | "completed"
type MemoryStatus = "never_analyzed" | "current" | "stale"
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
  review_summary?: string | null
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
type Props = { bookId: string; chapterId: string; messages: SourceMessage[] }
type AppliedChange = {
  suggestionId: string
  versionId: string
  originalText: string
  suggestedText: string
}
type CompileCheckpoint = {
  version: 1
  model: string
  sourceSignature: string
  fragments: string[]
  updatedAt: string
}
const COMPILE_CHECKPOINT_VERSION = 1

function compileCheckpointKey(chapterId: string) {
  return `inertia:compile-checkpoint:${chapterId}`
}

function compileSourceSignature(sourceText: string) {
  return `${sourceText.length}:${sourceText.slice(0, 160)}:${sourceText.slice(-160)}`
}

async function memorySourceHash(sourceText: string) {
  try {
    const digest = await window.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(sourceText),
    )
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  } catch {
    return compileSourceSignature(sourceText)
  }
}

function readCompileCheckpoint(chapterId: string): CompileCheckpoint | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(compileCheckpointKey(chapterId))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<CompileCheckpoint>
    if (
      value.version !== COMPILE_CHECKPOINT_VERSION ||
      typeof value.model !== "string" ||
      typeof value.sourceSignature !== "string" ||
      !Array.isArray(value.fragments) ||
      value.fragments.some((fragment) => typeof fragment !== "string")
    )
      return null
    return value as CompileCheckpoint
  } catch {
    return null
  }
}

function writeCompileCheckpoint(
  chapterId: string,
  checkpoint: Omit<CompileCheckpoint, "version" | "updatedAt">,
) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      compileCheckpointKey(chapterId),
      JSON.stringify({
        ...checkpoint,
        version: COMPILE_CHECKPOINT_VERSION,
        updatedAt: new Date().toISOString(),
      }),
    )
  } catch {
    // A full localStorage must not invalidate a compilation that is still running.
  }
}

function clearCompileCheckpoint(chapterId: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(compileCheckpointKey(chapterId))
  } catch {
    // Ignore storage cleanup failures after a successful compilation.
  }
}

const stageLabels = {
  idle: "",
  checking: "Verificando Ollama...",
  sending: "Preparando Fonte...",
  waiting: "Compilando com IA (pode levar alguns minutos)...",
  saving: "Salvando versão...",
} as const

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

function memoryStatusLabel(status: MemoryStatus) {
  if (status === "current") return "Memória atualizada"
  if (status === "stale") return "Memória desatualizada"
  return "Memória ainda não analisada"
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

export default function EditorialPanel({ bookId, chapterId, messages }: Props) {
  const supabase = createSupabaseBrowserClient()
  const [tab, setTab] = useState<"source" | "manuscript">("source")
  const [isExpanded, setIsExpanded] = useState(false)
  const [manuscript, setManuscript] = useState<Manuscript | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [approvedVersionId, setApprovedVersionId] = useState<string | null>(null)
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus>("never_analyzed")
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selectedVersion, setSelectedVersion] = useState("")
  const [suggestionVersionFilter, setSuggestionVersionFilter] = useState("latest")
  const [suggestionIndex, setSuggestionIndex] = useState(0)
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
  const [analyzingMemory, setAnalyzingMemory] = useState(false)
  const [memoryStage, setMemoryStage] = useState("")
  const [memoryProgress, setMemoryProgress] = useState({ processed: 0, total: 0 })
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
      const key = suggestionKeyBrowser(suggestion)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [suggestionVersionFilter, suggestions, versions])
  const activeSuggestionIndex = visibleSuggestions.length
    ? Math.min(suggestionIndex, visibleSuggestions.length - 1)
    : 0
  const currentSuggestion = visibleSuggestions[activeSuggestionIndex]
  const suggestionReviewVersion = useMemo(() => {
    const versionId =
      suggestionVersionFilter === "latest"
        ? versions[0]?.id
        : suggestionVersionFilter === "all"
          ? ""
          : suggestionVersionFilter
    return versionId ? versions.find((version) => version.id === versionId) : null
  }, [suggestionVersionFilter, versions])

  const loadEditorial = useCallback(async () => {
    setLoading(true)
    const [manuscriptResult, versionsResult, suggestionsResult, chapterResult] = await Promise.all([
      supabase.rpc("ensure_chapter_manuscript", { target_chapter_id: chapterId }),
      supabase
        .from("chapter_versions")
        .select(
          "id,version_number,content,compilation_provider,model_name,prompt_version,created_at,review_status,review_started_at,reviewed_at,review_model_name,review_blocks,review_suggestion_count,review_summary",
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
      supabase
        .from("chapters")
        .select("approved_version_id,memory_status")
        .eq("id", chapterId)
        .maybeSingle(),
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
    if (chapterResult.error) {
      setError(chapterResult.error.message)
    } else {
      setApprovedVersionId(chapterResult.data?.approved_version_id ?? null)
      setMemoryStatus((chapterResult.data?.memory_status as MemoryStatus) ?? "never_analyzed")
    }
    setLoading(false)
  }, [chapterId, supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEditorial()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadEditorial])

  async function approveVersion(versionId: string | null) {
    setError("")
    setNotice("")
    const { data, error: approvalError } = await supabase
      .rpc("set_chapter_approved_version", {
        target_chapter_id: chapterId,
        target_version_id: versionId,
      })
      .maybeSingle()
    if (approvalError) {
      setError("Não foi possível atualizar a versão aprovada: " + approvalError.message)
      return
    }
    const chapter = data as {
      approved_version_id?: string | null
      memory_status?: MemoryStatus
    } | null
    setApprovedVersionId(chapter?.approved_version_id ?? null)
    setMemoryStatus(chapter?.memory_status ?? "stale")
    setNotice(
      versionId ? "Versão aprovada como snapshot do capítulo." : "Aprovação removida do capítulo.",
    )
  }

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
      const modelCheck = await checkOllamaModel(activeModel)
      if (!modelCheck.ok)
        throw new Error(
          modelCheck.error ??
            "Ollama não está acessível. Verifique se ele está rodando em localhost:11434.",
        )
      if (!modelCheck.modelAvailable)
        throw new Error(
          `Ollama está acessível, mas o modelo "${activeModel}" não foi encontrado. Execute: ollama pull ${activeModel}`,
        )
      if (modelCheck.modelWarning) throw new Error(modelCheck.modelWarning)

      setOllamaCheck(`Conexão confirmada: ${activeModel} disponível em localhost:11434.`)
      setCompileProgress(18)
      setCompileStage("sending")
      const { data: sourceRows, error: sourceError } = await supabase.rpc("get_chapter_messages", {
        target_chapter_id: chapterId,
      })
      if (sourceError) throw new Error(`Não foi possível ler a Fonte: ${sourceError.message}`)

      const source = ((sourceRows ?? []) as SourceMessage[])
        .filter(
          (row: SourceMessage) =>
            row.message_type === "story" &&
            row.content &&
            row.content.trim() &&
            !row.content.trim().startsWith("Mensagem removida"),
        )
        .map((row: SourceMessage) => ({
          id: row.id,
          author_id: row.author_id,
          sequence_number: row.sequence_number,
          created_at: row.created_at,
          content: row.content!.trim(),
        }))
        .sort((left, right) => left.sequence_number - right.sequence_number)
      if (!source.length) throw new Error("Não há conteúdo de História para compilar")

      const sourceText = source
        .map((row) => row.content)
        .join("\n\n")
        .slice(0, 180000)
      const { data: book, error: bookError } = await supabase
        .from("books")
        .select("title,description,ai_instructions")
        .eq("id", bookId)
        .maybeSingle()
      if (bookError)
        throw new Error(`Não foi possível ler o contexto do livro: ${bookError.message}`)
      if (!book) throw new Error("Livro não encontrado")
      const storyContext = [
        book.title ? `Título: ${book.title}` : "",
        book.description ? `Resumo da obra: ${book.description}` : "",
      ]
        .filter(Boolean)
        .join("\n")
      const editorialInstructions = String(book.ai_instructions ?? "").trim()
      const blocks = splitIntoBlocks(sourceText)
      const sourceSignature = compileSourceSignature(
        `${sourceText}\n\n[RESUMO]\n${storyContext}\n\n[INSTRUÇÕES]\n${editorialInstructions}`,
      )
      const previousCheckpoint = readCompileCheckpoint(chapterId)
      const canResume = Boolean(
        previousCheckpoint &&
          previousCheckpoint.model === activeModel &&
          previousCheckpoint.sourceSignature === sourceSignature &&
          previousCheckpoint.fragments.length > 0 &&
          previousCheckpoint.fragments.length <= blocks.length,
      )
      const fragments = canResume ? [...(previousCheckpoint?.fragments ?? [])] : []
      if (canResume) {
        setNotice(
          fragments.length < blocks.length
            ? `Retomando a compilação a partir do bloco ${fragments.length + 1} de ${blocks.length}. Os fragmentos anteriores estão preservados localmente.`
            : "Todos os blocos já foram compilados. Retomando o salvamento da versão final.",
        )
      } else {
        clearCompileCheckpoint(chapterId)
      }

      for (let index = fragments.length; index < blocks.length; index += 1) {
        const blockNumber = index + 1
        const progress = 30 + Math.round((index / blocks.length) * 55)
        setCompileProgress(progress)
        setCompileStage("waiting")
        const previousContent = fragments[fragments.length - 1] ?? ""
        const previousTail = previousContent.slice(-1600)
        let generated
        try {
          generated = await compileBlockLocal(
            activeModel,
            blocks[index],
            blockNumber,
            blocks.length,
            previousTail,
            storyContext,
            editorialInstructions,
          )
        } catch (caught) {
          throw new Error(
            `${caught instanceof Error ? caught.message : "Falha desconhecida no Ollama."} A compilação foi interrompida no bloco ${blockNumber} de ${blocks.length}; os blocos anteriores foram preservados para retomada.`,
          )
        }
        const fragment = generated.response?.trim()
        if (!fragment) throw new Error(`Ollama não retornou conteúdo para o bloco ${blockNumber}.`)
        fragments.push(fragment)
        writeCompileCheckpoint(chapterId, {
          model: activeModel,
          sourceSignature,
          fragments,
        })
        setCompileProgress(30 + Math.round((blockNumber / blocks.length) * 55))
      }

      const content = fragments.join("\n\n").trim()
      if (!content) throw new Error("Ollama não retornou um manuscrito")

      setCompileProgress(88)
      setCompileStage("saving")
      const { error: versionError } = await supabase.rpc("create_chapter_version", {
        target_chapter_id: chapterId,
        version_content: content,
        version_source_snapshot: source.map((row) => ({
          message_id: row.id,
          author_id: row.author_id,
          sequence_number: row.sequence_number,
          created_at: row.created_at,
          content: row.content,
        })),
        version_provider: "ollama",
        version_model: activeModel,
        version_prompt: "compile-chapter-v4-wattpad-blocks",
      })
      if (versionError) throw new Error(versionError.message)

      clearCompileCheckpoint(chapterId)
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
    let reviewStarted = false
    let reviewCompleted = false
    let processedBlocks = 0
    let savedSuggestionCount = 0
    const cleanReasons: string[] = []
    const timer = window.setInterval(
      () =>
        setReviewStage((current) =>
          current.endsWith("...") ? current.slice(0, -3) : `${current}.`,
        ),
      700,
    )
    try {
      const { data: version, error: versionError } = await supabase
        .from("chapter_versions")
        .select("id,chapter_id,content,review_status")
        .eq("id", versionId)
        .eq("chapter_id", chapterId)
        .maybeSingle()
      if (versionError) throw new Error(versionError.message)
      if (!version) throw new Error("Versão não encontrada")
      if (version.review_status === "completed")
        throw new Error(
          "Esta versão já recebeu uma revisão. Crie uma nova versão para revisar novamente.",
        )

      const { data: chapter, error: chapterError } = await supabase
        .from("chapters")
        .select("book_id")
        .eq("id", chapterId)
        .maybeSingle()
      if (chapterError) throw new Error(chapterError.message)
      if (!chapter?.book_id) throw new Error("Capítulo não encontrado")

      const [
        bookResult,
        entitiesResult,
        factsResult,
        relationsResult,
        eventsResult,
        eventEntitiesResult,
        openThreadsResult,
        openThreadEntitiesResult,
      ] = await Promise.all([
        supabase
          .from("books")
          .select("title,description,ai_instructions")
          .eq("id", chapter.book_id)
          .maybeSingle(),
        supabase
          .from("universe_entities")
          .select("id,name,aliases,summary,attributes,visibility")
          .eq("book_id", chapter.book_id)
          .eq("visibility", "canon")
          .is("archived_at", null),
        supabase
          .from("canon_facts")
          .select("entity_id,statement,evidence,visibility,status")
          .eq("book_id", chapter.book_id)
          .eq("visibility", "canon")
          .eq("status", "active")
          .is("archived_at", null),
        supabase
          .from("universe_relations")
          .select("from_entity_id,to_entity_id,relation_type,description,visibility")
          .eq("book_id", chapter.book_id)
          .eq("visibility", "canon")
          .is("archived_at", null),
        supabase
          .from("timeline_events")
          .select("id,title,description,event_kind,narrative_time,visibility,status")
          .eq("book_id", chapter.book_id)
          .eq("visibility", "canon")
          .eq("status", "active")
          .is("archived_at", null),
        supabase.from("timeline_event_entities").select("event_id,entity_id"),
        supabase
          .from("open_threads")
          .select("id,title,description,status,priority,visibility")
          .eq("book_id", chapter.book_id)
          .eq("visibility", "canon")
          .not("status", "in", "(resolved,abandoned,contradicted)")
          .is("archived_at", null),
        supabase.from("open_thread_entities").select("thread_id,entity_id"),
      ])
      if (bookResult.error) throw new Error(bookResult.error.message)
      const book = bookResult.data
      const storyContext = [
        book?.title ? `Título: ${book.title}` : "",
        book?.description ? `Resumo da obra: ${book.description}` : "",
      ]
        .filter(Boolean)
        .join("\n")
      const editorialInstructions = String(book?.ai_instructions ?? "").trim()
      const eventEntityIds = new Map<string, string[]>()
      for (const row of eventEntitiesResult.error ? [] : (eventEntitiesResult.data ?? [])) {
        const ids = eventEntityIds.get(row.event_id) ?? []
        ids.push(row.entity_id)
        eventEntityIds.set(row.event_id, ids)
      }
      const openThreadEntityIds = new Map<string, string[]>()
      for (const row of openThreadEntitiesResult.error
        ? []
        : (openThreadEntitiesResult.data ?? [])) {
        const ids = openThreadEntityIds.get(row.thread_id) ?? []
        ids.push(row.entity_id)
        openThreadEntityIds.set(row.thread_id, ids)
      }
      const canonicalMemory = {
        entities: (entitiesResult.error
          ? []
          : (entitiesResult.data ?? [])) as CanonicalMemoryEntity[],
        facts: (factsResult.error ? [] : (factsResult.data ?? [])) as CanonicalMemoryFact[],
        relations: (relationsResult.error
          ? []
          : (relationsResult.data ?? [])) as CanonicalMemoryRelation[],
        events: (eventsResult.error ? [] : (eventsResult.data ?? [])).map((event) => ({
          ...event,
          entity_ids: eventEntityIds.get(event.id) ?? [],
        })) as CanonicalMemoryEvent[],
        openThreads: (openThreadsResult.error ? [] : (openThreadsResult.data ?? [])).map(
          (thread) => ({
            ...thread,
            entity_ids: openThreadEntityIds.get(thread.id) ?? [],
          }),
        ) as CanonicalMemoryOpenThread[],
      }

      const { data: startData, error: startError } = await supabase.rpc(
        "start_chapter_version_review",
        { target_version_id: versionId, requested_model: activeModel },
      )
      if (startError)
        throw new Error(
          `Não foi possível iniciar o controle de revisão desta versão. Aplique a migration 0007_review_runs.sql no Supabase. Detalhe: ${startError.message}`,
        )
      const started = (Array.isArray(startData) ? startData[0] : startData) as {
        acquired?: boolean
        review_status?: string
      } | null
      if (!started?.acquired) {
        if (started?.review_status === "completed")
          throw new Error(
            "Esta versão já recebeu uma revisão. Crie uma nova versão para revisar novamente.",
          )
        throw new Error(
          "Esta versão já está sendo revisada. Aguarde a conclusão antes de tentar novamente.",
        )
      }
      reviewStarted = true

      const { data: existing, error: existingError } = await supabase
        .from("chapter_suggestions")
        .select("suggestion_type,original_text,suggested_text,anchor")
        .eq("chapter_id", chapterId)
        .eq("version_id", versionId)
      if (existingError) throw new Error(existingError.message)
      const seen = new Set(
        (existing ?? []).map((item) => suggestionKeyBrowser(item as ReviewSuggestion)),
      )
      let totalSuggestionCount = existing?.length ?? 0
      const { data: userResult } = await supabase.auth.getUser()
      if (!userResult.user)
        throw new Error("Sessão expirada. Entre novamente para salvar a revisão.")

      setReviewStage("Dividindo o Manuscrito em blocos...")
      await new Promise((resolve) => window.setTimeout(resolve, 250))
      const blocks = splitIntoBlocks(String(version.content).slice(0, 180000))
      for (let index = 0; index < blocks.length; index += 1) {
        setReviewStage(`A IA está revisando o bloco ${index + 1} de ${blocks.length}...`)
        const result = await reviewBlockLocal(
          activeModel,
          blocks[index],
          index + 1,
          blocks.length,
          storyContext,
          editorialInstructions,
          buildReviewerContext(blocks[index], canonicalMemory),
        )
        if (!result.suggestions.length) {
          cleanReasons.push(
            result.noIssuesReason ??
              "não foram identificados problemas objetivos de gramática, clareza, coerência, continuidade ou organização editorial neste bloco",
          )
        }

        const unique = result.suggestions.filter((item) => {
          const key = suggestionKeyBrowser(item)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })

        if (unique.length) {
          const rows = unique.map((item) => ({
            ...item,
            chapter_id: chapterId,
            version_id: versionId,
            created_by: userResult.user.id,
          }))
          const { data: insertedRows, error: insertError } = await supabase
            .from("chapter_suggestions")
            .insert(rows)
            .select(
              "id,version_id,suggestion_type,severity,status,explanation,original_text,suggested_text,anchor,created_at",
            )
          if (insertError) throw new Error(insertError.message)
          const insertedCount = insertedRows?.length ?? unique.length
          savedSuggestionCount += insertedCount
          totalSuggestionCount += insertedCount
          if (insertedRows?.length) {
            setSuggestions((current) => [...(insertedRows as Suggestion[]), ...current])
          }
        }

        processedBlocks = index + 1
        setReviewStage(
          `Bloco ${processedBlocks} de ${blocks.length} concluído. Progresso salvo; continuando...`,
        )
      }

      setReviewStage("Finalizando a revisão...")
      const reviewSummary =
        totalSuggestionCount === 0
          ? Array.from(new Set(cleanReasons)).slice(0, 3).join(" ").slice(0, 1000) ||
            "A revisão não encontrou problemas objetivos que justificassem uma sugestão neste Manuscrito."
          : null
      const { error: completeError } = await supabase.rpc("complete_chapter_version_review", {
        target_version_id: versionId,
        processed_blocks: processedBlocks,
        saved_suggestions: totalSuggestionCount,
        requested_model: activeModel,
        requested_summary: reviewSummary,
      })
      if (completeError)
        throw new Error(
          `As sugestões foram salvas, mas não foi possível concluir o estado da revisão. ${completeError.message}`,
        )
      reviewCompleted = true
      setSuggestionVersionFilter(versionId)
      setSuggestionIndex(0)
      await loadEditorial()
      setNotice(
        reviewSummary
          ? `Revisão concluída sem sugestões. ${reviewSummary}`
          : `Revisão concluída: ${processedBlocks} bloco(s), ${savedSuggestionCount} sugestão(ões) nova(s).`,
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha desconhecida durante a revisão.")
      if (processedBlocks || savedSuggestionCount) {
        setSuggestionVersionFilter(versionId)
        setSuggestionIndex(0)
        await loadEditorial()
        setNotice(
          `Progresso preservado: ${processedBlocks} bloco(s) processado(s) e ${savedSuggestionCount} sugestão(ões) salva(s). Você pode tentar novamente; sugestões repetidas serão ignoradas.`,
        )
      }
    } finally {
      if (reviewStarted && !reviewCompleted)
        await supabase.rpc("reset_chapter_version_review", { target_version_id: versionId })
      window.clearInterval(timer)
      setReviewing(false)
      setReviewStage("")
    }
  }

  async function analyzeMemoryWithOllama() {
    const activeModel =
      typeof window === "undefined"
        ? model
        : (window.localStorage.getItem("inertia:ollama:model") ?? model)
    if (!activeModel) {
      setError("Selecione um modelo no indicador de IA local antes de analisar a memória.")
      return
    }
    if (!approvedVersionId) {
      setError("Aprove uma versão do Manuscrito como base antes de analisar a memória.")
      return
    }

    setAnalyzingMemory(true)
    setMemoryStage("Preparando a análise da versão aprovada...")
    setMemoryProgress({ processed: 0, total: 0 })
    setError("")
    setNotice("")
    let runId: string | null = null
    let processedBlocks = 0
    try {
      const modelCheck = await checkOllamaModel(activeModel)
      if (!modelCheck.ok)
        throw new Error(
          modelCheck.error ??
            "Ollama não está acessível. Verifique se ele está rodando em localhost:11434.",
        )
      if (!modelCheck.modelAvailable)
        throw new Error(
          `Ollama está acessível, mas o modelo "${activeModel}" não foi encontrado. Execute: ollama pull ${activeModel}`,
        )
      if (modelCheck.modelWarning) setNotice(modelCheck.modelWarning)

      const [
        { data: version, error: versionError },
        { data: book, error: bookError },
        { data: entityRows, error: entityError },
      ] = await Promise.all([
        supabase
          .from("chapter_versions")
          .select("id,chapter_id,content")
          .eq("id", approvedVersionId)
          .eq("chapter_id", chapterId)
          .maybeSingle(),
        supabase
          .from("books")
          .select("title,description,ai_instructions")
          .eq("id", bookId)
          .maybeSingle(),
        supabase
          .from("universe_entities")
          .select("name,aliases,entity_type,summary,attributes")
          .eq("book_id", bookId)
          .is("archived_at", null)
          .order("name")
          .limit(80),
      ])
      if (versionError)
        throw new Error(`Não foi possível ler a versão aprovada: ${versionError.message}`)
      if (bookError)
        throw new Error(`Não foi possível ler o contexto do livro: ${bookError.message}`)
      if (entityError)
        throw new Error(`Não foi possível ler as entidades do Universo: ${entityError.message}`)
      if (!version?.content?.trim())
        throw new Error("A versão aprovada não possui conteúdo para analisar.")
      if (!book) throw new Error("Livro não encontrado.")

      const storyContext = [
        book.title ? `Título: ${book.title}` : "",
        book.description ? `Resumo da obra: ${book.description}` : "",
      ]
        .filter(Boolean)
        .join("\n")
      const editorialInstructions = String(book.ai_instructions ?? "").trim()
      const sourceText = String(version.content).slice(0, 180000)
      const blocks = splitIntoBlocks(sourceText, MEMORY_BLOCK_CHARS)
      const sourceHash = await memorySourceHash(
        `[MEMORY_EXTRACTION_V4]\n[BLOCK_CHARS:${MEMORY_BLOCK_CHARS}]\n${sourceText}\n\n[RESUMO]\n${storyContext}\n\n[INSTRUÇÕES]\n${editorialInstructions}`,
      )
      setMemoryProgress({ processed: 0, total: blocks.length })
      setMemoryStage(`Solicitando análise de ${blocks.length} bloco(s)...`)

      const { data: startedData, error: startError } = await supabase.rpc("start_memory_analysis", {
        target_book_id: bookId,
        target_chapter_id: chapterId,
        target_version_id: approvedVersionId,
        requested_model: activeModel,
        requested_total_blocks: blocks.length,
        requested_source_hash: sourceHash,
      })
      if (startError)
        throw new Error(
          `Não foi possível iniciar a análise de memória. Aplique as migrations 0011, 0012 e 0014 no Supabase. Detalhe: ${startError.message}`,
        )

      let started = (Array.isArray(startedData) ? startedData[0] : startedData) as {
        id?: string
        processed_blocks?: number
        total_blocks?: number
        source_hash?: string
        status?: string
      } | null
      if (!started?.id)
        throw new Error("O Supabase não retornou o identificador da análise de memória.")

      const runUsesCurrentContract =
        started.source_hash === sourceHash && Number(started.total_blocks) === blocks.length
      if (!runUsesCurrentContract) {
        const { error: cancelError } = await supabase.rpc("update_memory_analysis_progress", {
          target_run_id: started.id,
          requested_processed_blocks: Number(started.processed_blocks ?? 0),
          requested_status: "cancelled",
          requested_error_message:
            "Run cancelado automaticamente após a atualização do contrato de blocos da memória.",
        })
        if (cancelError) throw new Error(cancelError.message)
        const { data: restartedData, error: restartError } = await supabase.rpc(
          "start_memory_analysis",
          {
            target_book_id: bookId,
            target_chapter_id: chapterId,
            target_version_id: approvedVersionId,
            requested_model: activeModel,
            requested_total_blocks: blocks.length,
            requested_source_hash: sourceHash,
          },
        )
        if (restartError) throw new Error(restartError.message)
        started = (
          Array.isArray(restartedData) ? restartedData[0] : restartedData
        ) as typeof started
      }

      if (!started?.id)
        throw new Error("O Supabase não retornou o identificador da análise de memória.")
      runId = started.id
      processedBlocks = Math.min(Math.max(Number(started.processed_blocks ?? 0), 0), blocks.length)
      setMemoryProgress({ processed: processedBlocks, total: blocks.length })

      const { data: existingProposals, error: existingError } = await supabase
        .from("memory_proposals")
        .select(
          "id,proposal_kind,title,payload,evidence,explanation,confidence,source_block,source_anchor,dedupe_key,status",
        )
        .eq("run_id", started.id)
        .eq("status", "pending")
      if (existingError) throw new Error(existingError.message)

      const pendingByKey = new Map<
        string,
        { id: string | null; proposal: MemoryProposalRaw; sourceBlock: number }
      >()
      const pendingRows = existingProposals ?? []
      pendingRows.forEach((row) => {
        const proposal = {
          proposal_kind: row.proposal_kind,
          title: row.title,
          payload: row.payload,
          evidence: row.evidence,
          explanation: row.explanation,
          confidence: row.confidence,
          source_anchor: row.source_anchor,
          dedupe_key: row.dedupe_key,
        } as MemoryProposalRaw
        const key = memoryProposalKeyBrowser(proposal)
        if (!pendingByKey.has(key)) {
          pendingByKey.set(key, {
            id: String(row.id),
            proposal,
            sourceBlock: Number(row.source_block ?? 0),
          })
        }
      })

      const canonicalEntityContext: ExistingMemoryEntity[] = (entityRows ?? []).map((row) => ({
        name: String(row.name ?? "").trim(),
        aliases: Array.isArray(row.aliases) ? row.aliases.map((alias) => String(alias)) : [],
        entity_type: typeof row.entity_type === "string" ? row.entity_type : undefined,
        summary: typeof row.summary === "string" ? row.summary : undefined,
        attributes:
          row.attributes && typeof row.attributes === "object" && !Array.isArray(row.attributes)
            ? (row.attributes as Record<string, unknown>)
            : undefined,
        context_source: "canonical",
      }))

      const buildEntityContext = () => {
        const currentRunEntityContext: ExistingMemoryEntity[] = Array.from(pendingByKey.values())
          .filter(({ proposal }) => proposal.proposal_kind === "entity")
          .map(({ proposal }) => {
            const payload = proposal.payload
            return {
              name: String(payload.name ?? proposal.title).trim(),
              aliases: Array.isArray(payload.aliases)
                ? payload.aliases.map((alias) => String(alias))
                : [],
              entity_type:
                typeof payload.entity_type === "string" ? payload.entity_type : undefined,
              summary: typeof payload.summary === "string" ? payload.summary : undefined,
              attributes:
                payload.attributes &&
                typeof payload.attributes === "object" &&
                !Array.isArray(payload.attributes)
                  ? (payload.attributes as Record<string, unknown>)
                  : undefined,
              context_source: "current_run",
            }
          })

        return mergeMemoryEntityContexts([...canonicalEntityContext, ...currentRunEntityContext])
      }

      for (let index = processedBlocks; index < blocks.length; index += 1) {
        const blockNumber = index + 1
        setMemoryStage(`A IA está analisando o bloco ${blockNumber} de ${blocks.length}...`)
        const result = await extractMemoryBlock(
          activeModel,
          blocks[index],
          blockNumber,
          blocks.length,
          storyContext,
          editorialInstructions,
          buildEntityContext(),
        )
        const rowsToInsert: Array<Record<string, unknown>> = []
        const updatesById = new Map<string, Record<string, unknown>>()
        const newByKey = new Map<string, number>()

        result.proposals.forEach((proposal: MemoryProposalRaw) => {
          const key = memoryProposalKeyBrowser(proposal)
          const existing = pendingByKey.get(key)
          if (existing) {
            const merged = mergeMemoryProposalsBrowser(existing.proposal, proposal)
            existing.proposal = merged
            pendingByKey.set(key, existing)
            if (existing.id) {
              updatesById.set(existing.id, {
                payload: merged.payload,
                evidence: merged.evidence,
                explanation: merged.explanation,
                confidence: merged.confidence,
                source_anchor: merged.source_anchor,
                dedupe_key: key,
              })
            } else if (newByKey.has(key)) {
              rowsToInsert[newByKey.get(key) as number] = {
                ...rowsToInsert[newByKey.get(key) as number],
                payload: merged.payload,
                evidence: merged.evidence,
                explanation: merged.explanation,
                confidence: merged.confidence,
                source_anchor: merged.source_anchor,
                dedupe_key: key,
              }
            }
            return
          }

          const row = {
            run_id: runId,
            book_id: bookId,
            chapter_id: chapterId,
            version_id: approvedVersionId,
            proposal_kind: proposal.proposal_kind,
            status: "pending",
            confidence: proposal.confidence,
            title: proposal.title,
            payload: proposal.payload,
            evidence: proposal.evidence,
            explanation: proposal.explanation,
            source_block: blockNumber,
            source_anchor: proposal.source_anchor,
            dedupe_key: key,
          }
          newByKey.set(key, rowsToInsert.length)
          rowsToInsert.push(row)
          pendingByKey.set(key, { id: null, proposal, sourceBlock: blockNumber })
        })

        for (const [proposalId, patch] of updatesById) {
          const { error: updateError } = await supabase
            .from("memory_proposals")
            .update(patch)
            .eq("id", proposalId)
            .eq("status", "pending")
          if (updateError)
            throw new Error(`Não foi possível consolidar a proposta: ${updateError.message}`)
        }

        if (rowsToInsert.length) {
          const { error: insertError } = await supabase
            .from("memory_proposals")
            .upsert(rowsToInsert, { onConflict: "run_id,dedupe_key", ignoreDuplicates: true })
          if (insertError)
            throw new Error(`Não foi possível salvar as propostas: ${insertError.message}`)
        }
        processedBlocks = blockNumber
        setMemoryProgress({ processed: processedBlocks, total: blocks.length })
        const { error: progressError } = await supabase.rpc("update_memory_analysis_progress", {
          target_run_id: runId,
          requested_processed_blocks: processedBlocks,
          requested_status: "running",
          requested_error_message: "",
        })
        if (progressError) throw new Error(progressError.message)
      }

      setMemoryStage("Finalizando e mantendo as propostas pendentes...")
      const { error: completeError } = await supabase.rpc("update_memory_analysis_progress", {
        target_run_id: runId,
        requested_processed_blocks: processedBlocks,
        requested_status: "completed",
        requested_error_message: "",
      })
      if (completeError) throw new Error(completeError.message)
      setNotice(
        `Análise concluída: ${processedBlocks} bloco(s) processado(s). As propostas ficaram pendentes; nada foi adicionado ao cânone automaticamente.`,
      )
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Falha desconhecida durante a análise de memória."
      if (runId) {
        const status = processedBlocks > 0 ? "partial" : "failed"
        await supabase.rpc("update_memory_analysis_progress", {
          target_run_id: runId,
          requested_processed_blocks: processedBlocks,
          requested_status: status,
          requested_error_message: message,
        })
        setNotice(
          processedBlocks > 0
            ? `Progresso preservado: ${processedBlocks} bloco(s) processado(s). As propostas parciais continuam visíveis para revisão humana.`
            : "A análise não conseguiu concluir nenhum bloco; nenhuma proposta foi adicionada.",
        )
      }
      setError(message)
    } finally {
      setAnalyzingMemory(false)
      setMemoryStage("")
      window.setTimeout(() => setMemoryProgress({ processed: 0, total: 0 }), 500)
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
                <button
                  type="button"
                  onClick={() => void analyzeMemoryWithOllama()}
                  disabled={analyzingMemory || compiling || reviewing || !approvedVersionId}
                  className="rounded-xl border border-[#8d6d4c] px-3 py-2 text-sm font-semibold text-[#8d6d4c] disabled:opacity-50"
                  title={
                    approvedVersionId
                      ? "Extrair propostas da versão aprovada sem alterar o cânone"
                      : "Aprove uma versão antes de analisar a memória"
                  }
                >
                  {analyzingMemory ? "Analisando memória…" : "Analisar Memória"}
                </button>
                <Link
                  href={`/app/livro/${bookId}/universo?tab=analysis&chapterId=${chapterId}`}
                  className="rounded-xl px-2 py-2 text-xs font-semibold text-[#65735f] underline decoration-[#aab5a3] underline-offset-2"
                >
                  Ver propostas
                </Link>
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
              {approvedVersionId && (
                <p className="mt-2 text-xs text-[#8b887f]">
                  Base da memória: V
                  {versions.find((version) => version.id === approvedVersionId)?.version_number ??
                    "aprovada"}
                  . A análise gera propostas; somente os autores podem transformá-las em cânone.
                </p>
              )}
              {memoryStage && (
                <div
                  className="mt-3 rounded-xl bg-[#fff8e9] p-3 text-xs text-[#6f5739]"
                  aria-live="polite"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>{memoryStage}</span>
                    {memoryProgress.total > 0 && (
                      <span className="shrink-0 font-semibold">
                        {memoryProgress.processed}/{memoryProgress.total}
                      </span>
                    )}
                  </div>
                  {memoryProgress.total > 0 && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eadcc7]">
                      <div
                        className="h-full rounded-full bg-[#8d6d4c] transition-[width] duration-200"
                        style={{
                          width: `${Math.round((memoryProgress.processed / memoryProgress.total) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              <div className="border-t border-[#e3d8cc] pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#65735f]">
                    Versões e sugestões
                  </p>
                  <span
                    className={
                      "rounded-full px-2 py-1 text-[11px] " +
                      (memoryStatus === "current"
                        ? "bg-[#e4f2dc] text-[#36552d]"
                        : "bg-[#f0ebe3] text-[#65735f]")
                    }
                  >
                    {memoryStatusLabel(memoryStatus)}
                  </span>
                </div>
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
                      {approvedVersionId === version.id ? (
                        <>
                          <span className="ml-2 rounded-full bg-[#e4f2dc] px-2 py-0.5 text-[#36552d]">
                            Aprovada
                          </span>
                          <button
                            type="button"
                            onClick={() => void approveVersion(null)}
                            className="ml-2 text-[#7b302b] underline decoration-[#c99e96] underline-offset-2"
                          >
                            Remover aprovação
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void approveVersion(version.id)}
                          className="ml-2 text-[#65735f] underline decoration-[#aab5a3] underline-offset-2"
                        >
                          Aprovar como base
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="mt-2 text-sm text-[#65735f]">Nenhuma versão criada.</p>
                )}
                {visibleSuggestions.length && currentSuggestion ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs text-[#65735f]">
                        Mostrar sugestões de{" "}
                        <select
                          value={suggestionVersionFilter}
                          onChange={(event) => {
                            setSuggestionVersionFilter(event.target.value)
                            setSuggestionIndex(0)
                          }}
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
                      </label>
                      <span className="shrink-0 text-xs text-[#65735f]">
                        {activeSuggestionIndex + 1} de {visibleSuggestions.length}
                      </span>
                    </div>
                    <div className="flex items-stretch gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setSuggestionIndex(
                            activeSuggestionIndex > 0
                              ? activeSuggestionIndex - 1
                              : visibleSuggestions.length - 1,
                          )
                        }
                        className="w-8 shrink-0 rounded-lg border border-[#d9cfc3] bg-white text-lg text-[#65735f] transition hover:border-[#65735f] disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Sugestão anterior"
                        disabled={visibleSuggestions.length < 2}
                      >
                        ←
                      </button>
                      <article
                        key={currentSuggestion.id}
                        className="min-w-0 flex-1 rounded-lg border border-[#e3d8cc] bg-[#f8f3ec] p-3 text-sm"
                        aria-live="polite"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <strong>{suggestionTypeLabel(currentSuggestion.suggestion_type)}</strong>
                          <span className="text-right text-xs text-[#65735f]">
                            {suggestionSeverityLabel(currentSuggestion.severity)} ·{" "}
                            {suggestionStatusLabel(currentSuggestion.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-[#253126]">{currentSuggestion.explanation}</p>
                        {currentSuggestion.original_text && (
                          <p className="mt-2 whitespace-pre-wrap text-xs text-[#7b302b]">
                            Fonte: {currentSuggestion.original_text}
                          </p>
                        )}
                        {currentSuggestion.suggested_text && (
                          <p className="mt-1 whitespace-pre-wrap text-xs text-[#36552d]">
                            Proposta: {currentSuggestion.suggested_text}
                          </p>
                        )}
                        {currentSuggestion.status === "pending" && (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void acceptSuggestion(currentSuggestion)}
                              className="text-xs font-semibold text-[#36552d]"
                            >
                              Aceitar proposta
                            </button>
                            <button
                              type="button"
                              onClick={() => void rejectSuggestion(currentSuggestion.id)}
                              className="text-xs font-semibold text-[#7b302b]"
                            >
                              Rejeitar proposta
                            </button>
                          </div>
                        )}
                      </article>
                      <button
                        type="button"
                        onClick={() =>
                          setSuggestionIndex(
                            activeSuggestionIndex < visibleSuggestions.length - 1
                              ? activeSuggestionIndex + 1
                              : 0,
                          )
                        }
                        className="w-8 shrink-0 rounded-lg border border-[#d9cfc3] bg-white text-lg text-[#65735f] transition hover:border-[#65735f] disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Próxima sugestão"
                        disabled={visibleSuggestions.length < 2}
                      >
                        →
                      </button>
                    </div>
                    <div
                      className="flex justify-center gap-1.5"
                      aria-label="Navegação das sugestões"
                    >
                      {visibleSuggestions.map((suggestion, index) => (
                        <button
                          key={`dot-${suggestion.id}`}
                          type="button"
                          onClick={() => setSuggestionIndex(index)}
                          className={`h-2 w-2 rounded-full transition ${
                            index === activeSuggestionIndex
                              ? "bg-[#65735f]"
                              : "bg-[#d9cfc3] hover:bg-[#a9b1a1]"
                          }`}
                          aria-label={`Ir para a sugestão ${index + 1}`}
                          aria-current={index === activeSuggestionIndex ? "true" : undefined}
                        />
                      ))}
                    </div>
                  </div>
                ) : suggestionReviewVersion?.review_status === "completed" &&
                  suggestionReviewVersion.review_suggestion_count === 0 &&
                  suggestionReviewVersion.review_summary ? (
                  <div className="mt-3 rounded-lg border border-[#cddac6] bg-[#f1f6ee] p-3 text-sm text-[#36552d]">
                    <p className="font-semibold">Revisão concluída sem sugestões</p>
                    <p className="mt-1 leading-6">{suggestionReviewVersion.review_summary}</p>
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

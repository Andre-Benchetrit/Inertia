"use client"

import { useEffect, useMemo, useState } from "react"
import { reconcileCanonWithOllama, type CanonicalMemoryContext } from "@/lib/ollama-browser"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
import {
  adaptCanonContextToV5,
  buildReconciliationInputHash,
  buildReconciliationSourceSet,
  CANON_RECONCILIATION_MAX_PROPOSALS,
  CANON_RECONCILIATION_PROMPT_VERSION,
  CANON_RECONCILIATION_SCHEMA_VERSION,
  normalizeCanonReconciliationProposals,
  type CanonReconciliationProposal,
  type ReconciliationBasisReference,
  type ReconciliationSource,
  type ReconciliationStatus,
} from "@/lib/canon-reconciler-browser"

type ReconciliationRun = {
  id: string
  book_id: string
  trigger_kind: "manual" | "approved_memory" | "batch"
  requested_by: string
  model_name: string
  prompt_version: string
  contract_version: string
  input_hash: string
  status: "queued" | "running" | "partial" | "completed" | "failed" | "cancelled"
  total_sources: number
  processed_sources: number
  error_message: string
  created_at: string
  started_at: string | null
  finished_at: string | null
}

type StoredReconciliationProposal = Omit<CanonReconciliationProposal, "status"> & {
  id: string
  run_id: string
  book_id: string
  status: ReconciliationStatus
  created_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string
  applied_by: string | null
  applied_at: string | null
  apply_note: string
  applied_records: unknown[]
}

type CanonReconciliationPanelProps = {
  bookId: string
  userId: string | null
  context: CanonicalMemoryContext
  approvedSources?: ReconciliationSource[]
  onPendingCountChange?: (count: number) => void
  onCanonicalChange?: () => void | Promise<void>
}

const kindLabels: Record<CanonReconciliationProposal["proposal_kind"], string> = {
  entity: "Entidade",
  fact: "Fato",
  relation: "Relação",
  event: "Evento",
  open_thread: "Trama aberta",
}

const operationLabels: Record<CanonReconciliationProposal["operation"], string> = {
  create: "Criar",
  update: "Atualizar",
  resolve: "Resolver",
  merge: "Consolidar",
  archive: "Arquivar",
}

const certaintyLabels: Record<CanonReconciliationProposal["certainty"], string> = {
  explicit_fact: "Fato explícito",
  direct_derivation: "Derivação direta",
  possible_inference: "Inferência possível",
  author_defined: "Definição dos autores",
}

const statusLabels: Record<ReconciliationRun["status"], string> = {
  queued: "Na fila",
  running: "Em andamento",
  partial: "Parcial",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
}

const recordTypeLabels: Record<ReconciliationBasisReference["record_type"], string> = {
  entity: "Entidade",
  fact: "Fato",
  relation: "Relação",
  event: "Evento",
  open_thread: "Trama",
}

function analysisOriginLabel(proposal: CanonReconciliationProposal) {
  const origin = proposal.payload?.analysis_origin
  if (origin === "ollama") return "Proposta pela IA (Ollama)"
  if (origin === "rule_engine") return "Proposta por regra determinística"
  return "Origem não identificada"
}

const relationLabels: Record<string, string> = {
  sibling_of: "parentesco de irmão",
  parent_of: "parentesco de pai/mãe",
  child_of: "parentesco de filho",
  friend_of: "amizade",
  enemy_of: "inimizade",
  member_of: "afiliação",
  owns: "posse",
  equipped_with: "equipamento",
  has_power: "poder",
  located_in: "localização",
  created_by: "autoria/criação",
  uses: "uso",
  associated_with: "associação",
}

function consequenceSummary(proposal: CanonReconciliationProposal) {
  const payload = proposal.payload || {}
  if (proposal.proposal_kind === "relation") {
    const relationType = String(payload.relation_type || "other")
    return `Consequência semântica: ${relationLabels[relationType] || relationType}.`
  }
  if (proposal.proposal_kind === "entity" && payload.knowledge_status === "provisional") {
    return "Entidade provisória derivada de um registro canônico; a ficha permanece mínima até confirmação dos autores."
  }
  if (proposal.proposal_kind === "open_thread" && proposal.operation === "resolve") {
    return "A thread será encerrada somente porque a base apresentada responde diretamente à pergunta registrada."
  }
  if (proposal.proposal_kind === "open_thread" && Array.isArray(payload.conflict_fact_ids)) {
    return "Alerta de possível conflito; nenhum dos fatos será escolhido ou apagado automaticamente."
  }
  if (proposal.operation === "merge") {
    return "Consolidação histórica: as fontes originais serão preservadas e não serão apagadas fisicamente."
  }
  return "Derivação estrutural sujeita à revisão humana antes de qualquer alteração no cânone."
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function runTimestamp(value: string | null) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}

function formatError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export default function CanonReconciliationPanel({
  bookId,
  userId,
  context,
  approvedSources = [],
  onPendingCountChange,
  onCanonicalChange,
}: CanonReconciliationPanelProps) {
  const supabase = createSupabaseBrowserClient()
  const [runs, setRuns] = useState<ReconciliationRun[]>([])
  const [proposals, setProposals] = useState<StoredReconciliationProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [applyingApproved, setApplyingApproved] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [proposalIndex, setProposalIndex] = useState(0)
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editPayload, setEditPayload] = useState("{}")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const sources = useMemo(
    () => buildReconciliationSourceSet(context, approvedSources),
    [approvedSources, context],
  )
  const pendingProposals = useMemo(
    () => proposals.filter((proposal) => proposal.status === "pending"),
    [proposals],
  )
  const approvedProposals = useMemo(
    () => proposals.filter((proposal) => proposal.status === "approved"),
    [proposals],
  )
  const latestRun = runs[0] ?? null

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProposalIndex((current) =>
      pendingProposals.length ? Math.min(current, pendingProposals.length - 1) : 0,
    )
  }, [pendingProposals.length])

  function clearFeedback() {
    setError("")
    setNotice("")
  }

  async function load() {
    setLoading(true)
    const [runsResult, proposalsResult] = await Promise.all([
      supabase
        .from("canon_reconciliation_runs")
        .select(
          "id,book_id,trigger_kind,requested_by,model_name,prompt_version,contract_version,input_hash,status,total_sources,processed_sources,error_message,created_at,started_at,finished_at",
        )
        .eq("book_id", bookId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("canon_reconciliation_proposals")
        .select(
          "id,run_id,book_id,schema_version,origin_kind,proposal_kind,operation,status,title,target,payload,basis,evidence_kind,evidence,explanation,certainty,confidence,source_anchor,dedupe_key,created_at,reviewed_by,reviewed_at,review_note,applied_by,applied_at,apply_note,applied_records",
        )
        .eq("book_id", bookId)
        .neq("status", "superseded")
        .order("created_at", { ascending: false })
        .limit(500),
    ])

    if (runsResult.error || proposalsResult.error) {
      setError(
        "Não foi possível carregar o Reconciliador. Confirme se a migration 0025 foi aplicada: " +
          (runsResult.error?.message || proposalsResult.error?.message || "erro desconhecido"),
      )
      setRuns([])
      setProposals([])
      onPendingCountChange?.(0)
    } else {
      const nextRuns = (runsResult.data || []) as ReconciliationRun[]
      const nextProposals = (proposalsResult.data || []) as StoredReconciliationProposal[]
      setRuns(nextRuns)
      setProposals(nextProposals)
      onPendingCountChange?.(
        nextProposals.filter((proposal) => proposal.status === "pending").length,
      )
    }
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    void load()
  }, [bookId])

  function updateLocalProposals(next: StoredReconciliationProposal[]) {
    setProposals(next)
    onPendingCountChange?.(next.filter((proposal) => proposal.status === "pending").length)
  }

  function sourceLabel(reference: ReconciliationBasisReference) {
    const shortId = reference.record_id.slice(0, 8)
    if (reference.record_type === "entity") {
      const entity = context.entities.find((item) => item.id === reference.record_id)
      return `${recordTypeLabels[reference.record_type]}: ${entity?.name || shortId}`
    }
    if (reference.record_type === "fact") {
      const fact = context.facts.find(
        (item) => (item as { id?: string }).id === reference.record_id,
      )
      return `${recordTypeLabels[reference.record_type]}: ${fact?.statement?.slice(0, 80) || shortId}`
    }
    if (reference.record_type === "relation") {
      const relation = context.relations.find(
        (item) => (item as { id?: string }).id === reference.record_id,
      )
      return `${recordTypeLabels[reference.record_type]}: ${relation?.relation_type || shortId}`
    }
    if (reference.record_type === "event") {
      const event = context.events?.find((item) => item.id === reference.record_id)
      return `${recordTypeLabels[reference.record_type]}: ${event?.title || shortId}`
    }
    const thread = context.openThreads?.find((item) => item.id === reference.record_id)
    return `${recordTypeLabels[reference.record_type]}: ${thread?.title || shortId}`
  }

  function startProposalEdit(proposal: StoredReconciliationProposal) {
    clearFeedback()
    setEditingProposalId(proposal.id)
    setEditTitle(proposal.title)
    setEditPayload(JSON.stringify(proposal.payload || {}, null, 2))
  }

  function cancelProposalEdit() {
    setEditingProposalId(null)
    setEditTitle("")
    setEditPayload("{}")
  }

  function parseEditedProposal() {
    const title = editTitle.trim()
    if (!title) throw new Error("A proposta precisa ter um título.")
    const parsed = JSON.parse(editPayload || "{}") as unknown
    if (!isObject(parsed)) throw new Error("O payload editado precisa ser um objeto JSON válido.")
    return { title, payload: parsed }
  }

  async function saveProposalEdit(proposal: StoredReconciliationProposal) {
    let edited: { title: string; payload: Record<string, unknown> }
    try {
      edited = parseEditedProposal()
    } catch (caught) {
      setError(formatError(caught, "Não foi possível interpretar a edição."))
      return
    }

    setActionId(proposal.id)
    clearFeedback()
    const result = await supabase.rpc("review_canon_reconciliation_proposal", {
      target_proposal_id: proposal.id,
      requested_status: "pending",
      requested_title: edited.title,
      requested_payload: edited.payload,
      requested_review_note: "Proposta editada pelos autores e mantida pendente.",
    })
    if (result.error) {
      setError("Não foi possível salvar a edição: " + result.error.message)
    } else {
      setNotice("Proposta atualizada. Ela continua pendente até uma decisão dos autores.")
      cancelProposalEdit()
      await load()
    }
    setActionId(null)
  }

  async function reviewProposal(
    proposal: StoredReconciliationProposal,
    nextStatus: "approved" | "rejected",
  ) {
    let edited: { title: string; payload: Record<string, unknown> } | null = null
    if (editingProposalId === proposal.id) {
      try {
        edited = parseEditedProposal()
      } catch (caught) {
        setError(formatError(caught, "Não foi possível interpretar a edição."))
        return
      }
    }

    if (
      nextStatus === "rejected" &&
      !window.confirm(`Rejeitar a proposta “${proposal.title}”? Ela não será escrita no cânone.`)
    ) {
      return
    }

    const previousProposals = proposals
    const optimisticProposals = proposals.filter((item) => item.id !== proposal.id)
    updateLocalProposals(optimisticProposals)
    setActionId(proposal.id)
    clearFeedback()
    const result = await supabase.rpc("review_canon_reconciliation_proposal", {
      target_proposal_id: proposal.id,
      requested_status: nextStatus,
      requested_title: edited?.title || proposal.title,
      requested_payload: edited?.payload || proposal.payload,
      requested_review_note:
        nextStatus === "approved"
          ? "Aprovada pelos autores. A aplicação ao cânone ocorrerá mediante ação explícita."
          : "Rejeitada pelos autores.",
    })

    if (result.error) {
      updateLocalProposals(previousProposals)
      setError("Não foi possível registrar a decisão: " + result.error.message)
    } else {
      setNotice(
        nextStatus === "approved"
          ? "Proposta aprovada. Use Aplicar aprovadas ao cânone para efetivar as alterações."
          : "Proposta rejeitada. O cânone não foi alterado.",
      )
      cancelProposalEdit()
      void load()
    }
    setActionId(null)
  }

  async function applyApprovedProposals() {
    if (!userId) {
      setError("É necessário estar autenticado para aplicar propostas ao cânone.")
      return
    }
    if (!approvedProposals.length) {
      setNotice("Não há propostas aprovadas aguardando aplicação.")
      return
    }
    if (
      !window.confirm(
        `Aplicar ${approvedProposals.length} proposta(s) aprovada(s) ao cânone? Essa ação atualiza os registros canônicos do livro.`,
      )
    ) {
      return
    }

    setApplyingApproved(true)
    clearFeedback()
    try {
      const result = await supabase.rpc("apply_approved_canon_reconciliation", {
        target_book_id: bookId,
        requested_apply_note: "Aplicação geral confirmada pelos autores.",
      })
      if (result.error) throw new Error(result.error.message)
      const summary = (result.data || {}) as {
        applied_count?: number
        skipped_count?: number
      }
      setNotice(
        `Aplicação concluída: ${summary.applied_count || 0} aplicada(s) e ${summary.skipped_count || 0} ignorada(s).`,
      )
      await load()
      await onCanonicalChange?.()
    } catch (caught) {
      setError(
        "Não foi possível aplicar as propostas aprovadas: " +
          formatError(caught, "erro desconhecido"),
      )
    } finally {
      setApplyingApproved(false)
    }
  }

  async function runCanonReconciliation() {
    if (!userId) {
      setError("É necessário estar autenticado para consolidar o cânone.")
      return
    }
    if (!sources.length) {
      setError("Ainda não há registros canônicos para analisar.")
      return
    }

    setRunning(true)
    clearFeedback()
    let runId = ""
    let processedSources = 0
    try {
      const modelName = window.localStorage.getItem("inertia:ollama:model") || ""
      if (!modelName || modelName === "rule-engine") {
        throw new Error(
          "Selecione um modelo do Ollama para gerar propostas semânticas. O reconciliador não usa regras determinísticas para criar proposals.",
        )
      }
      const inputHash = await buildReconciliationInputHash(
        sources,
        CANON_RECONCILIATION_SCHEMA_VERSION,
      )
      const runResult = await supabase.rpc("start_canon_reconciliation", {
        target_book_id: bookId,
        requested_trigger_kind: "manual",
        requested_model: modelName,
        requested_prompt_version: CANON_RECONCILIATION_PROMPT_VERSION,
        requested_contract_version: CANON_RECONCILIATION_SCHEMA_VERSION,
        requested_input_hash: inputHash,
        requested_total_sources: sources.length,
      })
      if (runResult.error) throw new Error(runResult.error.message)
      const run = runResult.data as ReconciliationRun | null
      if (!run?.id) throw new Error("O Supabase não retornou o identificador do run.")
      runId = run.id

      const sourceRows = sources.map((source) => ({
        run_id: run.id,
        book_id: bookId,
        record_type: source.record_type,
        record_id: source.record_id,
        source_role: source.source_role || "related_context",
        created_by: userId,
      }))
      const sourceResult = await supabase.from("canon_reconciliation_sources").upsert(sourceRows, {
        onConflict: "run_id,record_type,record_id",
        ignoreDuplicates: true,
      })
      if (sourceResult.error) throw new Error(sourceResult.error.message)
      processedSources = sources.length

      const reconciliationContext = adaptCanonContextToV5({ ...context, approvedSources: sources })
      let aiGenerated: unknown[] = []
      let aiError = ""
      try {
        const aiResult = await reconcileCanonWithOllama(modelName, reconciliationContext)
        aiGenerated = aiResult.proposals.map((item) => {
          if (!isObject(item)) return item
          return {
            ...item,
            payload: {
              ...(isObject(item.payload) ? item.payload : {}),
              analysis_origin: "ollama",
            },
          }
        })
      } catch (caught) {
        aiError = formatError(
          caught,
          "O Ollama não conseguiu analisar as consequências semânticas.",
        )
      }
      const generated = aiGenerated
      const normalized = normalizeCanonReconciliationProposals(
        generated,
        reconciliationContext,
        CANON_RECONCILIATION_MAX_PROPOSALS,
      )
      let proposalRows = normalized.map((proposal) => ({
        run_id: run.id,
        book_id: bookId,
        schema_version: proposal.schema_version,
        origin_kind: proposal.origin_kind,
        proposal_kind: proposal.proposal_kind,
        operation: proposal.operation,
        status: "pending" as const,
        title: proposal.title,
        target: proposal.target,
        payload: proposal.payload,
        basis: proposal.basis,
        evidence_kind: proposal.evidence_kind,
        evidence: proposal.evidence,
        explanation: proposal.explanation,
        certainty: proposal.certainty,
        confidence: proposal.confidence,
        source_anchor: proposal.source_anchor,
        dedupe_key: proposal.dedupe_key,
        created_by: userId,
      }))
      if (proposalRows.length) {
        const existingResult = await supabase
          .from("canon_reconciliation_proposals")
          .select("dedupe_key,status")
          .eq("book_id", bookId)
          .in("status", ["pending", "approved", "applied"])
          .in(
            "dedupe_key",
            proposalRows.map((row) => row.dedupe_key),
          )
        if (existingResult.error) throw new Error(existingResult.error.message)
        const existingKeys = new Set(
          (existingResult.data ?? []).map((row) => String(row.dedupe_key)),
        )
        proposalRows = proposalRows.filter((row) => !existingKeys.has(row.dedupe_key))
      }
      const newProposalCount = proposalRows.length
      if (newProposalCount) {
        const proposalResult = await supabase
          .from("canon_reconciliation_proposals")
          .upsert(proposalRows, {
            onConflict: "run_id,dedupe_key",
            ignoreDuplicates: true,
          })
        if (proposalResult.error) throw new Error(proposalResult.error.message)
      }

      const progressResult = await supabase.rpc("update_canon_reconciliation_progress", {
        target_run_id: run.id,
        requested_processed_sources: processedSources,
        requested_status: aiError ? "partial" : "completed",
        requested_error_message: aiError,
      })
      if (progressResult.error) throw new Error(progressResult.error.message)

      const discardedCount = Math.max(0, generated.length - normalized.length)
      const aiNotice = aiError
        ? ` A análise semântica ficou parcial: ${aiError}`
        : aiGenerated.length === 0
          ? " A IA não encontrou consequências estruturais seguras para os registros analisados."
          : ""
      setNotice(
        newProposalCount
          ? `Consolidação concluída: ${newProposalCount} proposta(s) nova(s) pendente(s) para revisão humana${
              discardedCount ? ` (${discardedCount} inválida(s) ou duplicada(s) removida(s)).` : "."
            }${aiNotice}`
          : `Consolidação concluída sem novas consequências estruturais para propor ou todas já estavam registradas.${aiNotice}`,
      )
      await load()
    } catch (caught) {
      const message = formatError(caught, "Falha desconhecida no Reconciliador.")
      if (runId) {
        await supabase.rpc("update_canon_reconciliation_progress", {
          target_run_id: runId,
          requested_processed_sources: processedSources,
          requested_status: "failed",
          requested_error_message: message,
        })
      }
      setError("Não foi possível concluir a consolidação: " + message)
      if (runId) await load()
    } finally {
      setRunning(false)
    }
  }

  const currentProposal = pendingProposals[pendingProposals.length ? proposalIndex : 0]

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8d6d4c]">
            Reconciliador de Cânone
          </p>
          <h2 className="mt-1 text-2xl font-semibold">Consolidar Cânone</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#687065]">
            A IA analisa feitos, participantes, relações e tramas para propor consequências
            estruturais. Nenhuma proposal é gerada por regra determinística; a escrita no cânone só
            acontece após aprovação e ação explícita dos autores.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void applyApprovedProposals()}
            disabled={applyingApproved || running || loading || !approvedProposals.length}
            className="shrink-0 rounded-xl border border-[#8d6d4c] bg-[#fff8e9] px-4 py-2.5 text-sm font-semibold text-[#8d6d4c] transition hover:bg-[#f8eedb] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applyingApproved
              ? "Aplicando…"
              : `Aplicar aprovadas${approvedProposals.length ? ` (${approvedProposals.length})` : ""}`}
          </button>
          <button
            type="button"
            onClick={() => void runCanonReconciliation()}
            disabled={running || applyingApproved || loading || !sources.length}
            className="shrink-0 rounded-xl bg-[#65735f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#52614e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Consolidando…" : "Consolidar Cânone"}
          </button>
        </div>
      </div>

      {(error || notice) && (
        <div
          className={
            "mt-5 rounded-2xl p-4 text-sm leading-6 " +
            (error ? "bg-[#fbe8e3] text-[#8d493b]" : "bg-[#e8eee5] text-[#52614e]")
          }
        >
          {error || notice}
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-[#e3d8cc] bg-[#f6f1ea] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8b887f]">
            Pendentes
          </p>
          <p className="mt-1 text-2xl font-semibold text-[#8d6d4c]">{pendingProposals.length}</p>
          <p className="mt-1 text-xs text-[#687065]">Aguardando decisão dos autores</p>
        </div>
        <div className="rounded-2xl border border-[#e3d8cc] bg-[#f6f1ea] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8b887f]">
            Aprovadas para aplicar
          </p>
          <p className="mt-1 text-2xl font-semibold text-[#8d6d4c]">{approvedProposals.length}</p>
          <p className="mt-1 text-xs text-[#687065]">Aguardando aplicação explícita</p>
        </div>
        <div className="rounded-2xl border border-[#e3d8cc] bg-[#f6f1ea] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8b887f]">
            Fontes disponíveis
          </p>
          <p className="mt-1 text-2xl font-semibold text-[#8d6d4c]">{sources.length}</p>
          <p className="mt-1 text-xs text-[#687065]">Registros canônicos deste livro</p>
        </div>
        <div className="rounded-2xl border border-[#e3d8cc] bg-[#f6f1ea] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8b887f]">
            Último run
          </p>
          <p className="mt-1 text-sm font-semibold text-[#52614e]">
            {latestRun ? statusLabels[latestRun.status] : "Ainda não executado"}
          </p>
          <p className="mt-1 text-xs text-[#687065]">
            {latestRun
              ? `${latestRun.processed_sources}/${latestRun.total_sources} fontes · ${runTimestamp(latestRun.created_at)}`
              : "Execute manualmente quando quiser consolidar."}
          </p>
        </div>
      </div>

      {latestRun && (
        <div className="mt-4 rounded-2xl border border-[#e3d8cc] bg-white/70 p-4 text-xs leading-5 text-[#687065]">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Modelo: {latestRun.model_name}</span>
            <span>Contrato: {latestRun.contract_version}</span>
            <span>
              Fontes: {latestRun.processed_sources}/{latestRun.total_sources}
            </span>
            <span>Criado em: {runTimestamp(latestRun.created_at)}</span>
            {latestRun.finished_at && (
              <span>Finalizado em: {runTimestamp(latestRun.finished_at)}</span>
            )}
          </div>
          {latestRun.error_message && (
            <p className="mt-2 text-[#8d493b]">Erro do run: {latestRun.error_message}</p>
          )}
        </div>
      )}

      <div className="mt-6">
        <div className="flex items-center justify-between gap-2 text-xs text-[#65735f]">
          <span>
            {pendingProposals.length
              ? `${proposalIndex + 1} de ${pendingProposals.length} proposta(s) pendente(s)`
              : "Nenhuma proposta pendente"}
          </span>
          <span>As decisões continuam manuais.</span>
        </div>

        {!currentProposal ? (
          <p className="mt-3 rounded-2xl bg-[#f1f6ee] p-5 text-sm leading-6 text-[#52614e]">
            Ainda não há propostas do Reconciliador. A execução só cria sugestões; aprovar não
            aplica nada automaticamente. Use o botão geral após revisar as aprovadas.
          </p>
        ) : (
          <div className="mt-3 flex items-stretch gap-2">
            <button
              type="button"
              onClick={() =>
                setProposalIndex((current) =>
                  current > 0 ? current - 1 : pendingProposals.length - 1,
                )
              }
              disabled={pendingProposals.length < 2 || actionId !== null}
              className="w-8 shrink-0 rounded-xl border border-[#d9cfc3] bg-white text-lg text-[#65735f] transition hover:border-[#65735f] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Proposta de reconciliação anterior"
            >
              ←
            </button>
            <article
              key={currentProposal.id}
              className="min-w-0 flex-1 rounded-2xl border border-[#e3d8cc] bg-[#f6f1ea] p-4"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#8d6d4c]">
                    <span>{kindLabels[currentProposal.proposal_kind]}</span>
                    <span>·</span>
                    <span>{operationLabels[currentProposal.operation]}</span>
                  </div>
                  <h3 className="mt-1 text-lg font-semibold">{currentProposal.title}</h3>
                </div>
                <span className="rounded-full bg-[#fff8e9] px-2 py-1 text-xs font-semibold text-[#8d6d4c]">
                  Pendente
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#eef3ea] px-3 py-1 text-[11px] font-semibold text-[#52614e]">
                  {analysisOriginLabel(currentProposal)}
                </span>
                <span className="rounded-full bg-[#fff8e9] px-3 py-1 text-[11px] font-semibold text-[#8d6d4c]">
                  Revisão humana obrigatória
                </span>
              </div>
              <p className="mt-3 rounded-xl bg-[#eef3ea] px-3 py-2 text-xs font-semibold leading-5 text-[#52614e]">
                {consequenceSummary(currentProposal)}
              </p>
              <p className="mt-3 text-sm leading-6 text-[#52614e]">
                {currentProposal.explanation || "Sem explicação adicional."}
              </p>
              <blockquote className="mt-3 border-l-2 border-[#c7ad8e] pl-3 text-sm italic leading-6 text-[#687065]">
                “{currentProposal.evidence || "Sem evidência textual adicional."}”
              </blockquote>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#8b887f]">
                <span>Confiança: {Math.round(currentProposal.confidence * 100)}%</span>
                <span>Certeza: {certaintyLabels[currentProposal.certainty]}</span>
                <span>Âncora: {currentProposal.source_anchor || "—"}</span>
              </div>

              <details className="mt-3 rounded-xl bg-white/70 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-[#65735f]">
                  Ver base, alvo e dados estruturados
                </summary>
                <div className="mt-2 space-y-1 text-xs leading-5 text-[#687065]">
                  <p className="font-semibold text-[#52614e]">Registros que sustentam a proposta</p>
                  {currentProposal.basis.length ? (
                    <ul className="list-disc pl-5">
                      {currentProposal.basis.map((reference) => (
                        <li key={`${reference.record_type}-${reference.record_id}`}>
                          {sourceLabel(reference)} · {reference.role || "supporting"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Nenhuma base registrada.</p>
                  )}
                </div>
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-[#52614e]">
                  {JSON.stringify(
                    { target: currentProposal.target, payload: currentProposal.payload },
                    null,
                    2,
                  )}
                </pre>
              </details>

              {editingProposalId === currentProposal.id ? (
                <div className="mt-4 rounded-xl border border-[#d7c7ae] bg-white/70 p-3">
                  <label className="block text-xs font-semibold text-[#65735f]">
                    Título da proposta
                    <input
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      maxLength={240}
                      className="mt-2 w-full rounded-lg border border-[#d5c9bd] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#8d6d4c]"
                    />
                  </label>
                  <label className="mt-3 block text-xs font-semibold text-[#65735f]">
                    Editar payload sem escrever no cânone
                    <textarea
                      value={editPayload}
                      onChange={(event) => setEditPayload(event.target.value)}
                      rows={8}
                      spellCheck={false}
                      className="mt-2 w-full resize-y rounded-lg border border-[#d5c9bd] bg-white px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-[#8d6d4c]"
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelProposalEdit}
                      disabled={actionId !== null}
                      className="rounded-lg border border-[#d5c9bd] px-3 py-2 text-xs font-semibold text-[#687065] disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveProposalEdit(currentProposal)}
                      disabled={actionId !== null}
                      className="rounded-lg border border-[#65735f] px-3 py-2 text-xs font-semibold text-[#65735f] disabled:opacity-50"
                    >
                      {actionId === currentProposal.id ? "Salvando…" : "Salvar edição"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void reviewProposal(currentProposal, "approved")}
                      disabled={actionId !== null}
                      className="rounded-lg bg-[#65735f] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {actionId === currentProposal.id ? "Aprovando…" : "Aprovar edição"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#e3d8cc] pt-3">
                  <button
                    type="button"
                    onClick={() => void reviewProposal(currentProposal, "approved")}
                    disabled={actionId !== null}
                    className="rounded-lg bg-[#65735f] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {actionId === currentProposal.id ? "Aprovando…" : "Aprovar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => startProposalEdit(currentProposal)}
                    disabled={actionId !== null}
                    className="text-xs font-semibold text-[#65735f] underline underline-offset-2 disabled:opacity-50"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => void reviewProposal(currentProposal, "rejected")}
                    disabled={actionId !== null}
                    className="text-xs font-semibold text-[#8d493b] underline underline-offset-2 disabled:opacity-50"
                  >
                    Rejeitar
                  </button>
                  <span className="text-xs text-[#8b887f]">
                    Aprovar registra a decisão; aplicar é uma ação separada.
                  </span>
                </div>
              )}
            </article>
            <button
              type="button"
              onClick={() =>
                setProposalIndex((current) =>
                  current < pendingProposals.length - 1 ? current + 1 : 0,
                )
              }
              disabled={pendingProposals.length < 2 || actionId !== null}
              className="w-8 shrink-0 rounded-xl border border-[#d9cfc3] bg-white text-lg text-[#65735f] transition hover:border-[#65735f] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Próxima proposta de reconciliação"
            >
              →
            </button>
          </div>
        )}

        {pendingProposals.length > 1 && (
          <div className="mt-3 flex justify-center gap-1.5" aria-label="Navegação da reconciliação">
            {pendingProposals.map((proposal, index) => (
              <button
                key={`reconciliation-dot-${proposal.id}`}
                type="button"
                onClick={() => setProposalIndex(index)}
                className={`h-2 w-2 rounded-full transition ${
                  index === proposalIndex ? "bg-[#65735f]" : "bg-[#d9cfc3] hover:bg-[#a9b1a1]"
                }`}
                aria-label={`Ir para a proposta de reconciliação ${index + 1}`}
                aria-current={index === proposalIndex ? "true" : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {runs.length > 1 && (
        <details className="mt-6 rounded-2xl border border-[#e3d8cc] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[#65735f]">
            Ver histórico de consolidações ({runs.length})
          </summary>
          <div className="mt-3 space-y-2">
            {runs.slice(1).map((run) => (
              <div key={run.id} className="rounded-xl bg-[#f6f1ea] p-3 text-xs text-[#687065]">
                {statusLabels[run.status]} · {run.processed_sources}/{run.total_sources} fonte(s) ·{" "}
                {run.model_name} · {runTimestamp(run.created_at)}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

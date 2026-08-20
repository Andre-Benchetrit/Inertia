"use client"

import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { translateMemoryProposalToPortuguese } from "@/lib/ollama-browser"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"

type Tab = "entities" | "facts" | "relations" | "events" | "threads" | "analysis"
type EntityType =
  | "character"
  | "location"
  | "faction"
  | "organization"
  | "power"
  | "item"
  | "creature"
  | "concept"
  | "other"
type Visibility = "canon" | "author_only"

type Entity = {
  id: string
  name: string
  entity_type: EntityType
  summary: string
  aliases: string[]
  attributes: Record<string, unknown>
  visibility: Visibility
  archived_at: string | null
}

type CanonFact = {
  id: string
  entity_id: string | null
  statement: string
  evidence: string
  visibility: Visibility
  status: string
  archived_at: string | null
}

type Relation = {
  id: string
  from_entity_id: string
  to_entity_id: string
  relation_type: string
  description: string
  visibility: Visibility
  archived_at: string | null
}

type EventKind =
  | "action"
  | "revelation"
  | "conflict"
  | "relationship_change"
  | "discovery"
  | "scene"
  | "other"

type TimelineEvent = {
  id: string
  event_kind: EventKind
  title: string
  description: string
  narrative_time: string
  visibility: Visibility
  status: string
  archived_at: string | null
  entity_ids: string[]
  payload?: Record<string, unknown>
}

type OpenThreadStatus = "open" | "in_progress" | "resolved" | "abandoned" | "contradicted"
type ThreadPriority = "low" | "normal" | "high"

type OpenThread = {
  id: string
  title: string
  description: string
  status: OpenThreadStatus
  priority: ThreadPriority
  visibility: Visibility
  archived_at: string | null
  entity_ids: string[]
}

type AnalysisRun = {
  id: string
  chapter_id: string
  version_id: string
  model_name: string
  status: string
  total_blocks: number
  processed_blocks: number
  error_message: string
  created_at: string
  finished_at: string | null
}

type MemoryProposal = {
  id: string
  run_id: string
  chapter_id: string
  version_id: string
  proposal_kind: "entity" | "fact" | "relation" | "event" | "open_thread"
  status: "pending" | "approved" | "rejected" | "superseded"
  confidence: number | null
  title: string
  payload: Record<string, unknown>
  evidence: string
  explanation: string
  source_block: number | null
  source_anchor: string
  review_note: string
  created_at: string
  approved_records: Array<Record<string, unknown>> | null
}

type EntityDraft = {
  name: string
  entity_type: EntityType
  summary: string
  aliases: string
  attributes: string
  visibility: Visibility
}

type FactDraft = {
  entity_id: string
  statement: string
  evidence: string
  visibility: Visibility
}

type RelationDraft = {
  from_entity_id: string
  to_entity_id: string
  relation_type: string
  description: string
  visibility: Visibility
}

type EventDraft = {
  event_kind: EventKind
  title: string
  description: string
  narrative_time: string
  entity_ids: string[]
  visibility: Visibility
}

type ThreadDraft = {
  title: string
  description: string
  status: OpenThreadStatus
  priority: ThreadPriority
  entity_ids: string[]
  visibility: Visibility
}

const eventKindLabels: Record<EventKind, string> = {
  action: "Ação",
  revelation: "Revelação",
  conflict: "Conflito",
  relationship_change: "Mudança de relação",
  discovery: "Descoberta",
  scene: "Cena",
  other: "Outro",
}

const threadStatusLabels: Record<OpenThreadStatus, string> = {
  open: "Aberta",
  in_progress: "Em andamento",
  resolved: "Resolvida",
  abandoned: "Abandonada",
  contradicted: "Contradita",
}

const threadPriorityLabels: Record<ThreadPriority, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
}

const entityTypeLabels: Record<EntityType, string> = {
  character: "Personagem",
  location: "Local",
  faction: "Facção",
  organization: "Organização",
  power: "Poder ou habilidade",
  item: "Item",
  creature: "Criatura",
  concept: "Conceito",
  other: "Outro",
}

const emptyEntityDraft: EntityDraft = {
  name: "",
  entity_type: "character",
  summary: "",
  aliases: "",
  attributes: "{}",
  visibility: "canon",
}

const emptyFactDraft: FactDraft = {
  entity_id: "",
  statement: "",
  evidence: "",
  visibility: "canon",
}

const emptyRelationDraft: RelationDraft = {
  from_entity_id: "",
  to_entity_id: "",
  relation_type: "",
  description: "",
  visibility: "canon",
}

const emptyEventDraft: EventDraft = {
  event_kind: "other",
  title: "",
  description: "",
  narrative_time: "",
  entity_ids: [],
  visibility: "canon",
}

const emptyThreadDraft: ThreadDraft = {
  title: "",
  description: "",
  status: "open",
  priority: "normal",
  entity_ids: [],
  visibility: "canon",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function firstText(...values: unknown[]) {
  return (
    values
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
      ?.trim() || ""
  )
}

function parseEventKind(value: unknown, fallback: EventKind): EventKind {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
  if (normalized in eventKindLabels) return normalized as EventKind
  if (normalized === "mudança de relação" || normalized === "mudanca de relacao") {
    return "relationship_change"
  }
  if (normalized === "revelação" || normalized === "revelacao") return "revelation"
  if (normalized === "descoberta") return "discovery"
  if (normalized === "conflito") return "conflict"
  if (normalized === "cena") return "scene"
  if (normalized === "ação" || normalized === "acao") return "action"
  return fallback
}

function textList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

function eventPayloadView(event: TimelineEvent) {
  const rawPayload = isRecord(event.payload) ? event.payload : {}
  const nestedPayload = isRecord(rawPayload.payload)
    ? rawPayload.payload
    : isRecord(rawPayload.event)
      ? rawPayload.event
      : {}
  const entityNames = textList(
    [
      rawPayload.entities_involved,
      nestedPayload.entities_involved,
      rawPayload.entities,
      nestedPayload.entities,
      rawPayload.participants,
      nestedPayload.participants,
    ].find((value) => Array.isArray(value) && value.length > 0),
  )

  return {
    kind: parseEventKind(
      firstText(
        rawPayload.event_kind,
        nestedPayload.event_kind,
        rawPayload.kind,
        nestedPayload.kind,
        rawPayload.type,
        nestedPayload.type,
      ),
      event.event_kind,
    ),
    title: firstText(
      rawPayload.title,
      nestedPayload.title,
      rawPayload.event_title,
      nestedPayload.event_title,
      rawPayload.name,
      nestedPayload.name,
      event.title,
    ),
    description: firstText(
      rawPayload.description,
      nestedPayload.description,
      rawPayload.statement,
      nestedPayload.statement,
      rawPayload.what_happened,
      nestedPayload.what_happened,
      rawPayload.event_description,
      nestedPayload.event_description,
      rawPayload.summary,
      nestedPayload.summary,
      rawPayload.details,
      nestedPayload.details,
      event.description,
    ),
    narrativeTime: firstText(
      rawPayload.narrative_time,
      nestedPayload.narrative_time,
      rawPayload.time,
      nestedPayload.time,
      rawPayload.when,
      nestedPayload.when,
      event.narrative_time,
    ),
    entityNames,
    visibility:
      rawPayload.visibility === "author_only" || nestedPayload.visibility === "author_only"
        ? "author_only"
        : event.visibility,
  }
}

export default function UniversePage() {
  const { bookId } = useParams<{ bookId: string }>()
  const searchParams = useSearchParams()
  const supabase = createSupabaseBrowserClient()
  const [bookTitle, setBookTitle] = useState("")
  const [entities, setEntities] = useState<Entity[]>([])
  const [facts, setFacts] = useState<CanonFact[]>([])
  const [relations, setRelations] = useState<Relation[]>([])
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [openThreads, setOpenThreads] = useState<OpenThread[]>([])
  const [analysisRun, setAnalysisRun] = useState<AnalysisRun | null>(null)
  const [analysisRuns, setAnalysisRuns] = useState<AnalysisRun[]>([])
  const [proposals, setProposals] = useState<MemoryProposal[]>([])
  const [analysisError, setAnalysisError] = useState("")
  const [activeTab, setActiveTab] = useState<Tab>(() =>
    searchParams.get("tab") === "analysis" ? "analysis" : "entities",
  )
  const [entityDraft, setEntityDraft] = useState<EntityDraft>(emptyEntityDraft)
  const [factDraft, setFactDraft] = useState<FactDraft>(emptyFactDraft)
  const [relationDraft, setRelationDraft] = useState<RelationDraft>(emptyRelationDraft)
  const [eventDraft, setEventDraft] = useState<EventDraft>(emptyEventDraft)
  const [threadDraft, setThreadDraft] = useState<ThreadDraft>(emptyThreadDraft)
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null)
  const [editingFactId, setEditingFactId] = useState<string | null>(null)
  const [editingRelationId, setEditingRelationId] = useState<string | null>(null)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [showEntityForm, setShowEntityForm] = useState(false)
  const [showFactForm, setShowFactForm] = useState(false)
  const [showRelationForm, setShowRelationForm] = useState(false)
  const [showEventForm, setShowEventForm] = useState(false)
  const [showThreadForm, setShowThreadForm] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [proposalActionId, setProposalActionId] = useState<string | null>(null)
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null)
  const [proposalEditPayload, setProposalEditPayload] = useState("{}")
  const [translatingProposals, setTranslatingProposals] = useState(false)
  const [translationProgress, setTranslationProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const entityById = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  )
  const pendingProposalCount = useMemo(
    () => proposals.filter((proposal) => proposal.status === "pending").length,
    [proposals],
  )

  async function load() {
    setLoading(true)
    setError("")
    setAnalysisError("")
    const analysisChapterId = searchParams.get("chapterId")
    const runsQuery = supabase
      .from("memory_analysis_runs")
      .select(
        "id,chapter_id,version_id,model_name,status,total_blocks,processed_blocks,error_message,created_at,finished_at",
      )
      .eq("book_id", bookId)
      .order("created_at", { ascending: false })
      .limit(20)
    const proposalsQuery = supabase
      .from("memory_proposals")
      .select(
        "id,run_id,chapter_id,version_id,proposal_kind,status,confidence,title,payload,evidence,explanation,source_block,source_anchor,review_note,approved_records,created_at",
      )
      .eq("book_id", bookId)
      .order("created_at", { ascending: false })
      .limit(200)
    if (analysisChapterId) {
      runsQuery.eq("chapter_id", analysisChapterId)
      proposalsQuery.eq("chapter_id", analysisChapterId)
    }
    const [
      userResult,
      bookResult,
      entityResult,
      factResult,
      relationResult,
      eventResult,
      eventEntityResult,
      threadResult,
      threadEntityResult,
      runsResult,
      proposalsResult,
    ] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("books").select("title").eq("id", bookId).maybeSingle(),
      supabase
        .from("universe_entities")
        .select("id,name,entity_type,summary,aliases,attributes,visibility,archived_at")
        .eq("book_id", bookId)
        .is("archived_at", null)
        .order("name"),
      supabase
        .from("canon_facts")
        .select("id,entity_id,statement,evidence,visibility,status,archived_at")
        .eq("book_id", bookId)
        .is("archived_at", null)
        .neq("status", "archived")
        .order("created_at"),
      supabase
        .from("universe_relations")
        .select("id,from_entity_id,to_entity_id,relation_type,description,visibility,archived_at")
        .eq("book_id", bookId)
        .is("archived_at", null)
        .order("created_at"),
      supabase
        .from("timeline_events")
        .select(
          "id,event_kind,title,description,narrative_time,visibility,status,archived_at,payload",
        )
        .eq("book_id", bookId)
        .is("archived_at", null)
        .eq("status", "active")
        .order("created_at", { ascending: false }),
      supabase.from("timeline_event_entities").select("event_id,entity_id"),
      supabase
        .from("open_threads")
        .select("id,title,description,status,priority,visibility,archived_at")
        .eq("book_id", bookId)
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("open_thread_entities").select("thread_id,entity_id"),
      runsQuery,
      proposalsQuery,
    ])

    setUserId(userResult.data.user?.id || null)
    if (bookResult.error || !bookResult.data) {
      setError(bookResult.error?.message || "Livro não encontrado.")
    } else {
      setBookTitle(bookResult.data.title)
    }
    if (
      entityResult.error ||
      factResult.error ||
      relationResult.error ||
      eventResult.error ||
      eventEntityResult.error ||
      threadResult.error ||
      threadEntityResult.error
    ) {
      setError(
        entityResult.error?.message ||
          factResult.error?.message ||
          relationResult.error?.message ||
          eventResult.error?.message ||
          eventEntityResult.error?.message ||
          threadResult.error?.message ||
          threadEntityResult.error?.message ||
          "Não foi possível carregar o Universo.",
      )
    } else {
      setEntities((entityResult.data || []) as Entity[])
      setFacts((factResult.data || []) as CanonFact[])
      setRelations((relationResult.data || []) as Relation[])
      const eventEntityIds = new Map<string, string[]>()
      for (const row of eventEntityResult.data || []) {
        eventEntityIds.set(row.event_id, [
          ...(eventEntityIds.get(row.event_id) || []),
          row.entity_id,
        ])
      }
      const threadEntityIds = new Map<string, string[]>()
      for (const row of threadEntityResult.data || []) {
        threadEntityIds.set(row.thread_id, [
          ...(threadEntityIds.get(row.thread_id) || []),
          row.entity_id,
        ])
      }
      setEvents(
        ((eventResult.data || []) as Omit<TimelineEvent, "entity_ids">[]).map((event) => ({
          ...event,
          entity_ids: eventEntityIds.get(event.id) || [],
        })),
      )
      setOpenThreads(
        ((threadResult.data || []) as Omit<OpenThread, "entity_ids">[]).map((thread) => ({
          ...thread,
          entity_ids: threadEntityIds.get(thread.id) || [],
        })),
      )
    }
    if (runsResult.error || proposalsResult.error) {
      setAnalysisError(
        "As propostas ainda não estão disponíveis. Aplique as migrations 0011, 0012, 0014, 0015 e 0016 no Supabase para ativar a análise de memória.",
      )
      setAnalysisRuns([])
      setProposals([])
      setAnalysisRun(null)
    } else {
      const loadedRuns = (runsResult.data || []) as AnalysisRun[]
      setAnalysisRuns(loadedRuns)
      setAnalysisRun(loadedRuns[0] ?? null)
      setProposals((proposalsResult.data || []) as MemoryProposal[])
    }
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, searchParams])

  function clearFeedback() {
    setError("")
    setNotice("")
  }

  async function translatePendingProposals() {
    const model = window.localStorage.getItem("inertia:ollama:model") ?? ""
    if (!model) {
      setError("Selecione um modelo no indicador de IA local antes de traduzir as propostas.")
      return
    }
    const pending = proposals.filter((proposal) => proposal.status === "pending")
    if (!pending.length) {
      setNotice("Não há propostas pendentes para traduzir.")
      return
    }

    setTranslatingProposals(true)
    setTranslationProgress({ done: 0, total: pending.length })
    clearFeedback()
    const failures: string[] = []
    let translatedCount = 0
    try {
      for (let index = 0; index < pending.length; index += 1) {
        const proposal = pending[index]
        setProposalActionId(proposal.id)
        try {
          const translated = await translateMemoryProposalToPortuguese(model, {
            proposal_kind: proposal.proposal_kind,
            title: proposal.title,
            payload: proposal.payload,
            explanation: proposal.explanation,
          })
          const result = await supabase
            .from("memory_proposals")
            .update({
              title: translated.title,
              explanation: translated.explanation,
              payload: translated.payload,
            })
            .eq("id", proposal.id)
            .eq("status", "pending")
          if (result.error) throw new Error(result.error.message)
          translatedCount += 1
        } catch (caught) {
          failures.push(
            `${proposal.title}: ${caught instanceof Error ? caught.message : "falha desconhecida"}`,
          )
        } finally {
          setProposalActionId(null)
          setTranslationProgress({ done: index + 1, total: pending.length })
        }
      }
      if (failures.length) {
        setError(
          `${translatedCount} proposta(s) traduzida(s). ${failures.length} falharam: ${failures.join(" | ")}`,
        )
      } else {
        setNotice(`${translatedCount} proposta(s) traduzida(s) para português brasileiro.`)
      }
      await load()
    } finally {
      setTranslatingProposals(false)
      window.setTimeout(() => setTranslationProgress({ done: 0, total: 0 }), 500)
    }
  }

  function startProposalEdit(proposal: MemoryProposal) {
    clearFeedback()
    setEditingProposalId(proposal.id)
    setProposalEditPayload(JSON.stringify(proposal.payload || {}, null, 2))
  }

  function cancelProposalEdit() {
    setEditingProposalId(null)
    setProposalEditPayload("{}")
  }

  async function approveProposal(proposal: MemoryProposal) {
    let editedPayload: Record<string, unknown> | null = null
    if (editingProposalId === proposal.id) {
      try {
        const parsed = JSON.parse(proposalEditPayload || "{}")
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error()
        editedPayload = parsed as Record<string, unknown>
      } catch {
        setError("O payload editado precisa ser um objeto JSON válido.")
        return
      }
    }

    setProposalActionId(proposal.id)
    clearFeedback()
    const result = await supabase.rpc("approve_memory_proposal", {
      target_proposal_id: proposal.id,
      edited_payload: editedPayload,
    })
    if (result.error) {
      setError("Não foi possível adicionar a proposta ao Universo: " + result.error.message)
    } else {
      setNotice("Proposta adicionada ao Universo canônico. A decisão ficou registrada.")
      cancelProposalEdit()
      await load()
    }
    setProposalActionId(null)
  }

  async function reopenEventProposal(proposal: MemoryProposal) {
    if (proposal.proposal_kind !== "event") return
    const eventId = (proposal.approved_records || []).find(
      (record) => typeof record.event_id === "string",
    )?.event_id
    if (!eventId) {
      setError("Não encontrei o evento canônico vinculado a esta proposta.")
      return
    }
    if (
      !window.confirm(
        `Reabrir “${proposal.title}” para corrigir o payload e aprovar novamente? O evento será desarquivado, sem criar uma duplicata.`,
      )
    )
      return

    setProposalActionId(proposal.id)
    clearFeedback()
    const result = await supabase.rpc("reopen_memory_event_for_approval", {
      target_event_id: eventId,
    })
    if (result.error) {
      setError("Não foi possível reabrir o evento: " + result.error.message)
    } else {
      setNotice(
        "Evento desarquivado e proposta reaberta. Revise o JSON antes de aprovar novamente.",
      )
      await load()
    }
    setProposalActionId(null)
  }

  async function rejectProposal(proposal: MemoryProposal) {
    if (!window.confirm(`Ignorar a proposta “${proposal.title}”?`)) return
    setProposalActionId(proposal.id)
    clearFeedback()
    const result = await supabase.rpc("reject_memory_proposal", {
      target_proposal_id: proposal.id,
      review_note: "Ignorada pelos autores.",
    })
    if (result.error) {
      setError("Não foi possível ignorar a proposta: " + result.error.message)
    } else {
      setNotice("Proposta ignorada. Ela não foi adicionada ao Universo.")
      await load()
    }
    setProposalActionId(null)
  }

  function startEntityCreate() {
    clearFeedback()
    setEditingEntityId(null)
    setEntityDraft(emptyEntityDraft)
    setShowEntityForm(true)
  }

  function startEntityEdit(entity: Entity) {
    clearFeedback()
    setEditingEntityId(entity.id)
    setEntityDraft({
      name: entity.name,
      entity_type: entity.entity_type,
      summary: entity.summary,
      aliases: entity.aliases.join(", "),
      attributes: JSON.stringify(entity.attributes || {}, null, 2),
      visibility: entity.visibility,
    })
    setShowEntityForm(true)
  }

  function cancelEntityForm() {
    setEditingEntityId(null)
    setShowEntityForm(false)
    setEntityDraft(emptyEntityDraft)
  }

  async function saveEntity() {
    if (!userId) return
    const name = entityDraft.name.trim()
    if (!name) {
      setError("Informe um nome para a entidade.")
      return
    }

    let attributes: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(entityDraft.attributes || "{}")
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error()
      attributes = parsed as Record<string, unknown>
    } catch {
      setError('Atributos devem ser um objeto JSON válido, como {"idade": 32}.')
      return
    }

    const aliases = entityDraft.aliases
      .split(/[\n,]/)
      .map((alias) => alias.trim())
      .filter(Boolean)
    setSaving(true)
    clearFeedback()
    const payload = {
      name,
      entity_type: entityDraft.entity_type,
      summary: entityDraft.summary.trim(),
      aliases,
      attributes,
      visibility: entityDraft.visibility,
      updated_by: userId,
    }
    const result = editingEntityId
      ? await supabase.from("universe_entities").update(payload).eq("id", editingEntityId)
      : await supabase
          .from("universe_entities")
          .insert({ ...payload, book_id: bookId, created_by: userId })

    if (result.error) {
      setError("Não foi possível salvar a entidade: " + result.error.message)
    } else {
      setNotice(editingEntityId ? "Entidade atualizada." : "Entidade adicionada ao Universo.")
      cancelEntityForm()
      await load()
    }
    setSaving(false)
  }

  async function archiveEntity(entity: Entity) {
    if (!userId || !window.confirm(`Arquivar “${entity.name}” e suas relações?`)) return
    setSaving(true)
    clearFeedback()
    const result = await supabase
      .from("universe_entities")
      .update({ archived_at: new Date().toISOString(), updated_by: userId })
      .eq("id", entity.id)
    if (result.error) setError("Não foi possível arquivar a entidade: " + result.error.message)
    else {
      setNotice("Entidade arquivada. O histórico não foi apagado.")
      await load()
    }
    setSaving(false)
  }

  function startFactCreate() {
    clearFeedback()
    setEditingFactId(null)
    setFactDraft({ ...emptyFactDraft, entity_id: entities[0]?.id || "" })
    setShowFactForm(true)
  }

  function startFactEdit(fact: CanonFact) {
    clearFeedback()
    setEditingFactId(fact.id)
    setFactDraft({
      entity_id: fact.entity_id || "",
      statement: fact.statement,
      evidence: fact.evidence,
      visibility: fact.visibility,
    })
    setShowFactForm(true)
  }

  function cancelFactForm() {
    setEditingFactId(null)
    setShowFactForm(false)
    setFactDraft(emptyFactDraft)
  }

  async function saveFact() {
    if (!userId) return
    const statement = factDraft.statement.trim()
    if (!statement) {
      setError("Escreva o fato que deve ser preservado no Universo.")
      return
    }
    setSaving(true)
    clearFeedback()
    const payload = {
      entity_id: factDraft.entity_id || null,
      statement,
      evidence: factDraft.evidence.trim(),
      visibility: factDraft.visibility,
      updated_by: userId,
    }
    const result = editingFactId
      ? await supabase.from("canon_facts").update(payload).eq("id", editingFactId)
      : await supabase
          .from("canon_facts")
          .insert({ ...payload, book_id: bookId, created_by: userId })
    if (result.error) setError("Não foi possível salvar o fato: " + result.error.message)
    else {
      setNotice(editingFactId ? "Fato atualizado." : "Fato adicionado ao Universo.")
      cancelFactForm()
      await load()
    }
    setSaving(false)
  }

  async function archiveFact(fact: CanonFact) {
    if (!userId || !window.confirm("Arquivar este fato? O histórico não será apagado.")) return
    setSaving(true)
    clearFeedback()
    const result = await supabase
      .from("canon_facts")
      .update({ archived_at: new Date().toISOString(), status: "archived", updated_by: userId })
      .eq("id", fact.id)
    if (result.error) setError("Não foi possível arquivar o fato: " + result.error.message)
    else {
      setNotice("Fato arquivado.")
      await load()
    }
    setSaving(false)
  }

  function startRelationCreate() {
    clearFeedback()
    setEditingRelationId(null)
    setRelationDraft({
      ...emptyRelationDraft,
      from_entity_id: entities[0]?.id || "",
      to_entity_id: entities[1]?.id || entities[0]?.id || "",
    })
    setShowRelationForm(true)
  }

  function startRelationEdit(relation: Relation) {
    clearFeedback()
    setEditingRelationId(relation.id)
    setRelationDraft({
      from_entity_id: relation.from_entity_id,
      to_entity_id: relation.to_entity_id,
      relation_type: relation.relation_type,
      description: relation.description,
      visibility: relation.visibility,
    })
    setShowRelationForm(true)
  }

  function cancelRelationForm() {
    setEditingRelationId(null)
    setShowRelationForm(false)
    setRelationDraft(emptyRelationDraft)
  }

  async function saveRelation() {
    if (!userId) return
    const relationType = relationDraft.relation_type.trim()
    if (!relationDraft.from_entity_id || !relationDraft.to_entity_id || !relationType) {
      setError("Escolha duas entidades e descreva a relação entre elas.")
      return
    }
    if (relationDraft.from_entity_id === relationDraft.to_entity_id) {
      setError("Uma entidade não pode se relacionar consigo mesma.")
      return
    }
    setSaving(true)
    clearFeedback()
    const payload = {
      from_entity_id: relationDraft.from_entity_id,
      to_entity_id: relationDraft.to_entity_id,
      relation_type: relationType,
      description: relationDraft.description.trim(),
      visibility: relationDraft.visibility,
      updated_by: userId,
    }
    const result = editingRelationId
      ? await supabase.from("universe_relations").update(payload).eq("id", editingRelationId)
      : await supabase
          .from("universe_relations")
          .insert({ ...payload, book_id: bookId, created_by: userId })
    if (result.error) setError("Não foi possível salvar a relação: " + result.error.message)
    else {
      setNotice(editingRelationId ? "Relação atualizada." : "Relação adicionada ao Universo.")
      cancelRelationForm()
      await load()
    }
    setSaving(false)
  }

  async function archiveRelation(relation: Relation) {
    if (!userId || !window.confirm("Arquivar esta relação? O histórico não será apagado.")) return
    setSaving(true)
    clearFeedback()
    const result = await supabase
      .from("universe_relations")
      .update({ archived_at: new Date().toISOString(), updated_by: userId })
      .eq("id", relation.id)
    if (result.error) setError("Não foi possível arquivar a relação: " + result.error.message)
    else {
      setNotice("Relação arquivada.")
      await load()
    }
    setSaving(false)
  }

  function startEventCreate() {
    clearFeedback()
    setEditingEventId(null)
    setEventDraft(emptyEventDraft)
    setShowEventForm(true)
  }

  function startEventEdit(event: TimelineEvent) {
    clearFeedback()
    const view = eventPayloadView(event)
    const payloadEntityIds = view.entityNames
      .map(
        (name) =>
          entities.find((entity) => entity.name.trim().toLowerCase() === name.toLowerCase())?.id,
      )
      .filter((entityId): entityId is string => Boolean(entityId))
    setEditingEventId(event.id)
    setEventDraft({
      event_kind: view.kind,
      title: view.title,
      description: view.description,
      narrative_time: view.narrativeTime,
      entity_ids: event.entity_ids.length ? event.entity_ids : payloadEntityIds,
      visibility: view.visibility,
    })
    setShowEventForm(true)
  }

  function cancelEventForm() {
    setEditingEventId(null)
    setShowEventForm(false)
    setEventDraft(emptyEventDraft)
  }

  async function saveEvent() {
    if (!userId) return
    const title = eventDraft.title.trim()
    if (!title) {
      setError("Informe um título para o evento.")
      return
    }
    setSaving(true)
    clearFeedback()
    const description = eventDraft.description.trim()
    const narrativeTime = eventDraft.narrative_time.trim()
    const involvedEntityNames = eventDraft.entity_ids
      .map((entityId) => entities.find((entity) => entity.id === entityId)?.name)
      .filter((name): name is string => Boolean(name))
    const payload = {
      event_kind: eventDraft.event_kind,
      title,
      description,
      narrative_time: narrativeTime,
      entities_involved: involvedEntityNames,
      source_kind: "author",
      visibility: eventDraft.visibility,
      payload: {
        event_kind: eventDraft.event_kind,
        title,
        description,
        narrative_time: narrativeTime,
        entities_involved: involvedEntityNames,
        source_kind: "author",
        visibility: eventDraft.visibility,
      },
      updated_by: userId,
    }
    const result = editingEventId
      ? await supabase.from("timeline_events").update(payload).eq("id", editingEventId)
      : await supabase
          .from("timeline_events")
          .insert({ ...payload, book_id: bookId, source_kind: "author", created_by: userId })
          .select("id")
          .maybeSingle()
    if (result.error) {
      setError("Não foi possível salvar o evento: " + result.error.message)
      setSaving(false)
      return
    }

    const eventId = editingEventId || String(result.data?.id || "")
    if (!eventId) {
      setError("O evento foi salvo, mas seu identificador não foi retornado.")
      setSaving(false)
      return
    }
    const clearLinks = await supabase
      .from("timeline_event_entities")
      .delete()
      .eq("event_id", eventId)
    if (clearLinks.error) {
      setError(
        "Evento salvo, mas não foi possível atualizar suas entidades: " + clearLinks.error.message,
      )
      setSaving(false)
      return
    }
    if (eventDraft.entity_ids.length) {
      const links = await supabase
        .from("timeline_event_entities")
        .insert(
          eventDraft.entity_ids.map((entityId) => ({ event_id: eventId, entity_id: entityId })),
        )
      if (links.error) {
        setError("Evento salvo, mas não foi possível vincular as entidades: " + links.error.message)
        setSaving(false)
        return
      }
    }
    setNotice(editingEventId ? "Evento atualizado." : "Evento adicionado ao Universo.")
    cancelEventForm()
    await load()
    setSaving(false)
  }

  async function archiveEvent(event: TimelineEvent) {
    if (!userId || !window.confirm(`Arquivar “${event.title}”? O histórico não será apagado.`))
      return
    setSaving(true)
    clearFeedback()
    const result = await supabase
      .from("timeline_events")
      .update({ archived_at: new Date().toISOString(), status: "archived", updated_by: userId })
      .eq("id", event.id)
    if (result.error) setError("Não foi possível arquivar o evento: " + result.error.message)
    else {
      setNotice("Evento arquivado.")
      await load()
    }
    setSaving(false)
  }

  function startThreadCreate() {
    clearFeedback()
    setEditingThreadId(null)
    setThreadDraft(emptyThreadDraft)
    setShowThreadForm(true)
  }

  function startThreadEdit(thread: OpenThread) {
    clearFeedback()
    setEditingThreadId(thread.id)
    setThreadDraft({
      title: thread.title,
      description: thread.description,
      status: thread.status,
      priority: thread.priority,
      entity_ids: thread.entity_ids,
      visibility: thread.visibility,
    })
    setShowThreadForm(true)
  }

  function cancelThreadForm() {
    setEditingThreadId(null)
    setShowThreadForm(false)
    setThreadDraft(emptyThreadDraft)
  }

  async function saveThread() {
    if (!userId) return
    const title = threadDraft.title.trim()
    if (!title) {
      setError("Informe um título para a trama aberta.")
      return
    }
    setSaving(true)
    clearFeedback()
    const payload = {
      title,
      description: threadDraft.description.trim(),
      status: threadDraft.status,
      priority: threadDraft.priority,
      visibility: threadDraft.visibility,
      updated_by: userId,
    }
    const result = editingThreadId
      ? await supabase.from("open_threads").update(payload).eq("id", editingThreadId)
      : await supabase
          .from("open_threads")
          .insert({ ...payload, book_id: bookId, source_kind: "author", created_by: userId })
          .select("id")
          .maybeSingle()
    if (result.error) {
      setError("Não foi possível salvar a trama aberta: " + result.error.message)
      setSaving(false)
      return
    }

    const threadId = editingThreadId || String(result.data?.id || "")
    if (!threadId) {
      setError("A trama foi salva, mas seu identificador não foi retornado.")
      setSaving(false)
      return
    }
    const clearLinks = await supabase
      .from("open_thread_entities")
      .delete()
      .eq("thread_id", threadId)
    if (clearLinks.error) {
      setError(
        "Trama salva, mas não foi possível atualizar suas entidades: " + clearLinks.error.message,
      )
      setSaving(false)
      return
    }
    if (threadDraft.entity_ids.length) {
      const links = await supabase
        .from("open_thread_entities")
        .insert(
          threadDraft.entity_ids.map((entityId) => ({ thread_id: threadId, entity_id: entityId })),
        )
      if (links.error) {
        setError("Trama salva, mas não foi possível vincular as entidades: " + links.error.message)
        setSaving(false)
        return
      }
    }
    setNotice(editingThreadId ? "Trama aberta atualizada." : "Trama aberta adicionada ao Universo.")
    cancelThreadForm()
    await load()
    setSaving(false)
  }

  async function archiveThread(thread: OpenThread) {
    if (!userId || !window.confirm(`Arquivar “${thread.title}”? O histórico não será apagado.`))
      return
    setSaving(true)
    clearFeedback()
    const result = await supabase
      .from("open_threads")
      .update({ archived_at: new Date().toISOString(), updated_by: userId })
      .eq("id", thread.id)
    if (result.error) setError("Não foi possível arquivar a trama: " + result.error.message)
    else {
      setNotice("Trama aberta arquivada.")
      await load()
    }
    setSaving(false)
  }

  function renderVisibility(value: Visibility) {
    return value === "author_only" ? "Somente autores" : "Cânone"
  }

  if (loading) {
    return <main className="min-h-screen bg-[#f6f1ea] p-6 text-[#253126]">Abrindo Universo…</main>
  }

  return (
    <main className="min-h-screen bg-[#f6f1ea] px-4 py-6 text-[#253126] sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <Link href={`/app/livro/${bookId}`} className="text-sm font-semibold text-[#65735f]">
              ← {bookTitle || "Livro"}
            </Link>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-[#8d6d4c]">
              Sprint 3 · Memória manual
            </p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight">Universo</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#687065]">
              Um espaço editado pelos autores para registrar o que é verdadeiro na obra. A IA não
              altera estas informações diretamente.
            </p>
          </div>
          <Link
            href={`/app/livro/${bookId}`}
            className="shrink-0 rounded-full border border-[#d5c9bd] bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#687065] transition hover:bg-white"
          >
            Voltar ao livro
          </Link>
        </header>

        <section className="mt-6 rounded-3xl border border-[#d7c7ae] bg-[#fff8e9] p-5 shadow-sm sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8d6d4c]">
            Regra do cânone
          </p>
          <p className="mt-2 text-sm leading-6 text-[#6f5739]">
            Registros aqui são manuais e podem ser arquivados, mas não são apagados pela interface.
            Sugestões futuras da IA entrarão primeiro como propostas pendentes.
          </p>
        </section>

        {(error || notice) && (
          <div
            className={
              "mt-5 rounded-2xl p-4 text-sm " +
              (error ? "bg-[#fbe8e3] text-[#8d493b]" : "bg-[#e8eee5] text-[#52614e]")
            }
          >
            {error || notice}
          </div>
        )}

        <section className="mt-6 overflow-hidden rounded-3xl border border-[#d7c7ae] bg-white/80 shadow-sm">
          <div className="flex overflow-x-auto border-b border-[#e3d8cc] px-3 pt-3 sm:px-5">
            {(
              [
                ["entities", "Entidades", entities.length],
                ["facts", "Fatos", facts.length],
                ["relations", "Relações", relations.length],
                ["events", "Eventos", events.length],
                ["threads", "Tramas abertas", openThreads.length],
                ["analysis", "Propostas", proposals.length],
              ] as const
            ).map(([tab, label, count]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition " +
                  (activeTab === tab
                    ? "border-[#65735f] text-[#52614e]"
                    : "border-transparent text-[#8b887f] hover:text-[#65735f]")
                }
              >
                {label} <span className="ml-1 text-xs opacity-70">{count}</span>
              </button>
            ))}
          </div>

          <div className="p-5 sm:p-6">
            {activeTab === "entities" && (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8d6d4c]">
                      Núcleo do Universo
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold">Entidades</h2>
                    <p className="mt-2 text-sm text-[#687065]">
                      Personagens, locais, facções, poderes, itens e conceitos importantes.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={startEntityCreate}
                    className="shrink-0 rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#52614e]"
                  >
                    Nova entidade
                  </button>
                </div>

                {showEntityForm && (
                  <div className="mt-5 rounded-2xl border border-[#d7c7ae] bg-[#f6f1ea] p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold">
                        Nome
                        <input
                          value={entityDraft.name}
                          onChange={(event) =>
                            setEntityDraft((current) => ({ ...current, name: event.target.value }))
                          }
                          maxLength={240}
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                          autoFocus
                        />
                      </label>
                      <label className="text-sm font-semibold">
                        Tipo
                        <select
                          value={entityDraft.entity_type}
                          onChange={(event) =>
                            setEntityDraft((current) => ({
                              ...current,
                              entity_type: event.target.value as EntityType,
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                        >
                          {Object.entries(entityTypeLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="mt-3 block text-sm font-semibold">
                      Resumo
                      <textarea
                        value={entityDraft.summary}
                        onChange={(event) =>
                          setEntityDraft((current) => ({ ...current, summary: event.target.value }))
                        }
                        maxLength={20000}
                        rows={3}
                        className="mt-1 w-full resize-y rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal leading-6 outline-none focus:border-[#8d6d4c]"
                        placeholder="O que os autores precisam lembrar sobre esta entidade?"
                      />
                    </label>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold">
                        Apelidos
                        <input
                          value={entityDraft.aliases}
                          onChange={(event) =>
                            setEntityDraft((current) => ({
                              ...current,
                              aliases: event.target.value,
                            }))
                          }
                          placeholder="Separados por vírgula"
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                        />
                      </label>
                      <label className="text-sm font-semibold">
                        Visibilidade
                        <select
                          value={entityDraft.visibility}
                          onChange={(event) =>
                            setEntityDraft((current) => ({
                              ...current,
                              visibility: event.target.value as Visibility,
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                        >
                          <option value="canon">Cânone</option>
                          <option value="author_only">Somente autores</option>
                        </select>
                      </label>
                    </div>
                    <label className="mt-3 block text-sm font-semibold">
                      Atributos flexíveis em JSON
                      <textarea
                        value={entityDraft.attributes}
                        onChange={(event) =>
                          setEntityDraft((current) => ({
                            ...current,
                            attributes: event.target.value,
                          }))
                        }
                        rows={3}
                        className="mt-1 w-full resize-y rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-mono text-xs font-normal leading-5 outline-none focus:border-[#8d6d4c]"
                        placeholder={'{"idade": 32, "olhos": "verdes"}'}
                      />
                    </label>
                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelEntityForm}
                        disabled={saving}
                        className="rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 text-sm font-semibold text-[#687065] disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveEntity()}
                        disabled={saving}
                        className="rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {saving ? "Salvando…" : "Salvar entidade"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-5 space-y-3">
                  {entities.length === 0 ? (
                    <p className="rounded-2xl bg-[#f6f1ea] p-5 text-sm text-[#687065]">
                      Nenhuma entidade registrada ainda.
                    </p>
                  ) : (
                    entities.map((entity) => (
                      <article key={entity.id} className="rounded-2xl bg-[#f6f1ea] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold">{entity.name}</h3>
                              <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#8d6d4c]">
                                {entityTypeLabels[entity.entity_type]}
                              </span>
                              {entity.visibility === "author_only" && (
                                <span className="rounded-full bg-[#f2e4d7] px-2 py-1 text-[11px] font-semibold text-[#8d6d4c]">
                                  Somente autores
                                </span>
                              )}
                            </div>
                            {entity.summary && (
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#687065]">
                                {entity.summary}
                              </p>
                            )}
                            {entity.aliases.length > 0 && (
                              <p className="mt-2 text-xs text-[#8b887f]">
                                Também: {entity.aliases.join(", ")}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => startEntityEdit(entity)}
                              className="text-xs font-semibold text-[#65735f] hover:underline"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void archiveEntity(entity)}
                              disabled={saving}
                              className="text-xs font-semibold text-[#8d493b] hover:underline disabled:opacity-50"
                            >
                              Arquivar
                            </button>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "facts" && (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8d6d4c]">
                      Memória factual
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold">Fatos canônicos</h2>
                    <p className="mt-2 text-sm text-[#687065]">
                      Afirmações que devem ser tratadas como verdadeiras quando a memória for usada.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={startFactCreate}
                    disabled={entities.length === 0}
                    className="shrink-0 rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#52614e] disabled:opacity-50"
                  >
                    Novo fato
                  </button>
                </div>
                {entities.length === 0 && (
                  <p className="mt-4 rounded-xl bg-[#fff8e9] p-3 text-xs leading-5 text-[#6f5739]">
                    Cadastre ao menos uma entidade antes de criar fatos ligados a ela. Fatos sem
                    entidade poderão ser adicionados em uma etapa posterior.
                  </p>
                )}
                {showFactForm && (
                  <div className="mt-5 rounded-2xl border border-[#d7c7ae] bg-[#f6f1ea] p-4">
                    <label className="block text-sm font-semibold">
                      Entidade relacionada
                      <select
                        value={factDraft.entity_id}
                        onChange={(event) =>
                          setFactDraft((current) => ({ ...current, entity_id: event.target.value }))
                        }
                        className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                      >
                        <option value="">Fato geral da obra</option>
                        {entities.map((entity) => (
                          <option key={entity.id} value={entity.id}>
                            {entity.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="mt-3 block text-sm font-semibold">
                      Fato
                      <textarea
                        value={factDraft.statement}
                        onChange={(event) =>
                          setFactDraft((current) => ({ ...current, statement: event.target.value }))
                        }
                        rows={3}
                        maxLength={4000}
                        className="mt-1 w-full resize-y rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal leading-6 outline-none focus:border-[#8d6d4c]"
                        placeholder="Ex.: Lira não consegue atravessar água corrente."
                        autoFocus
                      />
                    </label>
                    <label className="mt-3 block text-sm font-semibold">
                      Evidência ou observação dos autores
                      <textarea
                        value={factDraft.evidence}
                        onChange={(event) =>
                          setFactDraft((current) => ({ ...current, evidence: event.target.value }))
                        }
                        rows={2}
                        maxLength={10000}
                        className="mt-1 w-full resize-y rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal leading-6 outline-none focus:border-[#8d6d4c]"
                        placeholder="Por que este fato é canônico?"
                      />
                    </label>
                    <label className="mt-3 block text-sm font-semibold">
                      Visibilidade
                      <select
                        value={factDraft.visibility}
                        onChange={(event) =>
                          setFactDraft((current) => ({
                            ...current,
                            visibility: event.target.value as Visibility,
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                      >
                        <option value="canon">Cânone</option>
                        <option value="author_only">Somente autores</option>
                      </select>
                    </label>
                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelFactForm}
                        disabled={saving}
                        className="rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 text-sm font-semibold text-[#687065] disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveFact()}
                        disabled={saving}
                        className="rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {saving ? "Salvando…" : "Salvar fato"}
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-5 space-y-3">
                  {facts.length === 0 ? (
                    <p className="rounded-2xl bg-[#f6f1ea] p-5 text-sm text-[#687065]">
                      Nenhum fato registrado ainda.
                    </p>
                  ) : (
                    facts.map((fact) => (
                      <article key={fact.id} className="rounded-2xl bg-[#f6f1ea] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="leading-6">{fact.statement}</p>
                            <p className="mt-2 text-xs text-[#8b887f]">
                              {fact.entity_id
                                ? entityById.get(fact.entity_id)?.name || "Entidade arquivada"
                                : "Fato geral da obra"}{" "}
                              · {renderVisibility(fact.visibility)}
                            </p>
                            {fact.evidence && (
                              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#687065]">
                                Evidência: {fact.evidence}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => startFactEdit(fact)}
                              className="text-xs font-semibold text-[#65735f] hover:underline"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void archiveFact(fact)}
                              disabled={saving}
                              className="text-xs font-semibold text-[#8d493b] hover:underline disabled:opacity-50"
                            >
                              Arquivar
                            </button>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "relations" && (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8d6d4c]">
                      Conexões do Universo
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold">Relações</h2>
                    <p className="mt-2 text-sm text-[#687065]">
                      Registre vínculos direcionados entre entidades, como “pertence a” ou “teme”.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={startRelationCreate}
                    disabled={entities.length < 2}
                    className="shrink-0 rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#52614e] disabled:opacity-50"
                  >
                    Nova relação
                  </button>
                </div>
                {entities.length < 2 && (
                  <p className="mt-4 rounded-xl bg-[#fff8e9] p-3 text-xs leading-5 text-[#6f5739]">
                    Cadastre pelo menos duas entidades antes de criar uma relação.
                  </p>
                )}
                {showRelationForm && (
                  <div className="mt-5 rounded-2xl border border-[#d7c7ae] bg-[#f6f1ea] p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold">
                        De
                        <select
                          value={relationDraft.from_entity_id}
                          onChange={(event) =>
                            setRelationDraft((current) => ({
                              ...current,
                              from_entity_id: event.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                        >
                          {entities.map((entity) => (
                            <option key={entity.id} value={entity.id}>
                              {entity.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm font-semibold">
                        Para
                        <select
                          value={relationDraft.to_entity_id}
                          onChange={(event) =>
                            setRelationDraft((current) => ({
                              ...current,
                              to_entity_id: event.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                        >
                          {entities.map((entity) => (
                            <option key={entity.id} value={entity.id}>
                              {entity.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="mt-3 block text-sm font-semibold">
                      Tipo de relação
                      <input
                        value={relationDraft.relation_type}
                        onChange={(event) =>
                          setRelationDraft((current) => ({
                            ...current,
                            relation_type: event.target.value,
                          }))
                        }
                        maxLength={160}
                        placeholder="Ex.: protege, pertence a, rivaliza com"
                        className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                        autoFocus
                      />
                    </label>
                    <label className="mt-3 block text-sm font-semibold">
                      Observação
                      <textarea
                        value={relationDraft.description}
                        onChange={(event) =>
                          setRelationDraft((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        maxLength={4000}
                        rows={2}
                        className="mt-1 w-full resize-y rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal leading-6 outline-none focus:border-[#8d6d4c]"
                      />
                    </label>
                    <label className="mt-3 block text-sm font-semibold">
                      Visibilidade
                      <select
                        value={relationDraft.visibility}
                        onChange={(event) =>
                          setRelationDraft((current) => ({
                            ...current,
                            visibility: event.target.value as Visibility,
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                      >
                        <option value="canon">Cânone</option>
                        <option value="author_only">Somente autores</option>
                      </select>
                    </label>
                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelRelationForm}
                        disabled={saving}
                        className="rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 text-sm font-semibold text-[#687065] disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveRelation()}
                        disabled={saving}
                        className="rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {saving ? "Salvando…" : "Salvar relação"}
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-5 space-y-3">
                  {relations.length === 0 ? (
                    <p className="rounded-2xl bg-[#f6f1ea] p-5 text-sm text-[#687065]">
                      Nenhuma relação registrada ainda.
                    </p>
                  ) : (
                    relations.map((relation) => (
                      <article key={relation.id} className="rounded-2xl bg-[#f6f1ea] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">
                              {entityById.get(relation.from_entity_id)?.name ||
                                "Entidade arquivada"}
                              <span className="mx-2 font-normal text-[#8d6d4c]">
                                {relation.relation_type}
                              </span>
                              {entityById.get(relation.to_entity_id)?.name || "Entidade arquivada"}
                            </p>
                            {relation.description && (
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#687065]">
                                {relation.description}
                              </p>
                            )}
                            <p className="mt-2 text-xs text-[#8b887f]">
                              {renderVisibility(relation.visibility)}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => startRelationEdit(relation)}
                              className="text-xs font-semibold text-[#65735f] hover:underline"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void archiveRelation(relation)}
                              disabled={saving}
                              className="text-xs font-semibold text-[#8d493b] hover:underline disabled:opacity-50"
                            >
                              Arquivar
                            </button>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "events" && (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8d6d4c]">
                      Linha narrativa
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold">Eventos</h2>
                    <p className="mt-2 text-sm text-[#687065]">
                      Registre acontecimentos que já ocorreram na história. Eles só orientam a IA
                      quando estiverem visíveis como cânone.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={startEventCreate}
                    className="shrink-0 rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#52614e]"
                  >
                    Novo evento
                  </button>
                </div>
                {showEventForm && (
                  <div className="mt-5 rounded-2xl border border-[#d7c7ae] bg-[#f6f1ea] p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold">
                        Tipo
                        <select
                          value={eventDraft.event_kind}
                          onChange={(event) =>
                            setEventDraft((current) => ({
                              ...current,
                              event_kind: event.target.value as EventKind,
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                        >
                          {Object.entries(eventKindLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm font-semibold">
                        Título
                        <input
                          value={eventDraft.title}
                          onChange={(event) =>
                            setEventDraft((current) => ({ ...current, title: event.target.value }))
                          }
                          maxLength={240}
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                          placeholder="Ex.: Kalel encontra a estação"
                          autoFocus
                        />
                      </label>
                    </div>
                    <label className="mt-3 block text-sm font-semibold">
                      Descrição
                      <textarea
                        value={eventDraft.description}
                        onChange={(event) =>
                          setEventDraft((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        maxLength={4000}
                        rows={3}
                        className="mt-1 w-full resize-y rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal leading-6 outline-none focus:border-[#8d6d4c]"
                        placeholder="O que aconteceu, sem transformar o evento em uma ficha de personagem?"
                      />
                    </label>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold">
                        Quando ou em que fase?
                        <input
                          value={eventDraft.narrative_time}
                          onChange={(event) =>
                            setEventDraft((current) => ({
                              ...current,
                              narrative_time: event.target.value,
                            }))
                          }
                          maxLength={240}
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                          placeholder="Ex.: Antes da chegada ao farol"
                        />
                      </label>
                      <label className="text-sm font-semibold">
                        Visibilidade
                        <select
                          value={eventDraft.visibility}
                          onChange={(event) =>
                            setEventDraft((current) => ({
                              ...current,
                              visibility: event.target.value as Visibility,
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                        >
                          <option value="canon">Cânone</option>
                          <option value="author_only">Somente autores</option>
                        </select>
                      </label>
                    </div>
                    <label className="mt-3 block text-sm font-semibold">
                      Entidades envolvidas
                      <select
                        multiple
                        value={eventDraft.entity_ids}
                        onChange={(event) =>
                          setEventDraft((current) => ({
                            ...current,
                            entity_ids: Array.from(
                              event.target.selectedOptions,
                              (option) => option.value,
                            ),
                          }))
                        }
                        className="mt-1 min-h-24 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                      >
                        {entities.map((entity) => (
                          <option key={entity.id} value={entity.id}>
                            {entity.name}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-xs font-normal text-[#8b887f]">
                        Opcional. Use Ctrl ou Cmd para selecionar mais de uma.
                      </span>
                    </label>
                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelEventForm}
                        disabled={saving}
                        className="rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 text-sm font-semibold text-[#687065] disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveEvent()}
                        disabled={saving}
                        className="rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {saving ? "Salvando…" : "Salvar evento"}
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-5 space-y-3">
                  {events.length === 0 ? (
                    <p className="rounded-2xl bg-[#f6f1ea] p-5 text-sm text-[#687065]">
                      Nenhum evento registrado ainda.
                    </p>
                  ) : (
                    events.map((event) => (
                      <article key={event.id} className="rounded-2xl bg-[#f6f1ea] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8d6d4c]">
                              {eventKindLabels[eventPayloadView(event).kind]}
                            </p>
                            <h3 className="mt-1 font-semibold">{eventPayloadView(event).title}</h3>
                            {eventPayloadView(event).description && (
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#687065]">
                                {eventPayloadView(event).description}
                              </p>
                            )}
                            <p className="mt-2 text-xs text-[#8b887f]">
                              {eventPayloadView(event).narrativeTime ||
                                "Tempo narrativo não informado"}{" "}
                              · {renderVisibility(eventPayloadView(event).visibility)}
                            </p>
                            {event.entity_ids.length > 0 && (
                              <p className="mt-1 text-xs text-[#8b887f]">
                                Envolve:{" "}
                                {event.entity_ids
                                  .map((id) => entityById.get(id)?.name || "Entidade arquivada")
                                  .join(", ")}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => startEventEdit(event)}
                              className="text-xs font-semibold text-[#65735f] hover:underline"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void archiveEvent(event)}
                              disabled={saving}
                              className="text-xs font-semibold text-[#8d493b] hover:underline disabled:opacity-50"
                            >
                              Arquivar
                            </button>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "threads" && (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8d6d4c]">
                      Continuidade narrativa
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold">Tramas abertas</h2>
                    <p className="mt-2 text-sm text-[#687065]">
                      Acompanhe perguntas, conflitos e mistérios que ainda não foram resolvidos.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={startThreadCreate}
                    className="shrink-0 rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#52614e]"
                  >
                    Nova trama
                  </button>
                </div>
                {showThreadForm && (
                  <div className="mt-5 rounded-2xl border border-[#d7c7ae] bg-[#f6f1ea] p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold sm:col-span-2">
                        Título
                        <input
                          value={threadDraft.title}
                          onChange={(event) =>
                            setThreadDraft((current) => ({ ...current, title: event.target.value }))
                          }
                          maxLength={240}
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                          placeholder="Ex.: Quem deixou a estação abandonada?"
                          autoFocus
                        />
                      </label>
                      <label className="text-sm font-semibold">
                        Estado
                        <select
                          value={threadDraft.status}
                          onChange={(event) =>
                            setThreadDraft((current) => ({
                              ...current,
                              status: event.target.value as OpenThreadStatus,
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                        >
                          {Object.entries(threadStatusLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm font-semibold">
                        Prioridade
                        <select
                          value={threadDraft.priority}
                          onChange={(event) =>
                            setThreadDraft((current) => ({
                              ...current,
                              priority: event.target.value as ThreadPriority,
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                        >
                          {Object.entries(threadPriorityLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="mt-3 block text-sm font-semibold">
                      Descrição
                      <textarea
                        value={threadDraft.description}
                        onChange={(event) =>
                          setThreadDraft((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        maxLength={4000}
                        rows={3}
                        className="mt-1 w-full resize-y rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal leading-6 outline-none focus:border-[#8d6d4c]"
                        placeholder="Que pergunta, conflito ou mistério precisa continuar vivo?"
                      />
                    </label>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold">
                        Entidades relacionadas
                        <select
                          multiple
                          value={threadDraft.entity_ids}
                          onChange={(event) =>
                            setThreadDraft((current) => ({
                              ...current,
                              entity_ids: Array.from(
                                event.target.selectedOptions,
                                (option) => option.value,
                              ),
                            }))
                          }
                          className="mt-1 min-h-24 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                        >
                          {entities.map((entity) => (
                            <option key={entity.id} value={entity.id}>
                              {entity.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm font-semibold">
                        Visibilidade
                        <select
                          value={threadDraft.visibility}
                          onChange={(event) =>
                            setThreadDraft((current) => ({
                              ...current,
                              visibility: event.target.value as Visibility,
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 font-normal outline-none focus:border-[#8d6d4c]"
                        >
                          <option value="canon">Cânone</option>
                          <option value="author_only">Somente autores</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelThreadForm}
                        disabled={saving}
                        className="rounded-xl border border-[#d5c9bd] bg-white px-3 py-2 text-sm font-semibold text-[#687065] disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveThread()}
                        disabled={saving}
                        className="rounded-xl bg-[#65735f] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {saving ? "Salvando…" : "Salvar trama"}
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-5 space-y-3">
                  {openThreads.length === 0 ? (
                    <p className="rounded-2xl bg-[#f6f1ea] p-5 text-sm text-[#687065]">
                      Nenhuma trama aberta registrada ainda.
                    </p>
                  ) : (
                    openThreads.map((thread) => (
                      <article key={thread.id} className="rounded-2xl bg-[#f6f1ea] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold">{thread.title}</h3>
                              <span className="rounded-full bg-[#e4d7c6] px-2 py-1 text-xs font-semibold text-[#6f5739]">
                                {threadStatusLabels[thread.status]}
                              </span>
                              <span className="text-xs text-[#8b887f]">
                                Prioridade {threadPriorityLabels[thread.priority]}
                              </span>
                            </div>
                            {thread.description && (
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#687065]">
                                {thread.description}
                              </p>
                            )}
                            <p className="mt-2 text-xs text-[#8b887f]">
                              {renderVisibility(thread.visibility)}
                              {thread.entity_ids.length > 0 &&
                                ` · Relacionada a: ${thread.entity_ids.map((id) => entityById.get(id)?.name || "Entidade arquivada").join(", ")}`}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => startThreadEdit(thread)}
                              className="text-xs font-semibold text-[#65735f] hover:underline"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void archiveThread(thread)}
                              disabled={saving}
                              className="text-xs font-semibold text-[#8d493b] hover:underline disabled:opacity-50"
                            >
                              Arquivar
                            </button>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "analysis" && (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8d6d4c]">
                      Memória sob revisão humana
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold">Propostas da IA</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[#687065]">
                      A análise lê uma versão aprovada e sugere entidades, fatos, relações, eventos
                      e tramas abertas. Nada nesta aba vira cânone automaticamente.
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
                    {pendingProposalCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void translatePendingProposals()}
                        disabled={translatingProposals}
                        className="rounded-full border border-[#c7ad8e] bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#6f5739] transition hover:bg-white disabled:opacity-50"
                      >
                        {translatingProposals
                          ? `Traduzindo ${translationProgress.done}/${translationProgress.total}…`
                          : `Traduzir pendentes para PT-BR (${pendingProposalCount})`}
                      </button>
                    )}
                    <Link
                      href={`/app/livro/${bookId}`}
                      className="text-xs font-semibold text-[#65735f] underline underline-offset-2"
                    >
                      Voltar ao livro
                    </Link>
                  </div>
                </div>

                {analysisError && (
                  <p className="mt-5 rounded-2xl bg-[#fff8e9] p-4 text-sm leading-6 text-[#6f5739]">
                    {analysisError}
                  </p>
                )}

                {analysisRun && (
                  <article className="mt-5 rounded-2xl border border-[#d7c7ae] bg-[#fff8e9] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[#6f5739]">
                        Última análise · {analysisRun.model_name}
                      </p>
                      <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-semibold text-[#6f5739]">
                        {analysisRun.status === "completed"
                          ? "Concluída"
                          : analysisRun.status === "partial"
                            ? "Parcial"
                            : analysisRun.status === "failed"
                              ? "Falhou"
                              : "Em andamento"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[#8b6b49]">
                      {analysisRun.processed_blocks} de {analysisRun.total_blocks} bloco(s)
                      processado(s).
                      {analysisRun.error_message ? ` ${analysisRun.error_message}` : ""}
                    </p>
                    {analysisRun.chapter_id && (
                      <Link
                        href={`/app/livro/${bookId}/capitulo/${analysisRun.chapter_id}`}
                        className="mt-2 inline-block text-xs font-semibold text-[#65735f] underline underline-offset-2"
                      >
                        Abrir capítulo analisado
                      </Link>
                    )}
                  </article>
                )}

                {analysisRuns.length > 1 && (
                  <details className="mt-4 rounded-2xl border border-[#e3d8cc] p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-[#65735f]">
                      Ver histórico de análises ({analysisRuns.length})
                    </summary>
                    <div className="mt-3 space-y-2">
                      {analysisRuns.slice(1).map((run) => (
                        <div
                          key={run.id}
                          className="rounded-xl bg-[#f6f1ea] p-3 text-xs text-[#687065]"
                        >
                          {run.status} · {run.processed_blocks}/{run.total_blocks} bloco(s) ·{" "}
                          {run.model_name}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <div className="mt-5 space-y-3">
                  {proposals.length === 0 ? (
                    <p className="rounded-2xl bg-[#f6f1ea] p-5 text-sm leading-6 text-[#687065]">
                      Nenhuma proposta foi registrada para esta seleção. Volte ao capítulo, aprove
                      uma versão do Manuscrito e use “Analisar Memória”.
                    </p>
                  ) : (
                    proposals.map((proposal) => (
                      <article
                        key={proposal.id}
                        className="rounded-2xl border border-[#e3d8cc] bg-[#f6f1ea] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8d6d4c]">
                              {proposal.proposal_kind === "entity"
                                ? "Entidade"
                                : proposal.proposal_kind === "fact"
                                  ? "Fato"
                                  : proposal.proposal_kind === "relation"
                                    ? "Relação"
                                    : proposal.proposal_kind === "event"
                                      ? "Evento"
                                      : "Trama aberta"}
                            </p>
                            <h3 className="mt-1 text-lg font-semibold">{proposal.title}</h3>
                          </div>
                          <span
                            className={
                              "rounded-full px-2 py-1 text-xs font-semibold " +
                              (proposal.status === "pending"
                                ? "bg-[#fff8e9] text-[#8d6d4c]"
                                : proposal.status === "approved"
                                  ? "bg-[#e4f2dc] text-[#36552d]"
                                  : "bg-[#fbe8e3] text-[#8d493b]")
                            }
                          >
                            {proposal.status === "pending"
                              ? "Pendente"
                              : proposal.status === "approved"
                                ? "Aprovada"
                                : proposal.status === "rejected"
                                  ? "Ignorada"
                                  : "Substituída"}
                          </span>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-[#52614e]">
                          {proposal.explanation}
                        </p>
                        <blockquote className="mt-3 border-l-2 border-[#c7ad8e] pl-3 text-sm italic leading-6 text-[#687065]">
                          “{proposal.evidence}”
                        </blockquote>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#8b887f]">
                          <span>Bloco {proposal.source_block ?? "?"}</span>
                          <span>
                            Confiança:{" "}
                            {proposal.confidence == null
                              ? "—"
                              : `${Math.round(proposal.confidence * 100)}%`}
                          </span>
                        </div>
                        <details className="mt-3 rounded-xl bg-white/70 p-3">
                          <summary className="cursor-pointer text-xs font-semibold text-[#65735f]">
                            Ver dados estruturados e âncora
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#687065]">
                            {proposal.source_anchor}
                          </p>
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-[#52614e]">
                            {JSON.stringify(proposal.payload, null, 2)}
                          </pre>
                        </details>
                        {proposal.status === "pending" && editingProposalId === proposal.id ? (
                          <div className="mt-4 rounded-xl border border-[#d7c7ae] bg-white/70 p-3">
                            <label className="block text-xs font-semibold text-[#65735f]">
                              Editar dados antes de adicionar ao Universo
                              <textarea
                                value={proposalEditPayload}
                                onChange={(event) => setProposalEditPayload(event.target.value)}
                                rows={8}
                                spellCheck={false}
                                className="mt-2 w-full resize-y rounded-lg border border-[#d5c9bd] bg-white px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-[#8d6d4c]"
                                aria-label={`Payload editado da proposta ${proposal.title}`}
                              />
                            </label>
                            <div className="mt-3 flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                onClick={cancelProposalEdit}
                                disabled={translatingProposals || proposalActionId !== null}
                                className="rounded-lg border border-[#d5c9bd] px-3 py-2 text-xs font-semibold text-[#687065] disabled:opacity-50"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => void approveProposal(proposal)}
                                disabled={translatingProposals || proposalActionId !== null}
                                className="rounded-lg bg-[#65735f] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                              >
                                {proposalActionId === proposal.id
                                  ? "Adicionando…"
                                  : "Adicionar com edição"}
                              </button>
                            </div>
                          </div>
                        ) : proposal.status === "pending" ? (
                          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#e3d8cc] pt-3">
                            <button
                              type="button"
                              onClick={() => void approveProposal(proposal)}
                              disabled={translatingProposals || proposalActionId !== null}
                              className="rounded-lg bg-[#65735f] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              {proposalActionId === proposal.id
                                ? "Adicionando…"
                                : "Adicionar ao Universo"}
                            </button>
                            <button
                              type="button"
                              onClick={() => startProposalEdit(proposal)}
                              disabled={translatingProposals || proposalActionId !== null}
                              className="text-xs font-semibold text-[#65735f] underline underline-offset-2 disabled:opacity-50"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void rejectProposal(proposal)}
                              disabled={translatingProposals || proposalActionId !== null}
                              className="text-xs font-semibold text-[#8d493b] underline underline-offset-2 disabled:opacity-50"
                            >
                              Ignorar
                            </button>
                            <span className="text-xs text-[#8b887f]">Pendente não é cânone.</span>
                          </div>
                        ) : proposal.status === "approved" && proposal.proposal_kind === "event" ? (
                          <div className="mt-3 border-t border-[#e3d8cc] pt-3">
                            <button
                              type="button"
                              onClick={() => void reopenEventProposal(proposal)}
                              disabled={translatingProposals || proposalActionId !== null}
                              className="text-xs font-semibold text-[#8d6d4c] underline underline-offset-2 disabled:opacity-50"
                            >
                              {proposalActionId === proposal.id
                                ? "Reabrindo…"
                                : "Reabrir evento para corrigir e aprovar novamente"}
                            </button>
                            <p className="mt-1 text-xs text-[#8b887f]">
                              Reutiliza o mesmo registro canônico e não cria duplicata.
                            </p>
                          </div>
                        ) : proposal.review_note ? (
                          <p className="mt-3 text-xs text-[#8b887f]">
                            Nota: {proposal.review_note}
                          </p>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

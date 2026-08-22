import type {
  CanonicalMemoryContext,
  CanonicalMemoryEntity,
  CanonicalMemoryEvent,
  CanonicalMemoryFact,
  CanonicalMemoryOpenThread,
  CanonicalMemoryRelation,
} from "./ollama-browser"

export const CANON_RECONCILIATION_SCHEMA_VERSION = "universe-proposal-v5"
export const CANON_RECONCILIATION_PROMPT_VERSION = "canon-reconciliation-v1"
export const CANON_RECONCILIATION_MAX_PROPOSALS = 256

export type ReconciliationRecordType = "entity" | "fact" | "relation" | "event" | "open_thread"

export type ReconciliationOperation = "create" | "update" | "resolve" | "merge" | "archive"

export type ReconciliationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "superseded"
  | "archived"
  | "applied"

export type ReconciliationEvidenceKind = "story_quote" | "canon_record" | "author_input"

export type ReconciliationCertainty =
  | "explicit_fact"
  | "direct_derivation"
  | "possible_inference"
  | "author_defined"

export type ReconciliationBasisReference = {
  record_type: ReconciliationRecordType
  record_id: string
  role?: "primary" | "supporting" | "conflict"
}

export type ReconciliationTarget = Record<string, unknown>

export type CanonReconciliationProposal = {
  schema_version: typeof CANON_RECONCILIATION_SCHEMA_VERSION
  origin_kind: "canon_reconciliation"
  proposal_kind: ReconciliationRecordType
  operation: ReconciliationOperation
  title: string
  target: ReconciliationTarget
  payload: Record<string, unknown>
  basis: ReconciliationBasisReference[]
  evidence_kind: ReconciliationEvidenceKind
  evidence: string
  explanation: string
  certainty: ReconciliationCertainty
  confidence: number
  source_anchor: string
  dedupe_key: string
  status?: ReconciliationStatus
}

export type RawCanonReconciliationProposal = Partial<CanonReconciliationProposal> & {
  [key: string]: unknown
}

export type ReconciliationSource = {
  record_type: ReconciliationRecordType
  record_id: string
  source_role?: "approved_input" | "related_context"
}

export type CanonReconciliationRunInput = {
  bookId: string
  triggerKind?: "manual" | "approved_memory" | "batch"
  modelName: string
  promptVersion?: string
  contractVersion?: string
  inputHash: string
  sources: ReconciliationSource[]
}

export type CanonReconciliationRuleInput = CanonicalMemoryContext & {
  approvedSources?: ReconciliationSource[]
}

export type CanonReconciliationRuleOptions = {
  maxProposals?: number
}

const VALID_RECORD_TYPES = new Set<ReconciliationRecordType>([
  "entity",
  "fact",
  "relation",
  "event",
  "open_thread",
])

const VALID_OPERATIONS = new Set<ReconciliationOperation>([
  "create",
  "update",
  "resolve",
  "merge",
  "archive",
])

const VALID_EVIDENCE_KINDS = new Set<ReconciliationEvidenceKind>([
  "story_quote",
  "canon_record",
  "author_input",
])

const VALID_CERTAINTIES = new Set<ReconciliationCertainty>([
  "explicit_fact",
  "direct_derivation",
  "possible_inference",
  "author_defined",
])

const VALID_ENTITY_RELATION_ATTRIBUTES: Record<string, string> = {
  owner: "owns",
  owners: "owns",
  possessor: "owns",
  holder: "owns",
  dono: "owns",
  proprietario: "owns",
  proprietária: "owns",
  proprietario_atual: "owns",
  friend: "friend_of",
  friends: "friend_of",
  amigo: "friend_of",
  amigos: "friend_of",
  amizade: "friend_of",
  sibling: "sibling_of",
  siblings: "sibling_of",
  irmao: "sibling_of",
  irmaos: "sibling_of",
  irma: "sibling_of",
  irmas: "sibling_of",
  family: "related_to",
  familia: "related_to",
  member_of: "member_of",
  member: "member_of",
  organization: "member_of",
  organizacao: "member_of",
  organizacao_a: "member_of",
  faction: "member_of",
  faccao: "member_of",
  afiliacao: "member_of",
  afiliacao_a: "member_of",
  affiliation: "member_of",
}

const SYMMETRIC_RELATIONS = new Set(["friend_of", "sibling_of", "related_to"])

function normalizePart(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function trimText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : {}
}

function asRecordType(value: unknown): ReconciliationRecordType | null {
  const normalized = String(value ?? "") as ReconciliationRecordType
  return VALID_RECORD_TYPES.has(normalized) ? normalized : null
}

function asOperation(value: unknown): ReconciliationOperation | null {
  const normalized = String(value ?? "") as ReconciliationOperation
  return VALID_OPERATIONS.has(normalized) ? normalized : null
}

function asEvidenceKind(value: unknown): ReconciliationEvidenceKind {
  const normalized = String(value ?? "") as ReconciliationEvidenceKind
  return VALID_EVIDENCE_KINDS.has(normalized) ? normalized : "canon_record"
}

function asCertainty(value: unknown): ReconciliationCertainty {
  const normalized = String(value ?? "") as ReconciliationCertainty
  return VALID_CERTAINTIES.has(normalized) ? normalized : "possible_inference"
}

function asConfidence(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0.5
  return Math.min(1, Math.max(0, Number(parsed.toFixed(3))))
}

function sourceKey(recordType: ReconciliationRecordType, recordId: string) {
  return `${recordType}:${recordId}`
}

function inferFactType(statement: string): NonNullable<CanonicalMemoryFact["fact_type"]> {
  const normalized = normalizePart(statement)
  if (/\b(?:recebeu|ganhou|possui|tem|usa|usou|perdeu)\b/.test(normalized)) return "possession"
  if (/\b(?:poder|poderes|habilidade|domina)\b/.test(normalized)) return "ability"
  if (/\b(?:irmao|irma|pai|mae|filho|amigo|inimigo|membro|pertence|integra)\b/.test(normalized)) return "other"
  if (/\b(?:olhos|cabelos|cicatriz|aparencia|aparência)\b/.test(normalized)) return "appearance"
  if (/\b(?:nasceu|origem|vem de)\b/.test(normalized)) return "origin"
  return "other"
}

export function adaptCanonContextToV5(context: CanonicalMemoryContext): CanonicalMemoryContext {
  const entityNames = new Map(context.entities.map((entity) => [entity.id, entity.name]))
  const entityType = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : "other"

  return {
    approvedSources: context.approvedSources,
    entities: context.entities.map((entity) => ({
      ...entity,
      entity_type: entityType(entity.entity_type),
      knowledge_status: entity.knowledge_status ?? "confirmed",
      aliases: entity.aliases ?? [],
      attributes: entity.attributes ?? {},
    })),
    facts: context.facts.map((fact) => ({
      ...fact,
      fact_type: fact.fact_type ?? inferFactType(fact.statement),
      subject_entity:
        fact.subject_entity ?? (fact.entity_id ? entityNames.get(fact.entity_id) ?? null : null),
      related_entities:
        fact.related_entities ??
        context.entities
          .filter((entity) => entity.id !== fact.entity_id)
          .filter((entity) => {
            const text = normalizePart(fact.statement)
            return [entity.name, ...(entity.aliases ?? [])].some((name) =>
              text.includes(normalizePart(name)),
            )
          })
          .map((entity) => entity.name),
      scope: fact.scope ?? "timeless",
      certainty: fact.certainty ?? "explicit_fact",
      source_kind: fact.source_kind ?? "author",
    })),
    relations: context.relations.map((relation) => ({
      ...relation,
      relation_status: relation.relation_status ?? "active",
      certainty: relation.certainty ?? "explicit_fact",
      source_kind: relation.source_kind ?? "author",
    })),
    events: (context.events ?? []).map((event) => ({
      ...event,
      entity_ids: event.entity_ids ?? [],
      participants: event.participants ?? [],
      outcomes: event.outcomes ?? [],
      certainty: event.certainty ?? "explicit_fact",
      source_kind: event.source_kind ?? "author",
    })),
    openThreads: (context.openThreads ?? []).map((thread) => ({
      ...thread,
      question: thread.question ?? thread.title,
      thread_type: thread.thread_type ?? "other",
      thread_status: thread.thread_status ?? thread.status ?? "open",
      status: thread.status ?? thread.thread_status ?? "open",
      entity_ids: thread.entity_ids ?? [],
      certainty: thread.certainty ?? "explicit_fact",
      source_kind: thread.source_kind ?? "author",
    })),
  }
}

function canonicalRecordIds(context: CanonicalMemoryContext) {
  const ids = new Set<string>()
  const add = (recordType: ReconciliationRecordType, records: Array<{ id: string }>) => {
    for (const record of records) ids.add(sourceKey(recordType, record.id))
  }
  add("entity", context.entities)
  add("fact", context.facts as Array<CanonicalMemoryFact & { id: string }>)
  add("relation", context.relations as Array<CanonicalMemoryRelation & { id: string }>)
  add("event", context.events ?? [])
  add("open_thread", context.openThreads ?? [])
  return ids
}

function normalizeBasis(value: unknown, allowedIds?: Set<string>) {
  if (!Array.isArray(value)) return [] as ReconciliationBasisReference[]

  const basis: ReconciliationBasisReference[] = []
  for (const item of value) {
    const record = asRecord(item)
    const recordType = asRecordType(record.record_type ?? record.recordType)
    const recordId = trimText(record.record_id ?? record.recordId, 120)
    const rawRole = String(record.role ?? "supporting")
    const role: NonNullable<ReconciliationBasisReference["role"]> =
      rawRole === "primary" || rawRole === "conflict" ? rawRole : "supporting"
    if (!recordType || !recordId) continue
    if (allowedIds && !allowedIds.has(sourceKey(recordType, recordId))) continue
    basis.push({
      record_type: recordType,
      record_id: recordId,
      role,
    })
  }

  return basis
}

function hasAllowedCanonicalId(value: unknown, allowedIds?: Set<string>) {
  if (!allowedIds || typeof value !== "string" || !value.trim()) return true
  const candidate = value.trim()
  return [...allowedIds].some((key) => key.endsWith(`:${candidate}`))
}

function normalizeTarget(value: unknown, allowedIds?: Set<string>) {
  const target = asRecord(value)
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(target)) {
    if (item == null) continue
    if (["record_id", "id", "survivor_id", "from_entity_id", "to_entity_id"].includes(key)) {
      if (!hasAllowedCanonicalId(item, allowedIds)) continue
    }
    if (key === "source_record_ids" && Array.isArray(item)) {
      result[key] = item.filter((candidate) => hasAllowedCanonicalId(candidate, allowedIds))
      continue
    }
    if (typeof item === "string" && !item.trim()) continue
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      isRecord(item) ||
      Array.isArray(item)
    ) {
      result[key] = item
    }
  }
  return result
}

function normalizePayload(value: unknown, allowedIds?: Set<string>) {
  const payload = { ...asRecord(value) }
  for (const key of ["record_id", "id", "survivor_id", "entity_id", "from_entity_id", "to_entity_id"]) {
    if (key in payload && !hasAllowedCanonicalId(payload[key], allowedIds)) delete payload[key]
  }
  for (const key of ["source_record_ids", "entity_ids"]) {
    if (Array.isArray(payload[key])) {
      payload[key] = payload[key].filter((candidate) => hasAllowedCanonicalId(candidate, allowedIds))
    }
  }
  return payload
}

export function reconciliationDedupeKey(proposal: {
  proposal_kind: ReconciliationRecordType
  operation: ReconciliationOperation
  target?: ReconciliationTarget
  payload?: Record<string, unknown>
  dedupe_key?: string
}) {
  const explicitKey = trimText(proposal.dedupe_key, 500)
  if (explicitKey) return explicitKey

  const target = asRecord(proposal.target)
  const payload = asRecord(proposal.payload)
  const targetId = String(target.record_id ?? target.id ?? "")
  const fromId = String(target.from_entity_id ?? payload.from_entity_id ?? "")
  const toId = String(target.to_entity_id ?? payload.to_entity_id ?? "")
  const relationType = normalizePart(payload.relation_type ?? target.relation_type)
  const name = normalizePart(payload.name ?? target.name)
  const statement = normalizePart(payload.statement ?? payload.description)
  const title = normalizePart(payload.title ?? target.title)
  const titleKey = proposal.proposal_kind === "relation" ? "" : title
  const semanticKey = [
    proposal.proposal_kind,
    proposal.operation,
    targetId,
    fromId,
    relationType,
    toId,
    name,
    statement,
    titleKey,
  ]
    .filter(Boolean)
    .join("|")

  return semanticKey || `${proposal.proposal_kind}|${proposal.operation}|untitled`
}

export function normalizeCanonReconciliationProposal(
  raw: unknown,
  context?: CanonicalMemoryContext,
): CanonReconciliationProposal | null {
  const value = asRecord(raw) as RawCanonReconciliationProposal
  const proposalKind = asRecordType(value.proposal_kind ?? value.proposalKind)
  const operation = asOperation(value.operation)
  if (!proposalKind || !operation) return null

  const allowedIds = context ? canonicalRecordIds(context) : undefined
  const basis = normalizeBasis(value.basis, allowedIds)
  const target = normalizeTarget(value.target, allowedIds)
  const payload = normalizePayload(value.payload, allowedIds)
  const title = trimText(value.title, 240)
  const evidence = trimText(value.evidence, 10000)
  const explanation = trimText(value.explanation, 4000)
  const sourceAnchor = trimText(value.source_anchor ?? value.sourceAnchor, 2000)
  const dedupeKey = reconciliationDedupeKey({
    proposal_kind: proposalKind,
    operation,
    target,
    payload,
    dedupe_key: typeof value.dedupe_key === "string" ? value.dedupe_key : "",
  })

  if (!title && !Object.keys(payload).length) return null
  if (!evidence && !basis.length) return null

  return {
    schema_version: CANON_RECONCILIATION_SCHEMA_VERSION,
    origin_kind: "canon_reconciliation",
    proposal_kind: proposalKind,
    operation,
    title: title || `${operation} ${proposalKind}`,
    target,
    payload,
    basis,
    evidence_kind: asEvidenceKind(value.evidence_kind ?? value.evidenceKind),
    evidence,
    explanation,
    certainty: asCertainty(value.certainty),
    confidence: asConfidence(value.confidence),
    source_anchor: sourceAnchor,
    dedupe_key: dedupeKey,
    status: "pending",
  }
}

export function normalizeCanonReconciliationProposals(
  raw: unknown,
  context?: CanonicalMemoryContext,
  maxProposals = CANON_RECONCILIATION_MAX_PROPOSALS,
) {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const proposals: CanonReconciliationProposal[] = []

  for (const item of raw) {
    const proposal = normalizeCanonReconciliationProposal(item, context)
    if (!proposal || seen.has(proposal.dedupe_key)) continue
    seen.add(proposal.dedupe_key)
    proposals.push(proposal)
    if (proposals.length >= maxProposals) break
  }

  return proposals
}

function relationValueNames(value: unknown) {
  const values = Array.isArray(value) ? value : [value]
  return values
    .flatMap((item) => (isRecord(item) ? [item.name, item.entity_name, item.entityName] : [item]))
    .map((item) => trimText(item, 240))
    .filter(Boolean)
}

function entityNameIndex(entities: CanonicalMemoryEntity[]) {
  const index = new Map<string, CanonicalMemoryEntity[]>()
  for (const entity of entities) {
    const names = [entity.name, ...(entity.aliases ?? [])]
    for (const name of names) {
      const key = normalizePart(name)
      if (!key) continue
      const current = index.get(key) ?? []
      current.push(entity)
      index.set(key, current)
    }
  }
  return index
}

function resolveUniqueEntity(value: unknown, index: Map<string, CanonicalMemoryEntity[]>) {
  const matches = new Map<string, CanonicalMemoryEntity>()
  for (const name of relationValueNames(value)) {
    for (const entity of index.get(normalizePart(name)) ?? []) matches.set(entity.id, entity)
  }
  return matches.size === 1 ? [...matches.values()][0] : null
}

function orderedRelationEndpoints(fromEntityId: string, toEntityId: string, relationType: string) {
  if (!SYMMETRIC_RELATIONS.has(relationType)) return { fromEntityId, toEntityId }
  return fromEntityId.localeCompare(toEntityId) <= 0
    ? { fromEntityId, toEntityId }
    : { fromEntityId: toEntityId, toEntityId: fromEntityId }
}

function makeRuleProposal(input: {
  proposalKind: ReconciliationRecordType
  operation: ReconciliationOperation
  title: string
  target?: ReconciliationTarget
  payload: Record<string, unknown>
  basis: ReconciliationBasisReference[]
  explanation: string
  evidence?: string
  certainty?: ReconciliationCertainty
  confidence?: number
  sourceAnchor: string
}) {
  const target = input.target ?? {}
  const proposal: CanonReconciliationProposal = {
    schema_version: CANON_RECONCILIATION_SCHEMA_VERSION,
    origin_kind: "canon_reconciliation",
    proposal_kind: input.proposalKind,
    operation: input.operation,
    title: trimText(input.title, 240),
    target,
    payload: input.payload,
    basis: input.basis,
    evidence_kind: "canon_record",
    evidence: trimText(input.evidence ?? input.explanation, 260),
    explanation: trimText(input.explanation, 180),
    certainty: input.certainty ?? "direct_derivation",
    confidence: input.confidence ?? 0.95,
    source_anchor: trimText(input.sourceAnchor, 2000),
    dedupe_key: "",
    status: "pending",
  }
  proposal.dedupe_key = reconciliationDedupeKey(proposal)
  return proposal
}

function attributeRelationCandidates(
  entities: CanonicalMemoryEntity[],
  proposals: CanonReconciliationProposal[],
) {
  const index = entityNameIndex(entities)
  for (const entity of entities) {
    for (const [attributeKey, attributeValue] of Object.entries(entity.attributes ?? {})) {
      const relationType =
        VALID_ENTITY_RELATION_ATTRIBUTES[normalizePart(attributeKey).replace(/ /g, "_")]
      if (!relationType) continue
      for (const value of relationValueNames(attributeValue)) {
        const targetEntity = resolveUniqueEntity(value, index)
        if (!targetEntity || targetEntity.id === entity.id) continue
        const endpoints = orderedRelationEndpoints(entity.id, targetEntity.id, relationType)
        proposals.push(
          makeRuleProposal({
            proposalKind: "relation",
            operation: "create",
            title: `${entity.name} — ${relationType} — ${targetEntity.name}`,
            target: {
              from_entity_id: endpoints.fromEntityId,
              to_entity_id: endpoints.toEntityId,
            },
            payload: {
              relation_type: relationType,
              relation_status: "active",
              description: `Relação derivada do atributo canônico ${attributeKey} de ${entity.name}.`,
              source_kind: "author",
            },
            basis: [{ record_type: "entity", record_id: entity.id, role: "primary" }],
            explanation: `O atributo canônico ${attributeKey} referencia exclusivamente a entidade ${targetEntity.name}.`,
            sourceAnchor: `entity:${entity.id}:attribute:${attributeKey}`,
          }),
        )
      }
    }
  }
}

function duplicateFactCandidates(
  facts: Array<CanonicalMemoryFact & { id: string }>,
  proposals: CanonReconciliationProposal[],
) {
  const groups = new Map<string, Array<CanonicalMemoryFact & { id: string }>>()
  for (const fact of facts) {
    if (fact.status && fact.status !== "active") continue
    const key = `${fact.entity_id ?? "none"}|${normalizePart(fact.statement)}`
    if (!normalizePart(fact.statement)) continue
    const current = groups.get(key) ?? []
    current.push(fact)
    groups.set(key, current)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const survivor = group[0]
    const sourceIds = group.map((fact) => fact.id)
    proposals.push(
      makeRuleProposal({
        proposalKind: "fact",
        operation: "merge",
        title: `Consolidar fatos repetidos: ${survivor.statement.slice(0, 180)}`,
        target: { record_type: "fact", record_id: survivor.id },
        payload: {
          record_type: "fact",
          survivor_id: survivor.id,
          source_record_ids: sourceIds,
          preserve_sources: true,
        },
        basis: group.map((fact, index) => ({
          record_type: "fact",
          record_id: fact.id,
          role: index === 0 ? "primary" : "supporting",
        })),
        explanation:
          "Foram encontrados fatos canônicos ativos com a mesma entidade e a mesma afirmação normalizada. A proposta preserva as fontes e não apaga os fatos automaticamente.",
        certainty: "explicit_fact",
        confidence: 1,
        sourceAnchor: `facts:${sourceIds.join(",")}`,
      }),
    )
  }
}

function duplicateEventCandidates(
  events: Array<CanonicalMemoryEvent & { id: string }>,
  proposals: CanonReconciliationProposal[],
) {
  const groups = new Map<string, Array<CanonicalMemoryEvent & { id: string }>>()
  for (const event of events) {
    if (event.status && event.status !== "active") continue
    const key = `${normalizePart(event.title)}|${normalizePart(event.narrative_time)}`
    if (!normalizePart(event.title)) continue
    const current = groups.get(key) ?? []
    current.push(event)
    groups.set(key, current)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const survivor = group[0]
    const sourceIds = group.map((event) => event.id)
    proposals.push(
      makeRuleProposal({
        proposalKind: "event",
        operation: "merge",
        title: `Consolidar eventos repetidos: ${survivor.title}`,
        target: { record_type: "event", record_id: survivor.id },
        payload: {
          record_type: "event",
          survivor_id: survivor.id,
          source_record_ids: sourceIds,
          preserve_sources: true,
        },
        basis: group.map((event, index) => ({
          record_type: "event",
          record_id: event.id,
          role: index === 0 ? "primary" : "supporting",
        })),
        explanation:
          "Foram encontrados eventos ativos com o mesmo título e tempo narrativo normalizados. A proposta é apenas uma sugestão de consolidação e preserva as fontes.",
        certainty: "explicit_fact",
        confidence: 0.98,
        sourceAnchor: `events:${sourceIds.join(",")}`,
      }),
    )
  }
}

function duplicateEntityCandidates(
  entities: CanonicalMemoryEntity[],
  proposals: CanonReconciliationProposal[],
) {
  const groups = new Map<string, CanonicalMemoryEntity[]>()
  for (const entity of entities) {
    const key = normalizePart(entity.name)
    if (!key) continue
    const current = groups.get(key) ?? []
    current.push(entity)
    groups.set(key, current)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const survivor = group[0]
    const sourceIds = group.map((entity) => entity.id)
    proposals.push(
      makeRuleProposal({
        proposalKind: "entity",
        operation: "merge",
        title: `Consolidar entidades repetidas: ${survivor.name}`,
        target: { record_type: "entity", record_id: survivor.id },
        payload: {
          record_type: "entity",
          survivor_id: survivor.id,
          source_record_ids: sourceIds,
          preserve_sources: true,
          merge_attributes: true,
        },
        basis: group.map((entity, index) => ({
          record_type: "entity",
          record_id: entity.id,
          role: index === 0 ? "primary" : "supporting",
        })),
        explanation:
          "Foram encontradas entidades ativas com o mesmo nome normalizado. A proposta exige revisão humana porque nomes iguais ainda podem representar pessoas ou lugares diferentes.",
        certainty: "possible_inference",
        confidence: 0.88,
        sourceAnchor: `entities:${sourceIds.join(",")}`,
      }),
    )
  }
}

function duplicateRelationCandidates(
  relations: Array<CanonicalMemoryRelation & { id: string }>,
  proposals: CanonReconciliationProposal[],
) {
  const groups = new Map<string, Array<CanonicalMemoryRelation & { id: string }>>()
  for (const relation of relations) {
    const relationType = normalizePart(relation.relation_type)
    if (!relationType || !relation.from_entity_id || !relation.to_entity_id) continue
    const endpoints = orderedRelationEndpoints(
      relation.from_entity_id,
      relation.to_entity_id,
      relationType,
    )
    const key = `${endpoints.fromEntityId}|${relationType}|${endpoints.toEntityId}`
    const current = groups.get(key) ?? []
    current.push(relation)
    groups.set(key, current)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const survivor = group[0]
    const sourceIds = group.map((relation) => relation.id)
    proposals.push(
      makeRuleProposal({
        proposalKind: "relation",
        operation: "merge",
        title: `Consolidar relações repetidas: ${survivor.relation_type}`,
        target: { record_type: "relation", record_id: survivor.id },
        payload: {
          record_type: "relation",
          survivor_id: survivor.id,
          source_record_ids: sourceIds,
          preserve_sources: true,
          merge_descriptions: true,
        },
        basis: group.map((relation, index) => ({
          record_type: "relation",
          record_id: relation.id,
          role: index === 0 ? "primary" : "supporting",
        })),
        explanation:
          "Foram encontradas relações ativas com os mesmos extremos e tipo normalizados. A proposta preserva as fontes e combina descrições complementares durante a aplicação.",
        certainty: "explicit_fact",
        confidence: 0.97,
        sourceAnchor: `relations:${sourceIds.join(",")}`,
      }),
    )
  }
}

function duplicateOpenThreadCandidates(
  threads: Array<CanonicalMemoryOpenThread & { id: string }>,
  proposals: CanonReconciliationProposal[],
) {
  const groups = new Map<string, Array<CanonicalMemoryOpenThread & { id: string }>>()
  for (const thread of threads) {
    if (thread.status && !["open", "active", "pending"].includes(thread.status)) continue
    const key = normalizePart(thread.title)
    if (!key) continue
    const current = groups.get(key) ?? []
    current.push(thread)
    groups.set(key, current)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const survivor = group[0]
    const sourceIds = group.map((thread) => thread.id)
    proposals.push(
      makeRuleProposal({
        proposalKind: "open_thread",
        operation: "merge",
        title: `Consolidar tramas repetidas: ${survivor.title}`,
        target: { record_type: "open_thread", record_id: survivor.id },
        payload: {
          record_type: "open_thread",
          survivor_id: survivor.id,
          source_record_ids: sourceIds,
          preserve_sources: true,
          merge_descriptions: true,
          preserve_highest_priority: true,
        },
        basis: group.map((thread, index) => ({
          record_type: "open_thread",
          record_id: thread.id,
          role: index === 0 ? "primary" : "supporting",
        })),
        explanation:
          "Foram encontradas tramas abertas com o mesmo título normalizado. A proposta preserva as fontes e mantém a maior prioridade durante a aplicação.",
        certainty: "possible_inference",
        confidence: 0.9,
        sourceAnchor: `open_threads:${sourceIds.join(",")}`,
      }),
    )
  }
}

const FACT_RELATION_KEYWORDS: Array<{ keywords: string[]; relationType: string }> = [
  { keywords: ["irmao", "irma", "irmãos", "irmãs"], relationType: "sibling_of" },
  { keywords: ["pai de", "mae de", "mãe de"], relationType: "parent_of" },
  { keywords: ["filho de", "filha de"], relationType: "child_of" },
  { keywords: ["amigo", "amiga", "amizade"], relationType: "friend_of" },
  { keywords: ["inimigo", "inimiga", "inimizade"], relationType: "enemy_of" },
  { keywords: ["membro", "pertence", "integra", "faz parte"], relationType: "member_of" },
  { keywords: ["criado por", "criada por", "forjado por", "forjada por"], relationType: "created_by" },
  { keywords: ["localizado em", "fica em", "está em", "esta em"], relationType: "located_in" },
]

function entityForFact(fact: CanonicalMemoryFact, entities: CanonicalMemoryEntity[]) {
  if (fact.entity_id) return entities.find((entity) => entity.id === fact.entity_id) ?? null
  if (fact.subject_entity) return resolveUniqueEntity(fact.subject_entity, entityNameIndex(entities))
  return null
}

function entityNamesInText(statement: string, entities: CanonicalMemoryEntity[], excludedId?: string) {
  const normalizedStatement = normalizePart(statement)
  return entities
    .filter((entity) => entity.id !== excludedId)
    .filter((entity) =>
      [entity.name, ...(entity.aliases ?? [])].some((name) => {
        const normalizedName = normalizePart(name)
        return normalizedName.length >= 3 && normalizedStatement.includes(normalizedName)
      }),
    )
}

function explicitRelatedEntities(
  fact: CanonicalMemoryFact,
  entities: CanonicalMemoryEntity[],
  subjectId?: string,
) {
  const index = entityNameIndex(entities)
  const explicit = (fact.related_entities ?? [])
    .map((value) => resolveUniqueEntity(value, index))
    .filter((entity): entity is CanonicalMemoryEntity => Boolean(entity && entity.id !== subjectId))
  return explicit.length ? explicit : entityNamesInText(fact.statement, entities, subjectId)
}

const GENERIC_MENTION_WORDS = new Set([
  "A",
  "O",
  "As",
  "Os",
  "Um",
  "Uma",
  "Ele",
  "Ela",
  "Eles",
  "Elas",
  "Isso",
  "Esse",
  "Essa",
  "Festival",
  "Cidade",
  "Torre",
  "Casa",
  "Reino",
  "Mundo",
  "Espada",
  "Poder",
  "Poderes",
  "História",
  "Historia",
  "Irmão",
  "Irmao",
  "Irmãos",
  "Irmaos",
  "Quem",
  "Responsável",
  "Responsavel",
  "Identidade",
  "Morte",
])

const CHARACTER_MENTION_HINTS = /\b(?:é|era|foi|visto|vista|homem|mulher|jovem|doutor|doutora|senhor|senhora|personagem|curou|matou|atacou|lutou|encontrou|conheceu|falou|disse|chegou|partiu|aparece|apareceu|surge|surgiu|vive|mora|viaja|confronta|mencionado|mencionada|menção|menção|irmão|irmao|amigo|amiga)\b/i

function cleanMentionedCharacterName(value: string) {
  return value
    .replace(/^(?:o|a|os|as|um|uma|doutor|doutora|dr\.?|senhor|senhora)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

function mentionedCharacterNames(
  text: string,
  context: CanonicalMemoryContext,
  excludedNames: string[] = [],
) {
  const compactText = text.trim().replace(/[.!?]+$/g, "").trim()
  const standaloneName = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç'-]*(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç'-]*)?$/.test(compactText)
  if (!CHARACTER_MENTION_HINTS.test(text) && !standaloneName) return []
  const knownNames = new Set(
    context.entities.flatMap((entity) => [entity.name, ...(entity.aliases ?? [])]).map(normalizePart),
  )
  const excluded = new Set(excludedNames.map(normalizePart))
  const candidates = text.match(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç'-]*(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç'-]*)?\b/g) ?? []
  return candidates
    .map(cleanMentionedCharacterName)
    .filter((candidate) => candidate.length >= 2 && candidate.length <= 80)
    .filter((candidate) => !GENERIC_MENTION_WORDS.has(candidate))
    .filter((candidate) => !knownNames.has(normalizePart(candidate)))
    .filter((candidate) => !excluded.has(normalizePart(candidate)))
    .filter((candidate) => !/\b(?:de|do|da|dos|das)\b/i.test(candidate))
    .filter(
      (candidate, index, items) =>
        items.findIndex((item) => normalizePart(item) === normalizePart(candidate)) === index,
    )
}

function pushMentionedCharacterEntities(
  context: CanonicalMemoryContext,
  proposals: CanonReconciliationProposal[],
) {
  const records: Array<{
    recordType: "fact" | "event" | "open_thread"
    recordId: string
    text: string
    excludedNames?: string[]
  }> = []

  for (const fact of context.facts as Array<CanonicalMemoryFact & { id?: string }>) {
    if (!fact.id) continue
    const excludedName = extractObjectName(fact.statement, "owns")
    records.push({
      recordType: "fact",
      recordId: fact.id,
      text: fact.statement,
      excludedNames: excludedName ? [excludedName] : [],
    })
  }
  for (const event of context.events ?? []) {
    records.push({
      recordType: "event",
      recordId: event.id,
      text: `${event.title}. ${event.description}`,
    })
  }
  for (const thread of context.openThreads ?? []) {
    records.push({
      recordType: "open_thread",
      recordId: thread.id,
      text: `${thread.title}. ${thread.question ?? ""}. ${thread.description}`,
    })
  }

  for (const record of records) {
    for (const name of mentionedCharacterNames(record.text, context, record.excludedNames)) {
      pushProvisionalEntity(
        name,
        "character",
        [{ record_type: record.recordType, record_id: record.recordId, role: "primary" }],
        proposals,
        `A menção a “${name}” parece identificar uma personagem ainda não cadastrada no Universo.`,
        record.text,
      )
    }
  }
}

function extractObjectName(statement: string, relationType: string) {
  const normalized = statement.trim()
  const patterns =
    relationType === "has_power"
      ? [
          /poder(?:es)?\s+(?:de|do|da)\s+(.+?)(?:[.!?,;]|$)/i,
          /(?:possui|tem|domina)\s+(.+?)\s* poder(?:es)?(?:[.!?,;]|$)/i,
        ]
      : [
          /(?:recebeu|ganhou|possui|possui a|possui o|tem|usa|usou|empunhou|perdeu)\s+(?:a|o|uma|um)?\s*(.+?)(?:\s+(?:de|do|da|para|por)\s+|[.!?,;]|$)/i,
        ]
  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    const candidate = match?.[1]
      ?.replace(/^(?:a|o|uma|um)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim()
    if (candidate && candidate.length >= 2 && candidate.length <= 120) return candidate
  }
  return null
}

function hasTemporaryPossessionLanguage(statement: string) {
  const normalized = normalizePart(statement)
  return ["por alguns segundos", "para olhar", "por um instante", "temporariamente", "pegou emprestado"].some(
    (marker) => normalized.includes(normalizePart(marker)),
  )
}

function relationAlreadyExists(
  relations: Array<CanonicalMemoryRelation & { id: string }>,
  fromEntityId: string,
  toEntityId: string,
  relationType: string,
) {
  return relations.some(
    (relation) =>
      relation.from_entity_id === fromEntityId &&
      relation.to_entity_id === toEntityId &&
      normalizePart(relation.relation_type) === normalizePart(relationType) &&
      (!relation.visibility || relation.visibility === "canon"),
  )
}

function pushProvisionalEntity(
  name: string,
  entityType: "item" | "power" | "character" | "other",
  basis: ReconciliationBasisReference[],
  proposals: CanonReconciliationProposal[],
  explanation: string,
  evidence?: string,
) {
  const normalizedName = normalizePart(name)
  if (!normalizedName) return
  const exists = proposals.some(
    (proposal) =>
      proposal.proposal_kind === "entity" &&
      normalizePart(String(proposal.payload.name ?? proposal.title)) === normalizedName,
  )
  if (exists) return
  proposals.push(
    makeRuleProposal({
      proposalKind: "entity",
      operation: "create",
      title: name,
      target: {},
      payload: {
        entity_type: entityType,
        name,
        summary: `${name} mencionado diretamente em um registro canônico relacionado.`,
        aliases: [],
        knowledge_status: "provisional",
        attributes: {},
        certainty: "direct_derivation",
        source_kind: "canon_reconciliation",
      },
      basis,
      explanation,
      evidence,
      certainty: "direct_derivation",
      confidence: 0.9,
      sourceAnchor: `provisional-entity:${normalizedName}`,
    }),
  )
}

function pushFactRelationProposal(
  fact: CanonicalMemoryFact & { id: string },
  context: CanonicalMemoryContext,
  proposals: CanonReconciliationProposal[],
) {
  const subject = entityForFact(fact, context.entities)
  if (!subject) return
  const subjectId = subject.id
  const related = explicitRelatedEntities(fact, context.entities, subjectId)
  const statement = normalizePart(fact.statement)
  const factType = fact.fact_type ?? "other"
  if (
    factType === "appearance" ||
    /\b(?:olhos|cabelos|cicatriz|aparencia|aparência)\b/.test(statement)
  ) {
    return
  }
  let relationType: string | null = null
  let relationStatus: "active" | "former" | "unknown" = "active"

  if (["ability"].includes(factType) || /\b(?:poder|poderes|habilidade|domina)\b/.test(statement)) {
    relationType = "has_power"
  } else if (
    factType === "possession" ||
    /\b(?:recebeu|ganhou|possui|possui a|possui o|tem|usa|usou|empunhou|perdeu)\b/.test(statement)
  ) {
    relationType = "owns"
    relationStatus = /\b(?:perdeu|entregou|devolveu|abandonou)\b/.test(statement) ? "former" : "active"
    if (hasTemporaryPossessionLanguage(fact.statement)) return
  } else {
    const match = FACT_RELATION_KEYWORDS.find(({ keywords }) =>
      keywords.some((keyword) => statement.includes(normalizePart(keyword))),
    )
    relationType = match?.relationType ?? null
    if (/\b(?:perdeu|deixou de|rompeu)\b/.test(statement)) relationStatus = "former"
  }

  if (!relationType) return
  const relatedEntity = related[0] ?? null
  const relatedName = relatedEntity?.name ?? extractObjectName(fact.statement, relationType)
  if (!relatedName) return

  if (relationType === "has_power" && !relatedEntity) {
    pushProvisionalEntity(
      relatedName,
      "power",
      [{ record_type: "fact", record_id: fact.id, role: "primary" }],
      proposals,
      `O fato de capacidade menciona o poder “${relatedName}”, mas ainda não há uma entidade correspondente no Universo.`,
      fact.statement,
    )
  } else if (relationType === "owns" && !relatedEntity) {
    pushProvisionalEntity(
      relatedName,
      "item",
      [{ record_type: "fact", record_id: fact.id, role: "primary" }],
      proposals,
      `O fato de posse menciona o item “${relatedName}”, mas ainda não há uma entidade correspondente no Universo.`,
      fact.statement,
    )
  }

  const basis: ReconciliationBasisReference[] = [
    { record_type: "fact", record_id: fact.id, role: "primary" },
  ]
  const payload: Record<string, unknown> = {
    relation_type: relationType,
    relation_status: relationStatus,
    description: fact.statement,
    certainty: "direct_derivation",
    source_kind: "canon_reconciliation",
  }
  const target: ReconciliationTarget = {}
  if (relatedEntity) {
    const endpoints = orderedRelationEndpoints(subjectId, relatedEntity.id, relationType)
    target.from_entity_id = endpoints.fromEntityId
    target.to_entity_id = endpoints.toEntityId
  } else {
    payload.from_entity_id = subjectId
    payload.to_entity = relatedName
    target.from_entity_id = subjectId
    target.to_entity = relatedName
  }

  if (relatedEntity && relationStatus === "active" && relationAlreadyExists(
    context.relations as Array<CanonicalMemoryRelation & { id: string }>,
    subjectId,
    relatedEntity.id,
    relationType,
  )) return

  const existingRelation = relatedEntity
    ? (context.relations as Array<CanonicalMemoryRelation & { id: string }>).find(
        (relation) =>
          relation.from_entity_id === subjectId &&
          relation.to_entity_id === relatedEntity.id &&
          normalizePart(relation.relation_type) === normalizePart(relationType),
      )
    : null
  proposals.push(
    makeRuleProposal({
      proposalKind: "relation",
      operation: existingRelation ? "update" : "create",
      title: `${subject.name} — ${relationType} — ${relatedName}`,
      target: existingRelation
        ? { record_type: "relation", record_id: existingRelation.id }
        : target,
      payload,
      basis,
      explanation:
        relationStatus === "former"
          ? `O fato indica uma perda ou encerramento; a relação deve preservar o histórico e deixar de ser ativa.`
          : `O fato canônico sustenta diretamente a relação ${subject.name} → ${relationType} → ${relatedName}.`,
      evidence: fact.statement,
      certainty: "direct_derivation",
      confidence: 0.94,
      sourceAnchor: `fact:${fact.id}:relation:${relationType}:${normalizePart(relatedName)}`,
    }),
  )
}

function threadCanBeResolved(
  thread: CanonicalMemoryOpenThread & { id: string },
  fact: CanonicalMemoryFact & { id: string },
  entities: CanonicalMemoryEntity[],
) {
  if (thread.status && !["open", "in_progress", "pending"].includes(thread.status)) return false
  const question = normalizePart(thread.question ?? `${thread.title} ${thread.description}`)
  const statement = normalizePart(fact.statement)
  const relationTerms = ["irmao", "irma", "pai", "mae", "filho", "responsavel", "criou", "matou", "origem", "quem"]
  const sharedRelationTerm = relationTerms.some(
    (term) => question.includes(term) && statement.includes(term),
  )
  if (!sharedRelationTerm) return false
  const involvedNames = (thread.entity_ids ?? [])
    .map((id) => entities.find((entity) => entity.id === id)?.name)
    .filter((name): name is string => Boolean(name))
  const allInvolvedMentioned = involvedNames.every((name) => statement.includes(normalizePart(name)))
  return allInvolvedMentioned || involvedNames.length === 0
}

function openThreadResolutionCandidates(
  context: CanonicalMemoryContext,
  proposals: CanonReconciliationProposal[],
) {
  for (const thread of (context.openThreads ?? []) as Array<CanonicalMemoryOpenThread & { id: string }>) {
    for (const fact of context.facts as Array<CanonicalMemoryFact & { id: string }>) {
      if (!threadCanBeResolved(thread, fact, context.entities)) continue
      proposals.push(
        makeRuleProposal({
          proposalKind: "open_thread",
          operation: "resolve",
          title: `Resolver trama: ${thread.title}`,
          target: { record_type: "open_thread", record_id: thread.id },
          payload: {
            title: thread.title,
            question: thread.question ?? thread.title,
            description: `A questão foi respondida diretamente pelo fato: ${fact.statement}`,
            status: "resolved",
            thread_status: "resolved",
            resolution: {
              summary: fact.statement,
              resolved_by: [{ record_type: "fact", record_id: fact.id }],
            },
            source_kind: "canon_reconciliation",
          },
          basis: [
            { record_type: "open_thread", record_id: thread.id, role: "primary" },
            { record_type: "fact", record_id: fact.id, role: "supporting" },
          ],
          explanation: "A afirmação canônica responde diretamente à pergunta da trama; não é apenas uma semelhança temática.",
          evidence: fact.statement,
          certainty: "direct_derivation",
          confidence: 0.92,
          sourceAnchor: `thread:${thread.id}:fact:${fact.id}`,
        }),
      )
    }
  }
}

function conflictCandidates(
  context: CanonicalMemoryContext,
  proposals: CanonReconciliationProposal[],
) {
  const facts = context.facts as Array<CanonicalMemoryFact & { id: string }>
  for (let index = 0; index < facts.length; index += 1) {
    const left = facts[index]
    const leftSubject = left.entity_id ?? left.subject_entity
    if (!leftSubject) continue
    for (let rightIndex = index + 1; rightIndex < facts.length; rightIndex += 1) {
      const right = facts[rightIndex]
      const rightSubject = right.entity_id ?? right.subject_entity
      if (leftSubject !== rightSubject) continue
      const leftText = normalizePart(left.statement)
      const rightText = normalizePart(right.statement)
      const sameTopic =
        (leftText.includes("olhos") && rightText.includes("olhos")) ||
        (leftText.includes("morreu") && rightText.includes("vivo")) ||
        (leftText.includes("vivo") && rightText.includes("morreu")) ||
        (leftText.includes("possui") && rightText.includes("perdeu"))
      if (!sameTopic) continue
      proposals.push(
        makeRuleProposal({
          proposalKind: "open_thread",
          operation: "create",
          title: `Possível conflito de cânone: ${left.statement.slice(0, 120)}`,
          target: {},
          payload: {
            thread_type: "continuity",
            title: `Possível conflito de cânone`,
            description: `${left.statement} / ${right.statement}`,
            status: "open",
            thread_status: "open",
            priority: "high",
            conflict_fact_ids: [left.id, right.id],
            source_kind: "canon_reconciliation",
          },
          basis: [
            { record_type: "fact", record_id: left.id, role: "conflict" },
            { record_type: "fact", record_id: right.id, role: "conflict" },
          ],
          explanation: "Os dois fatos parecem tratar do mesmo aspecto e não devem ser resolvidos automaticamente; os autores precisam revisar a temporalidade ou a contradição.",
          evidence: `${left.statement} / ${right.statement}`,
          certainty: "possible_inference",
          confidence: 0.78,
          sourceAnchor: `conflict:${left.id}:${right.id}`,
        }),
      )
    }
  }
}

export function runCanonReconciliationRules(
  context: CanonReconciliationRuleInput,
  options: CanonReconciliationRuleOptions = {},
) {
  const proposals: CanonReconciliationProposal[] = []
  const maxProposals = Math.max(
    1,
    options.maxProposals ?? CANON_RECONCILIATION_MAX_PROPOSALS,
  )

  attributeRelationCandidates(context.entities, proposals)
  pushMentionedCharacterEntities(context, proposals)
  for (const fact of context.facts as Array<CanonicalMemoryFact & { id: string }>) {
    if (fact.status && fact.status !== "active") continue
    pushFactRelationProposal(fact, context, proposals)
  }
  openThreadResolutionCandidates(context, proposals)
  conflictCandidates(context, proposals)
  duplicateEntityCandidates(context.entities, proposals)
  duplicateFactCandidates(context.facts as Array<CanonicalMemoryFact & { id: string }>, proposals)
  duplicateRelationCandidates(
    context.relations as Array<CanonicalMemoryRelation & { id: string }>,
    proposals,
  )
  duplicateEventCandidates(
    (context.events ?? []) as Array<CanonicalMemoryEvent & { id: string }>,
    proposals,
  )
  duplicateOpenThreadCandidates(
    (context.openThreads ?? []) as Array<CanonicalMemoryOpenThread & { id: string }>,
    proposals,
  )

  const unique = new Map<string, CanonReconciliationProposal>()
  for (const proposal of proposals) {
    if (!unique.has(proposal.dedupe_key)) unique.set(proposal.dedupe_key, proposal)
  }

  return [...unique.values()]
    .sort((left, right) => {
      const kindOrder = left.proposal_kind.localeCompare(right.proposal_kind)
      if (kindOrder !== 0) return kindOrder
      return left.title.localeCompare(right.title, "pt-BR")
    })
    .slice(0, maxProposals)
}

export async function buildReconciliationInputHash(
  sources: ReconciliationSource[],
  contractVersion = CANON_RECONCILIATION_SCHEMA_VERSION,
) {
  const canonicalInput = [
    contractVersion,
    ...sources
      .map(
        (source) =>
          `${source.record_type}:${source.record_id}:${source.source_role ?? "approved_input"}`,
      )
      .sort(),
  ].join("|")
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalInput))
  const hexadecimalDigest = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")

  // O banco limita input_hash a 160 caracteres. O prefixo mais o SHA-256
  // resultam em 81 caracteres e preservam a estabilidade sem concatenar UUIDs.
  return `reconciliation-v1-${hexadecimalDigest}`
}

export function buildReconciliationSourceSet(
  context: CanonicalMemoryContext,
  approvedSources: ReconciliationSource[] = [],
) {
  const sources = [...approvedSources]
  const seen = new Set(sources.map((source) => sourceKey(source.record_type, source.record_id)))
  const add = (recordType: ReconciliationRecordType, recordId: string) => {
    const key = sourceKey(recordType, recordId)
    if (seen.has(key)) return
    seen.add(key)
    sources.push({ record_type: recordType, record_id: recordId, source_role: "related_context" })
  }

  for (const entity of context.entities) add("entity", entity.id)
  for (const fact of context.facts as Array<CanonicalMemoryFact & { id: string }>)
    add("fact", fact.id)
  for (const relation of context.relations as Array<CanonicalMemoryRelation & { id: string }>) {
    add("relation", relation.id)
  }
  for (const event of context.events ?? []) add("event", event.id)
  for (const thread of context.openThreads ?? []) add("open_thread", thread.id)

  return sources
}

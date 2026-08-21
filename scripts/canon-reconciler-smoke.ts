import { runCanonReconciliationRules } from "../src/lib/canon-reconciler-browser"
import type { CanonicalMemoryContext } from "../src/lib/ollama-browser"

const context: CanonicalMemoryContext = {
  entities: [
    { id: "cod", name: "Cod", entity_type: "character", aliases: [], attributes: {} },
    { id: "ignitus", name: "Ignitus", entity_type: "character", aliases: [], attributes: {} },
    { id: "daiki", name: "Daiki", entity_type: "character", aliases: [], attributes: {} },
  ],
  facts: [
    {
      id: "fact-sibling",
      entity_id: "cod",
      statement: "Cod é irmão de Ignitus.",
      related_entities: ["Ignitus"],
      fact_type: "other",
      status: "active",
    },
    {
      id: "fact-item",
      entity_id: "daiki",
      statement: "Daiki recebeu a Espada Verde.",
      fact_type: "possession",
      status: "active",
    },
    {
      id: "fact-power",
      entity_id: "cod",
      statement: "Cod possui poderes de gelo.",
      fact_type: "ability",
      status: "active",
    },
    {
      id: "fact-eyes-a",
      entity_id: "daiki",
      statement: "Daiki possui olhos cor de mel.",
      fact_type: "appearance",
      status: "active",
    },
    {
      id: "fact-eyes-b",
      entity_id: "daiki",
      statement: "Daiki sempre teve olhos azuis.",
      fact_type: "appearance",
      status: "active",
    },
    {
      id: "fact-hate",
      entity_id: "cod",
      statement: "Cod odiava X.",
      status: "active",
    },
  ],
  relations: [],
  events: [],
  openThreads: [
    {
      id: "thread-sibling",
      title: "Irmão de Ignitus",
      question: "Quem é o irmão de Ignitus?",
      description: "A identidade do irmão ainda não foi revelada.",
      status: "open",
      entity_ids: ["ignitus"],
    },
    {
      id: "thread-killer",
      title: "Responsável pela morte de X",
      question: "Quem matou X?",
      description: "O responsável ainda não foi revelado.",
      status: "open",
      entity_ids: [],
    },
  ],
}

const proposals = runCanonReconciliationRules(context)
const titles = proposals.map((proposal) => `${proposal.proposal_kind}/${proposal.operation}:${proposal.title}`)

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

assert(
  proposals.some(
    (proposal) =>
      proposal.proposal_kind === "relation" &&
      proposal.operation === "create" &&
      proposal.payload.relation_type === "sibling_of",
  ),
  "Não gerou sibling_of para Cod e Ignitus.",
)
assert(
  proposals.some(
    (proposal) =>
      proposal.proposal_kind === "entity" &&
      proposal.operation === "create" &&
      proposal.payload.entity_type === "item" &&
      proposal.payload.name === "Espada Verde",
  ),
  "Não gerou entidade provisória para Espada Verde.",
)
assert(
  proposals.some(
    (proposal) =>
      proposal.proposal_kind === "relation" && proposal.payload.relation_type === "owns",
  ),
  "Não gerou relação de posse para Espada Verde.",
)
assert(
  proposals.some(
    (proposal) =>
      proposal.proposal_kind === "entity" &&
      proposal.payload.entity_type === "power" &&
      String(proposal.payload.name).toLocaleLowerCase().includes("gelo"),
  ),
  "Não gerou entidade provisória para o poder de gelo.",
)
assert(
  proposals.some(
    (proposal) =>
      proposal.proposal_kind === "relation" && proposal.payload.relation_type === "has_power",
  ),
  "Não gerou relação has_power.",
)
assert(
  proposals.some(
    (proposal) =>
      proposal.proposal_kind === "open_thread" &&
      proposal.operation === "resolve" &&
      proposal.target.record_id === "thread-sibling",
  ),
  "Não resolveu a thread respondida diretamente.",
)
assert(
  !proposals.some(
    (proposal) =>
      proposal.proposal_kind === "open_thread" &&
      proposal.operation === "resolve" &&
      proposal.target.record_id === "thread-killer",
  ),
  "Resolveu indevidamente a thread de quem matou X.",
)
assert(
  proposals.some(
    (proposal) => proposal.proposal_kind === "open_thread" && proposal.payload.conflict_fact_ids,
  ),
  "Não gerou alerta de possível conflito.",
)

console.log(`OK — ${proposals.length} propostas semânticas geradas.`)
for (const title of titles) console.log(title)

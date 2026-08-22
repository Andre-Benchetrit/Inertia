import { runCanonReconciliationRules } from "../src/lib/canon-reconciler-browser"
import {
  buildCanonReconciliationPrompt,
  type CanonicalMemoryContext,
} from "../src/lib/ollama-browser"

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
      id: "fact-jhin",
      entity_id: "cod",
      statement: "Cod encontrou Jhin na estrada.",
      mentioned_entities: [{ name: "Jhin", entity_type: "character" }],
      status: "active",
    },
    {
      id: "fact-elise",
      entity_id: "cod",
      statement: "A luta revelou o hábito de Elise.",
      mentioned_entities: [{ name: "Elise", entity_type: "character" }],
      status: "active",
    },
    {
      id: "fact-generic-words",
      entity_id: "cod",
      statement: "Luta e hábito são descritos como conceitos da cena.",
      status: "active",
    },
  ],
  relations: [
    {
      id: "relation-missing-endpoint",
      from_entity_id: "cod",
      to_entity_id: "jhin-unknown-id",
      relation_type: "associated_with",
      relation_status: "unknown",
    },
  ],
  events: [
    {
      id: "event-jhin",
      title: "Encontro na estrada",
      description: "Cod encontrou Jhin na estrada.",
      event_kind: "encounter",
      entity_ids: ["cod"],
      participants: [
        { entity_name: "Cod", entity_id: "cod", entity_type: "character", role: "protagonist" },
        { entity_name: "Jhin", entity_type: "character", role: "encountered" },
      ],
      status: "active",
    },
    {
      id: "event-elise",
      title: "Observação de Elise",
      description: "Elise observou a cena.",
      event_kind: "observation",
      entity_ids: ["cod"],
      participants: [{ entity_name: "Elise", entity_type: "character", role: "witness" }],
      status: "active",
    },
  ],
  openThreads: [
    {
      id: "thread-sibling",
      title: "Irmão de Ignitus",
      question: "Quem é o irmão de Ignitus?",
      description: "A identidade do irmão ainda não foi revelada.",
      status: "open",
      entity_ids: ["ignitus"],
    },
  ],
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

const prompt = buildCanonReconciliationPrompt(context)
const legacyRuleProposals = runCanonReconciliationRules(context)

assert(
  legacyRuleProposals.length === 0,
  "O motor local legado ainda está gerando proposals; a geração deve ser exclusiva do Ollama.",
)
assert(prompt.includes('"semantic_references"'), "O prompt não expõe semantic_references.")
assert(prompt.includes('"fact_mentions"'), "O prompt não expõe fact_mentions.")
assert(prompt.includes('"event_participants"'), "O prompt não expõe event_participants.")
assert(prompt.includes('"relation_endpoint_gaps"'), "O prompt não expõe relation_endpoint_gaps.")
assert(prompt.includes('"unresolved_mentions"'), "O prompt não calcula menções não cadastradas.")
assert(
  prompt.includes('"unresolved_participants"'),
  "O prompt não calcula participantes não cadastrados.",
)
assert(prompt.includes("Cod encontrou Jhin na estrada"), "O fato de Jhin não chegou ao prompt.")
assert(prompt.includes('"name":"Jhin"'), "A menção estruturada de Jhin não chegou ao prompt.")
assert(prompt.includes('"name":"Elise"'), "A menção estruturada de Elise não chegou ao prompt.")
assert(prompt.includes('"role":"encountered"'), "O papel de Jhin no evento não chegou ao prompt.")
assert(prompt.includes('"role":"witness"'), "O papel de Elise no evento não chegou ao prompt.")
assert(prompt.includes("Jhin"), "Jhin não está presente no contexto textual do prompt.")
assert(prompt.includes("Elise"), "Elise não está presente no contexto textual do prompt.")
assert(
  prompt.includes("Não crie entidades para verbos, adjetivos, hábitos, lutas"),
  "A proteção contra falsos positivos não chegou ao prompt.",
)
assert(
  prompt.includes("A revisão humana é obrigatória"),
  "A exigência de aprovação humana não chegou ao prompt.",
)
assert(
  !prompt.includes("CANDIDATOS DETERMINÍSTICOS"),
  "O prompt ainda depende de candidatos determinísticos.",
)
assert(
  !prompt.includes("runCanonReconciliationRules"),
  "O prompt referencia o motor determinístico local.",
)

console.log(
  "OK — contexto V5 e prompt Ollama carregam menções, participantes, endpoints e guardrails de revisão humana.",
)
console.log(
  "Fluxo validado: a geração de proposals fica exclusivamente no Ollama; o smoke test não executa regras locais.",
)

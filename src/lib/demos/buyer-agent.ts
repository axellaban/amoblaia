/**
 * «Asistente de la propiedad»: the simulation an agency tries on its own demo
 * (docs/CRO_INSTRUMENTACION.md, section 8). Pure: shared by the server (who
 * sees it) and the block itself (what it answers). It answers by rules, only
 * from what the demo already publishes; it never states a measure, a
 * financing term or an availability the demo does not have, and it never
 * sends, books or stores anything (only the access request is saved).
 */

/** Per demo, in its editor: follow the general test, or force it for QA and live demos. */
export const BUYER_AGENT_MODES = ["auto", "show", "hide"] as const;
export type BuyerAgentMode = (typeof BUYER_AGENT_MODES)[number];
export const BUYER_AGENT_MODE_LABEL: Record<BuyerAgentMode, string> = {
  auto: "Automático (según la prueba general)",
  show: "Mostrar siempre",
  hide: "Ocultar siempre",
};
export const readBuyerAgentMode = (v: unknown): BuyerAgentMode => (BUYER_AGENT_MODES.includes(v as BuyerAgentMode) ? (v as BuyerAgentMode) : "auto");

/** The general test, set by the team in /admin/inmobiliarias. Off until the team turns it on. */
export type BuyerAgentSettings = { enabled: boolean; share: number };
export const BUYER_AGENT_OFF: BuyerAgentSettings = { enabled: false, share: 50 };

/** The experiment's name in PostHog (`experiment_variant` = `asistente_demo:<variant>`). */
export const BUYER_AGENT_EXPERIMENT = "asistente_demo";
export type BuyerAgentVariant = "asistente" | "control";
/**
 * Who sees the block on this demo, and how it counts:
 * - assignment "auto": the general test chose; `variant` goes to PostHog (both groups);
 * - "forced": the demo's editor forced it (QA, a live demo): out of the analysis, no variant;
 * - "off": the general test is off and nothing is forced: no block, no variant.
 */
export type BuyerAgentDecision = { show: boolean; variant: BuyerAgentVariant | null; assignment: "auto" | "forced" | "off" };

/** A stable 0–99 bucket per agency (FNV-1a): the same agency always lands in the same group, on every demo. */
export function agencyBucket(agencyId: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < agencyId.length; i++) {
    h ^= agencyId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

export function buyerAgentDecision(args: { settings: BuyerAgentSettings; mode: BuyerAgentMode; agencyId: string }): BuyerAgentDecision {
  if (args.mode === "hide") return { show: false, variant: null, assignment: "forced" };
  if (args.mode === "show") return { show: true, variant: null, assignment: "forced" };
  if (!args.settings.enabled) return { show: false, variant: null, assignment: "off" };
  const share = Math.min(100, Math.max(0, Math.round(args.settings.share)));
  const variant: BuyerAgentVariant = agencyBucket(args.agencyId) < share ? "asistente" : "control";
  return { show: variant === "asistente", variant, assignment: "auto" };
}

// ---------- The answers ----------

/** What the demo publishes and the block may use. Nothing else reaches it. */
export type AgentFacts = {
  title: string;
  location: string | null;
  operation: string | null;
  /** Null when missing or in conflict (the page invites to ask): never guessed. */
  price: string | null;
  availability: string | null;
  features: string | null;
};

export const AGENT_INTENTS = ["price", "availability", "viewing", "measures", "financing", "features", "location", "greeting", "unknown"] as const;
export type AgentIntent = (typeof AGENT_INTENTS)[number];

/** The suggested questions, in this order (the mockup). */
export const AGENT_SUGGESTIONS = ["¿Sigue disponible?", "¿Cuál es el precio?", "¿Entraría una mesa para seis?", "¿Puedo visitarla el sábado?"];

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function agentIntent(question: string): AgentIntent {
  const t = fold(question);
  if (/financ|hipotec|credito|prestamo|cuota|permuta/.test(t)) return "financing";
  if (/medida|metro|m2|mts|entra|entraria|cabe|cabria|ancho|largo|superficie|tamano|dimension/.test(t)) return "measures";
  if (/visit|conocer|recorr|verla|verlo|ver la|ver el|turno|coordinar|agendar|horario/.test(t)) return "viewing";
  if (/precio|valor|cuesta|expensa|cuanto (sale|vale|piden|es)|\bsale\b/.test(t)) return "price";
  if (/disponib|sigue|vendid|alquilad|reservad|libre/.test(t)) return "availability";
  if (/donde|ubicacion|barrio|zona|direccion|queda/.test(t)) return "location";
  if (/ambiente|dormitorio|habitacion|bano|cochera|balcon|patio|pileta|caracteristic|tiene/.test(t)) return "features";
  if (/^(hola|buenas|buen dia|buenos dias|buenas tardes)\b/.test(t)) return "greeting";
  return "unknown";
}

const WEEKDAYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
const DAY_NAME: Record<string, string> = { miercoles: "Miércoles", sabado: "Sábado" };
const dayName = (d: string) => DAY_NAME[d] ?? d.charAt(0).toUpperCase() + d.slice(1);

/** Two slots to offer: the day the visitor named, else tomorrow. Always to be confirmed by the agent. */
export function visitSlots(question: string): [string, string] {
  const t = fold(question);
  const day = WEEKDAYS.find((d) => t.includes(d));
  const label = day ? dayName(day) : "Mañana";
  return [`${label} 10:00`, `${label} 17:00`];
}

/** A budget the visitor said («hasta USD 100.000», «tengo 95 mil dólares»): shown in the CRM card, never assumed. */
export function statedBudget(question: string): string | null {
  const t = fold(question);
  // A currency before the number («USD 100.000», «$ 90 mil») or after it («95 mil dólares»).
  const before = t.match(/(usd|u\$s|us\$|\$)\s*(\d[\d.]*)(\s*mil)?/);
  const after = before ? null : t.match(/(\d[\d.]*)(\s*mil)?\s*(usd|u\$s|dolar)/);
  const m = before ?? after;
  if (!m) return null;
  const digits = (before ? before[2] : after![1]).replace(/\./g, "");
  const thousands = Boolean(before ? before[3] : after![2]);
  const n = Number(digits) * (thousands ? 1000 : 1);
  if (!Number.isFinite(n) || n < 1000) return null;
  const pesos = Boolean(before && before[1] === "$");
  return `${pesos ? "$" : "USD"} ${n.toLocaleString("es-AR")}`;
}

export type AgentReply = {
  intent: AgentIntent;
  text: string;
  /** Answered with a published field (price, availability, features, location). */
  answeredFromData: boolean;
  /** What the agent still has to answer: shown as pending in the CRM card. */
  pending: string | null;
  /** Offered visit slots, to be confirmed by the agent. */
  slots: [string, string] | null;
};

const ADVISOR = "Le paso tu consulta al asesor de la inmobiliaria, con el contexto de la propiedad.";

/** The feature a question asks about («¿Tiene cochera?»), to look for it in what is published. */
const FEATURE_WORDS = ["cochera", "garage", "balcon", "patio", "terraza", "pileta", "jardin", "parrilla", "quincho", "baulera", "ascensor", "amoblado", "mascota", "dormitorio", "ambiente", "bano"];
const askedFeature = (question: string) => FEATURE_WORDS.find((w) => fold(question).includes(w)) ?? null;

export function agentReply(question: string, facts: AgentFacts): AgentReply {
  const intent = agentIntent(question);
  const base = { intent, answeredFromData: false, pending: null as string | null, slots: null as [string, string] | null };
  switch (intent) {
    case "price":
      return facts.price
        ? { ...base, answeredFromData: true, text: `El precio publicado es ${facts.price}${facts.operation ? ` (${facts.operation.toLowerCase()})` : ""}. Las condiciones finales las confirma la inmobiliaria. ¿Querés coordinar una visita?` }
        : { ...base, pending: "Precio", text: `El precio se consulta con la inmobiliaria. ${ADVISOR}` };
    case "availability":
      return facts.availability
        ? { ...base, answeredFromData: true, text: `Según la publicación: ${facts.availability}. El asesor confirma el estado antes de coordinar una visita. ¿Qué día te serviría?` }
        : { ...base, pending: "Disponibilidad", text: `No tengo la disponibilidad confirmada. ${ADVISOR} ¿Querés coordinar una visita mientras tanto?` };
    case "viewing": {
      const slots = visitSlots(question);
      return { ...base, slots, text: `Podemos coordinar una visita. Te propongo ${slots[0]} o ${slots[1]}. El asesor de la inmobiliaria confirma el horario antes de agendarla.` };
    }
    case "measures":
      return { ...base, pending: "Medidas del ambiente", text: "La ambientación es ilustrativa y no tengo las medidas de este ambiente. Puedo pedírselas al asesor o coordinar una visita para que lo veas en persona. ¿Qué preferís?" };
    case "financing":
      return { ...base, pending: "Financiación", text: `No tengo ese dato verificado. ${ADVISOR}` };
    case "features": {
      // Only a yes the listing says: a feature asked for and not published goes to the agent, never «no».
      const asked = askedFeature(question);
      const published = facts.features && (!asked || fold(facts.features).includes(asked));
      return published
        ? { ...base, answeredFromData: true, text: `Según la publicación: ${facts.features}. Cualquier otro detalle lo confirma el asesor.` }
        : { ...base, pending: "Características", text: `No tengo ese detalle publicado. ${ADVISOR}` };
    }
    case "location":
      return facts.location
        ? { ...base, answeredFromData: true, text: `Está en ${facts.location}. La dirección exacta la comparte el asesor al coordinar la visita.` }
        : { ...base, pending: "Ubicación", text: `No tengo la ubicación publicada. ${ADVISOR}` };
    case "greeting":
      return { ...base, text: "¡Hola! Soy el asistente de esta propiedad. Puedo contarte lo que dice la publicación o ayudarte a coordinar una visita." };
    default:
      return { ...base, pending: "Consulta abierta", text: `${ADVISOR} Mientras tanto, puedo contarte el precio publicado o coordinar una visita.` };
  }
}

/** What the CRM card shows after the conversation so far: example data, nothing is saved or sent. */
export type AgentLead = { intent: AgentIntent | null; budget: string | null; pending: string[]; visit: string | null; nextAction: string };

export const AGENT_INTENT_LABEL: Record<AgentIntent, string> = {
  price: "Precio",
  availability: "Disponibilidad",
  viewing: "Visita",
  measures: "Medidas",
  financing: "Financiación",
  features: "Características",
  location: "Ubicación",
  greeting: "Saludo",
  unknown: "Consulta",
};

export function leadAfter(turns: { question: string; reply: AgentReply }[], visit: string | null): AgentLead {
  const last = turns.at(-1)?.reply.intent ?? null;
  const budget = turns.map((t) => statedBudget(t.question)).filter(Boolean).at(-1) ?? null;
  const pending = [...new Set(turns.map((t) => t.reply.pending).filter((p): p is string => Boolean(p)))];
  const nextAction = visit
    ? `Confirmar la visita del ${visit}`
    : pending.length
      ? `Responder: ${pending[0].toLowerCase()}`
      : turns.some((t) => t.reply.intent === "viewing")
        ? "Proponer horario de visita"
        : "Invitar a coordinar una visita";
  return { intent: visit ? "viewing" : last, budget, pending, visit, nextAction };
}

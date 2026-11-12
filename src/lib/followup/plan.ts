// Follow-up, Fase 1: qué pasó en la conversación (situación), qué toca hacer
// (acción, fija por código), si se puede hacer ahora (bloqueos) y en qué orden
// (grupos de la cola). Puro: lo comparten el servidor, el navegador y los tests.

import type { StageKey } from "./stages";
import { DEFAULT_RULES, pickRule, type Rule } from "./rules";

/** Qué pasó en la conversación. No crea etapas: el embudo sigue siendo el mismo. */
export const SITUATIONS = {
  sin_respuesta: "Sin respuesta",
  confirmo_numero: "Confirmó número",
  interesado: "Interesado",
  neutro: "Neutro",
  pregunta_precios: "Pregunta precios",
  mas_adelante: "Pide más adelante",
  recontactar_vacaciones: "Recontactar · Vacaciones",
  recontactar_mas_adelante: "Recontactar · Más adelante",
  derivo: "Derivó",
  rechazo: "No interesado",
  proveedor_ia: "No interesado (con proveedor)",
  no_contactar: "No contactar",
  sin_whatsapp: "Sin WhatsApp",
  numero_incorrecto: "Número incorrecto",
} as const;
export type Situation = keyof typeof SITUATIONS;
export const isSituation = (v: unknown): v is Situation => typeof v === "string" && v in SITUATIONS;

/** Situaciones que sacan a la inmobiliaria de la cola: no se le escribe más. */
export const CLOSED_SITUATIONS: Situation[] = ["rechazo", "proveedor_ia", "no_contactar", "sin_whatsapp", "numero_incorrecto"];
/** Clasificaciones de una respuesta: las situaciones, más las que van a Facu sin mandar nada. */
export const REPLY_CLASSES = {
  confirmo_numero: "Confirmó número",
  interesado: "Interesado",
  neutro: "Neutro",
  pregunta_precios: "Pregunta precios",
  mas_adelante: "Pide más adelante",
  recontactar_vacaciones: "Recontactar · Vacaciones",
  recontactar_mas_adelante: "Recontactar · Más adelante",
  derivo: "Derivó a otra persona",
  rechazo: "No interesado",
  proveedor_ia: "No interesado (con proveedor)",
  no_contactar: "No contactar",
  audio: "Audio",
  pregunta_no_cubierta: "Pregunta no cubierta",
} as const;
export type ReplyClass = keyof typeof REPLY_CLASSES;
export const isReplyClass = (v: unknown): v is ReplyClass => typeof v === "string" && v in REPLY_CLASSES;
/** Van a Facu sin mandar nada: un audio, una pregunta que el script no cubre, o una clasificación con poca confianza. */
export const FACU_CLASSES: ReplyClass[] = ["audio", "pregunta_no_cubierta"];
export const MIN_CONFIDENCE = 0.7;
export function replyRoute(c: ReplyClass | null, confidence: number | null): "aplicar" | "facu" | "revisar" {
  if (!c) return "revisar";
  if (FACU_CLASSES.includes(c)) return "facu";
  if (confidence !== null && confidence < MIN_CONFIDENCE) return "facu";
  return "aplicar";
}

/** Acciones con su propio mensaje dentro de una etapa. «principal» es la next best action de la etapa. */
export const ACTIONS = {
  principal: "Next best action",
  seguimiento_2: "Seguimiento 2",
  presentacion: "Presentación",
  presentacion_seguimiento: "Presentación sin respuesta",
  precios: "Precios",
  encuesta_cierre: "Despedida y encuesta",
} as const;
export type Action = keyof typeof ACTIONS;
export const isAction = (v: unknown): v is Action => typeof v === "string" && v in ACTIONS;
/** Las acciones de cada etapa: viven en rules.ts (fuente única). */
export { ACTIONS_OF, actionsOf, compatible } from "./rules";
/** Nombre de la acción para el equipo: en «No contactado», la principal es el saludo. */
export function actionLabel(stage: StageKey, action: Action) {
  if (action === "principal") return stage === "no-contactado" ? "Saludo" : stage === "no-responde" ? "Saludo sin respuesta" : stage === "sin-demo" ? "Crear demo" : stage === "sin-enviar" ? "Enviar demo" : stage === "no-abrio" ? "Seguimiento de demo 1" : ACTIONS.principal;
  if (action === "seguimiento_2") return stage === "no-abrio" ? "Seguimiento de demo 2" : "Seguimiento 2";
  return ACTIONS[action];
}
/** Cuándo se dispara cada acción, para el equipo. */
export function actionWhen(stage: StageKey, action: Action) {
  const step = SEQUENCE_OF(stage).find((x) => x.action === action);
  if (action === "presentacion") return "Cuando confirma el número";
  if (action === "encuesta_cierre") return "Cuando responde que no le interesa";
  if (action === "precios") return "Cuando pregunta precios";
  if (action === "presentacion_seguimiento") return `Presentación sin respuesta · a las ${PRESENTATION_FOLLOW_UP_HOURS} h`;
  if (stage === "no-contactado") return "Primer contacto";
  return step ? `Sin respuesta · a las ${step.afterHours} h del último mensaje` : "Sin respuesta";
}

/**
 * Las secuencias de seguimiento (Fase 2), fijas por código: cuántas horas
 * después de nuestro último mensaje sale cada paso. Después del último, la
 * secuencia termina: no hay reintentos infinitos.
 */
export const PRESENTATION_FOLLOW_UP_HOURS = 48;
const SEQUENCES: Partial<Record<StageKey, { action: Action; afterHours: number }[]>> = {
  "no-contactado": [{ action: "principal", afterHours: 0 }],
  "no-responde": [
    { action: "principal", afterHours: 48 },
    { action: "seguimiento_2", afterHours: 72 },
  ],
  "no-abrio": [
    { action: "principal", afterHours: 24 },
    { action: "seguimiento_2", afterHours: 72 },
  ],
};
export const SEQUENCE_OF = (stage: StageKey) => SEQUENCES[stage] ?? [{ action: "principal" as Action, afterHours: 48 }];

/** «Estado» de la hoja de prospección (source_data), sin tildes ni mayúsculas. */
const sheetKey = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * La situación que dicen los datos, sin corrección manual: la baja, la cuenta
 * perdida (con su motivo), el estado de la hoja, el número y la etapa de
 * prospección. Así la situación de la hoja queda migrada sin copiarla.
 */
export function derivedSituation(f: {
  suppressed: boolean;
  accountStage: string | null;
  lostReason: string | null;
  sheetStatus: string | null;
  hasNumber: boolean;
  allInvalid: boolean;
}): Situation {
  if (f.suppressed) return "no_contactar";
  if (f.accountStage === "lost" || f.accountStage === "discarded") return /proveedor/i.test(f.lostReason ?? "") ? "proveedor_ia" : "rechazo";
  const sheet = sheetKey(f.sheetStatus);
  if (sheet === "sin whatsapp") return "sin_whatsapp";
  if (sheet === "numero incorrecto") return "numero_incorrecto";
  if (f.allInvalid) return "sin_whatsapp";
  if (f.accountStage === "interested" || sheet === "interesado" || sheet === "responde interesado" || sheet === "demo enviada") return "interesado";
  if (sheet === "neutro" || sheet === "responde neutro") return "neutro";
  if (f.accountStage === "conversation" || /^(responde saludo inicial|respondio saludo|saludo respondido)$/.test(sheet)) return "confirmo_numero";
  return "sin_respuesta";
}

/**
 * Una pregunta puntual, no una postura: se responde en el paso en que se hizo
 * y no sigue al avanzar el embudo (si no, cada etapa nueva volvería a mandar precios).
 */
const STEP_SCOPED: Situation[] = ["pregunta_precios"];

/**
 * La situación es lo último que expresó la inmobiliaria y vale hasta que
 * exprese otra cosa: avanzar de etapa (mandarle la demo, que la abra) no la
 * cambia. Así quien pidió «más adelante» lo sigue pidiendo con la demo enviada.
 * Sin ninguna marcada, vale la que dicen los datos.
 */
export function currentSituation(derived: Situation, manual: { situation: Situation; step: number } | null, step: number) {
  if (!manual || (manual.step !== step && STEP_SCOPED.includes(manual.situation))) return { situation: derived, manual: false };
  return { situation: manual.situation, manual: true };
}

export type Planned = { action: Action | null; afterHours: number; reason: string | null; rule?: Rule | null };

/**
 * La próxima acción: la situación y la etapa dicen qué regla corre, y `done`
 * qué pasos ya salieron. `afterHours` es la espera desde nuestro último
 * mensaje (0: ya). Null: nada que mandar, con el motivo.
 *
 * Fijo en código (ninguna regla lo cambia): a un rechazo, un «no contactar» o
 * un número sin WhatsApp no se le escribe; un interesado en las dos primeras
 * etapas pasa a preparar la demo. Todo lo demás sale de las reglas
 * (`followup_rules`, editables en «Mensajes y reglas»; por defecto, las de la Fase 2).
 */
export function nextAction(stage: StageKey, situation: Situation, done: Partial<Record<Action, boolean>> = {}, rules: Rule[] = DEFAULT_RULES, demoGenerated = false): Planned {
  const none = (reason: string): Planned => ({ action: null, afterHours: 0, reason, rule: null });
  if (situation !== "rechazo" && CLOSED_SITUATIONS.includes(situation)) return none(`${SITUATIONS[situation]}: no se le escribe más.`);
  const early = stage === "no-contactado" || stage === "no-responde";
  if (early && situation === "interesado") return none("Interesado: preparar la demo (pasa a «Interesado, sin demo»).");
  return pickRule(rules, stage, situation, done, demoGenerated);
}

/** Grupos de la cola, en orden. Dentro de cada uno, por score y antigüedad. */
export const GROUPS = {
  respuestas: "Respuestas para atender",
  demos: "Demos pendientes",
  seguimientos: "Seguimientos",
  nuevos: "Contactos nuevos",
} as const;
export type Group = keyof typeof GROUPS;
const GROUP_ORDER: Group[] = ["respuestas", "demos", "seguimientos", "nuevos"];
export function groupOf(stage: StageKey, action: Action | null): Group {
  if (action === "encuesta_cierre" || action === "presentacion" || action === "precios") return "respuestas";
  if (action === "presentacion_seguimiento") return "seguimientos";
  if (stage === "sin-demo" || stage === "sin-enviar") return "demos";
  if (stage === "no-contactado") return "nuevos";
  return "seguimientos";
}

/** Prioridad de la cola: sale del grupo (respuestas y demos, alta; seguimientos, media; contactos nuevos, baja) salvo que el equipo la cambie. */
export const PRIORITIES = { alta: "Alta", media: "Media", baja: "Baja" } as const;
export type Priority = keyof typeof PRIORITIES;
export const isPriority = (v: unknown): v is Priority => typeof v === "string" && v in PRIORITIES;
const PRIORITY_ORDER: Priority[] = ["alta", "media", "baja"];
export function defaultPriority(group: Group): Priority {
  return group === "respuestas" || group === "demos" ? "alta" : group === "seguimientos" ? "media" : "baja";
}

/** La cola: por prioridad, después por grupo; dentro, score de mayor a menor (sin score al final) y las que esperan hace más tiempo. */
export function byPriority<T extends { group: Group; score: number | null; since: string; priority?: Priority; promisedAt?: string | null }>(a: T, b: T) {
  // A promised demo goes first of all, the oldest promise first.
  if (a.promisedAt || b.promisedAt) {
    if (!a.promisedAt) return 1;
    if (!b.promisedAt) return -1;
    return a.promisedAt.localeCompare(b.promisedAt);
  }
  const p = (x: T) => PRIORITY_ORDER.indexOf(x.priority ?? defaultPriority(x.group));
  return p(a) - p(b) || GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (b.score ?? -1) - (a.score ?? -1) || a.since.localeCompare(b.since);
}


/**
 * Orden alternativo de la cola. El comercial no premia eternamente una promesa
 * antigua: respuestas frescas y demos listas ganan a oportunidades estancadas.
 * P0–P5 son segmentos operativos, no probabilidades calculadas ni scores predictivos.
 */
export const QUEUE_ORDERS = { comercial: "Prioridad comercial recomendada", antiguedad: "Mayor tiempo esperando", score: "Mayor score comercial", anterior: "Prioridad anterior" } as const;
export type QueueOrder = keyof typeof QUEUE_ORDERS;
export const isQueueOrder = (x: unknown): x is QueueOrder => typeof x === "string" && x in QUEUE_ORDERS;
type CommercialQueueItem = { stage: StageKey; situation: Situation; group: Group; score: number | null; since: string; priority?: Priority;
  promisedAt?: string | null; lastReplyAt?: string | null; priorityManual?: boolean; action?: Action | null };
const recent = (at: string | null | undefined, now: number, hours: number) =>
  Boolean(at && Number.isFinite(Date.parse(at)) && Date.parse(at) <= now && now - Date.parse(at) <= hours * 3_600_000);
export function commercialTier(q: CommercialQueueItem, now = Date.now()): { tier: number; reason: string } {
  if (recent(q.lastReplyAt, now, 2) && ["interesado", "pregunta_precios", "confirmo_numero"].includes(q.situation))
    return { tier: 0, reason: "Respuesta comercial reciente (menos de 2 h)" };
  if (q.stage === "sin-enviar") return { tier: 1, reason: "Demo creada: falta enviarla" };
  if (q.stage === "sin-demo" && recent(q.promisedAt, now, 24))
    return { tier: 2, reason: "Interés reciente: falta crear la demo" };
  if (["sin-interaccion", "sin-cuenta", "sin-uso", "sin-suscripcion"].includes(q.stage))
    return { tier: 3, reason: "Actividad de producto: oportunidad de activación" };
  if (q.stage === "no-abrio") return { tier: 3, reason: "Demo enviada, pendiente de visita" };
  if (q.stage === "no-contactado") return { tier: 5, reason: "Primer contacto: adquisición" };
  if (q.stage === "sin-demo") return { tier: 4, reason: "Interés antiguo: recuperación, no urgencia perpetua" };
  return { tier: 4, reason: "Seguimiento según su regla vigente" };
}
export function byQueueOrder<T extends CommercialQueueItem>(a: T, b: T, order: QueueOrder = "comercial", now = Date.now()): number {
  if (order === "anterior") return byPriority(a, b);
  if (order === "antiguedad") return a.since.localeCompare(b.since) || byPriority(a, b);
  if (order === "score") return (b.score ?? -1) - (a.score ?? -1) || byPriority(a, b);
  const ta = commercialTier(a, now).tier, tb = commercialTier(b, now).tier;
  return ta - tb
    || PRIORITY_ORDER.indexOf(a.priority ?? defaultPriority(a.group)) - PRIORITY_ORDER.indexOf(b.priority ?? defaultPriority(b.group))
    || (b.score ?? -1) - (a.score ?? -1)
    || a.since.localeCompare(b.since);
}

// ---------------------------------------------------------------- horario

/** Hora de Buenos Aires (UTC-3 todo el año): día de la semana (0 domingo) y minutos desde las 0. */
function artClock(at: Date) {
  const t = new Date(at.getTime() - 3 * 3600_000);
  return { day: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
/** Contactos nuevos: lunes a sábado de 9 a 18. El resto (respuestas y seguimientos): lunes a sábado de 9 a 19. */
export const HOURS = { nuevos: [9, 18], resto: [9, 19] } as const;
export function outsideHours(group: Group, at = new Date()): string | null {
  const { day, minutes } = artClock(at);
  const [from, to] = group === "nuevos" ? HOURS.nuevos : HOURS.resto;
  if (day === 0 || minutes < from * 60 || minutes >= to * 60)
    return `Fuera de horario: ${group === "nuevos" ? "los contactos nuevos van" : "los mensajes van"} de lunes a sábado de ${from} a ${to} (hora de Argentina).`;
  return null;
}

/** Tope de conversaciones nuevas en 24 horas. */
export const DAILY_NEW_CAP = 48;


/**
 * A rolling 24-hour first-contact quota is capacity, not a boolean flag.
 * Only the highest priority candidates up to remaining capacity are "ready".
 * Already-claimed candidates reserve a slot so that refreshing the list
 * doesn't silently replace an operator's in-progress contact.
 */
type FirstContactCandidate = {
  agencyId: string;
  stage: StageKey;
  group: Group;
  situation: Situation;
  action: Action | null;
  versionChannel: "whatsapp" | "task" | null;
  blocked: string | null;
  execution: { status: string } | null;
  claim: { until: string } | null;
  score: number | null;
  since: string;
  priority?: Priority;
  promisedAt?: string | null;
  lastReplyAt?: string | null;
};
export const remainingFirstContactSlots = (sent24: number, cap = DAILY_NEW_CAP) =>
  Math.max(0, cap - Math.max(0, Math.floor(sent24)));

export function allocateFirstContactSlots<T extends FirstContactCandidate>(
  all: T[], sent24: number, now = Date.now(), cap = DAILY_NEW_CAP,
): { slots: number; ready: T[]; waiting: T[] } {
  const slots = remainingFirstContactSlots(sent24, cap);
  const candidates = all.filter((q) =>
    q.stage === "no-contactado" && q.group === "nuevos" && q.versionChannel === "whatsapp" &&
    q.action !== null && !q.blocked && q.execution?.status !== "sent");
  const claimed = candidates.filter((q) => q.claim?.until && Date.parse(q.claim.until) > now)
    .sort((a, b) => byQueueOrder(a, b, "comercial", now));
  const available = candidates.filter((q) => !q.claim?.until || Date.parse(q.claim.until) <= now)
    .sort((a, b) => byQueueOrder(a, b, "comercial", now));
  const ranked = [...claimed, ...available];
  return { slots, ready: ranked.slice(0, slots), waiting: ranked.slice(slots) };
}

// ---------------------------------------------------------------- mensajes

/**
 * Un texto puede ser varios mensajes seguidos (la presentación son tres): se
 * separan con una línea que solo tiene «---». Cada uno se manda aparte.
 */
export function splitMessages(text: string) {
  return text
    .split(/^\s*-{3,}\s*$/m)
    .map((m) => m.trim())
    .filter(Boolean);
}

/**
 * El nombre comercial corto para {{inmobiliaria}}: sin lo que va entre
 * paréntesis (el titular o la razón social) ni la forma societaria.
 * «Miramar Negocios Inmobiliarios (Miriam Martínez de Gómez)» → «Miramar Negocios Inmobiliarios».
 */
export function shortName(name: string) {
  const out = name
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[,\s-]+\b(s\.?\s?a\.?\s?s?|s\.?\s?r\.?\s?l|s\.?\s?a\.?\s?u|s\.?\s?h)\.?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return out || name.trim();
}

/** Para comparar nombres al buscar duplicados: sin tildes, sin «inmobiliaria», «propiedades» ni signos. */
export function nameKey(name: string) {
  return shortName(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(inmobiliaria|inmobiliarios?|propiedades|negocios|bienes raices|real estate|estudio|grupo)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

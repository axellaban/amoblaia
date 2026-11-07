// Follow-up, Fase 1: qué pasó en la conversación (situación), qué toca hacer
// (acción, fija por código), si se puede hacer ahora (bloqueos) y en qué orden
// (grupos de la cola). Puro: lo comparten el servidor, el navegador y los tests.

import type { StageKey } from "./stages";

/** Qué pasó en la conversación. No crea etapas: el embudo sigue siendo el mismo. */
export const SITUATIONS = {
  sin_respuesta: "Sin respuesta",
  confirmo_numero: "Confirmó número",
  interesado: "Interesado",
  neutro: "Neutro",
  pregunta_precios: "Pregunta precios",
  mas_adelante: "Pide más adelante",
  derivo: "Derivó",
  rechazo: "Rechazo",
  proveedor_ia: "No interesado (con proveedor)",
  no_contactar: "No contactar",
  sin_whatsapp: "Sin WhatsApp",
  numero_incorrecto: "Número incorrecto",
} as const;
export type Situation = keyof typeof SITUATIONS;
export const isSituation = (v: unknown): v is Situation => typeof v === "string" && v in SITUATIONS;

/** Situaciones que sacan a la inmobiliaria de la cola: no se le escribe más. */
export const CLOSED_SITUATIONS: Situation[] = ["rechazo", "proveedor_ia", "no_contactar", "sin_whatsapp", "numero_incorrecto"];
/** Situaciones que en la Fase 1 se resuelven a mano (la bandeja llega en la Fase 2). */
export const MANUAL_SITUATIONS: Situation[] = ["neutro", "mas_adelante", "derivo"];

/** Acciones con su propio mensaje dentro de una etapa. «principal» es la next best action de la etapa. */
export const ACTIONS = { principal: "Next best action", presentacion: "Presentación", precios: "Precios" } as const;
export type Action = keyof typeof ACTIONS;
export const isAction = (v: unknown): v is Action => typeof v === "string" && v in ACTIONS;
/** Las acciones de cada etapa: la presentación y los precios responden en «Contactado, no responde». */
export const ACTIONS_OF: Partial<Record<StageKey, Action[]>> = { "no-responde": ["principal", "presentacion", "precios"] };
export const actionsOf = (stage: StageKey): Action[] => ACTIONS_OF[stage] ?? ["principal"];
/** Nombre de la acción para el equipo: en «No contactado», la principal es el saludo. */
export const actionLabel = (stage: StageKey, action: Action) => (action === "principal" && stage === "no-contactado" ? "Saludo" : ACTIONS[action]);

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

/** Una corrección manual vale mientras el embudo siga en el paso en que se hizo (como la de la etapa). */
export function currentSituation(derived: Situation, manual: { situation: Situation; step: number } | null, step: number) {
  return manual && manual.step === step ? { situation: manual.situation, manual: true } : { situation: derived, manual: false };
}

/**
 * La próxima acción, fija por código en la Fase 1: la de la etapa, salvo que la
 * situación pida otra (confirmó el número → presentación; preguntó precios →
 * precios). Null: no hay nada que mandar (cerrada) o se resuelve a mano.
 */
export function nextAction(stage: StageKey, situation: Situation): { action: Action | null; reason: string | null } {
  if (CLOSED_SITUATIONS.includes(situation)) return { action: null, reason: `${SITUATIONS[situation]}: no se le escribe más.` };
  const early = stage === "no-contactado" || stage === "no-responde";
  if (early && situation === "confirmo_numero") return { action: "presentacion", reason: null };
  if (early && situation === "pregunta_precios") return { action: "precios", reason: null };
  if (early && situation === "interesado") return { action: null, reason: "Interesado: preparar la demo (pasa a «Interesado, sin demo»)." };
  if (MANUAL_SITUATIONS.includes(situation)) return { action: null, reason: `${SITUATIONS[situation]}: seguí el script a mano (la bandeja de respuestas llega en la Fase 2).` };
  return { action: "principal", reason: null };
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
  if (action === "presentacion" || action === "precios") return "respuestas";
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
export function byPriority<T extends { group: Group; score: number | null; since: string; priority?: Priority }>(a: T, b: T) {
  const p = (x: T) => PRIORITY_ORDER.indexOf(x.priority ?? defaultPriority(x.group));
  return p(a) - p(b) || GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (b.score ?? -1) - (a.score ?? -1) || a.since.localeCompare(b.since);
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
export const DAILY_NEW_CAP = 50;

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

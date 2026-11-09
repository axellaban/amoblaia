// Follow-up, Fase 3: las reglas de la next best action como datos, editables
// desde «Mensajes y reglas» sin pedir código. Una regla dice: en esta etapa,
// con esta situación, después de este paso (si hace falta), mandá esta acción
// a las N horas de nuestro último mensaje, dentro de esta ventana horaria.
// Puro: lo comparten el servidor, el navegador y los tests.

import type { StageKey } from "./stages";

type Situation =
  | "sin_respuesta"
  | "confirmo_numero"
  | "interesado"
  | "neutro"
  | "pregunta_precios"
  | "mas_adelante"
  | "derivo"
  | "rechazo"
  | "proveedor_ia"
  | "no_contactar"
  | "sin_whatsapp"
  | "numero_incorrecto";
export type Action = "principal" | "seguimiento_2" | "presentacion" | "presentacion_seguimiento" | "precios";

/**
 * Las acciones que cada etapa puede ejecutar. Fuente única: el motor, el
 * guardado de reglas y el panel la usan. Una regla con una acción fuera de su
 * etapa es «incompatible»: no se ejecuta, no se puede activar y no se puede crear.
 */
export const ACTIONS_OF: Partial<Record<StageKey, Action[]>> = {
  "no-responde": ["principal", "seguimiento_2", "presentacion", "presentacion_seguimiento", "precios"],
  "sin-demo": ["principal", "precios"],
  "sin-enviar": ["principal", "precios"],
  "no-abrio": ["principal", "seguimiento_2", "precios"],
  "sin-interaccion": ["principal", "precios"],
  "sin-cuenta": ["principal", "precios"],
  "sin-uso": ["principal", "precios"],
  "sin-suscripcion": ["principal", "precios"],
};
export const actionsOf = (stage: StageKey): Action[] => ACTIONS_OF[stage] ?? ["principal"];
/** Si la acción existe en la etapa. */
export const compatible = (stage: StageKey, action: Action | null | undefined) => !!action && actionsOf(stage).includes(action);

export type Rule = {
  /** Clave estable: la de las reglas sembradas, o la que se crea al agregar una. */
  key: string;
  /** Nombre que se le pone en el panel (opcional; sin nombre se muestra la acción). El motor no lo usa. */
  name?: string | null;
  stage: StageKey;
  /** Situaciones a las que aplica; vacía: cualquiera (las cerradas nunca). */
  situations: Situation[];
  action: Action;
  /** Horas desde nuestro último mensaje (0: enseguida). */
  after_hours: number;
  /** El paso que tiene que haber salido antes (null: ninguno). */
  after_action: Action | null;
  /** 3: require confirmed image generation inside a demo, 0: no condition. */
  min_demo_activity_level?: number;
  /** Orden de evaluación dentro de la etapa: gana la primera que corresponde. */
  position: number;
  enabled: boolean;
  /** Ventana horaria (hora de Argentina, de `hours_from` a `hours_to`) y días (0 domingo … 6 sábado). */
  hours_from: number;
  hours_to: number;
  days: number[];
};

const WEEK = [1, 2, 3, 4, 5, 6];
const EARLY = ["no-contactado", "no-responde"] as const;
const OTHER_STAGES = ["sin-demo", "sin-enviar", "sin-interaccion", "sin-cuenta", "sin-uso", "sin-suscripcion"] as const;
const rule = (r: Omit<Rule, "enabled" | "hours_from" | "hours_to" | "days"> & Partial<Rule>): Rule => ({
  enabled: true,
  min_demo_activity_level: 0,
  hours_from: 9,
  hours_to: r.stage === "no-contactado" && r.action === "principal" ? 18 : 19,
  days: WEEK,
  ...r,
});

/**
 * Las reglas de la Fase 2, escritas como datos. La migración las siembra
 * iguales en `followup_rules`; los tests comprueban que producen las mismas
 * acciones que el código anterior.
 */
export const DEFAULT_RULES: Rule[] = [
  ...EARLY.flatMap((stage) => [
    rule({ key: `${stage}:presentacion`, stage, situations: ["confirmo_numero", "derivo"], action: "presentacion", after_hours: 0, after_action: null, position: 10 }),
    rule({ key: `${stage}:presentacion_seguimiento`, stage, situations: ["confirmo_numero", "derivo"], action: "presentacion_seguimiento", after_hours: 48, after_action: "presentacion", position: 20 }),
    rule({ key: `${stage}:precios`, stage, situations: ["pregunta_precios"], action: "precios", after_hours: 0, after_action: null, position: 30 }),
  ]),
  rule({ key: "no-contactado:principal", stage: "no-contactado", situations: ["sin_respuesta", "neutro", "mas_adelante"], action: "principal", after_hours: 0, after_action: null, position: 40 }),
  rule({ key: "no-responde:principal", stage: "no-responde", situations: ["sin_respuesta", "neutro", "mas_adelante"], action: "principal", after_hours: 48, after_action: null, position: 40 }),
  rule({ key: "no-responde:seguimiento_2", stage: "no-responde", situations: ["sin_respuesta", "neutro", "mas_adelante"], action: "seguimiento_2", after_hours: 72, after_action: "principal", position: 50 }),
  rule({ key: "no-abrio:principal", stage: "no-abrio", situations: [], action: "principal", after_hours: 24, after_action: null, position: 40 }),
  rule({ key: "no-abrio:seguimiento_2", stage: "no-abrio", situations: [], action: "seguimiento_2", after_hours: 72, after_action: "principal", position: 50 }),
  // A demo to make or to send goes right away (a promised demo can't wait: Fase 3); the rest, 48 h after our last message.
  ...OTHER_STAGES.map((stage) => rule({ key: `${stage}:principal`, stage, situations: [], action: "principal", after_hours: stage === "sin-demo" || stage === "sin-enviar" ? 0 : 48, after_action: null, position: 40 })),
];

export type RulePick = { rule: Rule | null; action: Action | null; afterHours: number; reason: string | null };

/**
 * La primera regla activa de la etapa que corresponde a la situación, cuyo paso
 * no salió todavía y cuyo paso previo sí. Sin ninguna: la secuencia terminó.
 * Las situaciones cerradas y «interesado» en las dos primeras etapas no llegan
 * acá (las resuelve el código: ninguna regla puede escribirle a un rechazo).
 */
export function pickRule(rules: Rule[], stage: StageKey, situation: Situation, done: Partial<Record<Action, boolean>>, demoActivityLevel = 0): RulePick {
  // Las incompatibles (acción fuera de la etapa) no se ejecutan, aunque estén encendidas en la base.
  const own = rules
    .filter((r) => r.enabled && r.stage === stage && compatible(stage, r.action) && (!r.after_action || compatible(stage, r.after_action)))
    .filter((r) => r.situations.length === 0 || r.situations.includes(situation))
    .filter((r) => (r.min_demo_activity_level ?? 0) <= demoActivityLevel)
    .sort((a, b) => a.position - b.position);
  for (const r of own) {
    if (done[r.action]) continue;
    if (r.after_action && !done[r.after_action]) continue;
    return { rule: r, action: r.action, afterHours: r.after_hours, reason: null };
  }
  if (!own.length) return { rule: null, action: null, afterHours: 0, reason: "Ninguna regla activa para esta etapa y situación." };
  if (situation === "pregunta_precios" && done.precios) return { rule: null, action: null, afterHours: 0, reason: "Ya se le respondió por precios: esperá su respuesta." };
  if (done.presentacion && (situation === "confirmo_numero" || situation === "derivo"))
    return { rule: null, action: null, afterHours: 0, reason: "Secuencia terminada: no respondió a la presentación ni a su seguimiento." };
  return { rule: null, action: null, afterHours: 0, reason: own.length === 1 ? "Secuencia terminada: ya se mandó su acción." : `Secuencia terminada: sin respuesta después de ${own.length} mensajes.` };
}

/** Si ahora está fuera de la ventana de la regla (hora de Argentina), el motivo; si no, null. */
export function outsideWindow(r: Pick<Rule, "hours_from" | "hours_to" | "days">, at = new Date()) {
  const t = new Date(at.getTime() - 3 * 3600_000);
  const day = t.getUTCDay();
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (!r.days.includes(day) || minutes < r.hours_from * 60 || minutes >= r.hours_to * 60) return `Fuera de horario: ${daysText(r.days)} de ${r.hours_from} a ${r.hours_to} (hora de Argentina).`;
  return null;
}
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export function daysText(days: number[]) {
  const d = [...days].sort();
  if (d.join() === "1,2,3,4,5,6") return "lunes a sábado";
  if (d.join() === "1,2,3,4,5") return "lunes a viernes";
  if (d.join() === "0,1,2,3,4,5,6") return "todos los días";
  return d.map((x) => DAY_NAMES[x]).join(", ");
}

/** Valida una regla que llega del panel. */
export function cleanRule(input: Record<string, unknown>, situations: readonly string[], actions: readonly string[], stages: readonly string[]): Omit<Rule, "key"> | { error: string } {
  if (typeof input.stage !== "string" || !stages.includes(input.stage)) return { error: "Etapa desconocida." };
  if (typeof input.action !== "string" || !actions.includes(input.action)) return { error: "Acción desconocida." };
  const sits = Array.isArray(input.situations) ? input.situations.filter((s): s is Situation => typeof s === "string" && situations.includes(s)) : [];
  const num = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : NaN);
  const after = num(input.after_hours);
  if (!Number.isFinite(after) || after < 0 || after > 720) return { error: "La espera va de 0 a 720 horas." };
  const from = num(input.hours_from);
  const to = num(input.hours_to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > 24 || from >= to) return { error: "La ventana horaria va de 0 a 24, y «desde» antes que «hasta»." };
  const days = Array.isArray(input.days) ? [...new Set(input.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : WEEK;
  if (!days.length) return { error: "Elegí al menos un día." };
  const afterAction = input.after_action === null || input.after_action === "" || input.after_action === undefined ? null : typeof input.after_action === "string" && actions.includes(input.after_action) ? (input.after_action as Action) : undefined;
  if (afterAction === undefined) return { error: "El paso previo es desconocido." };
  if (afterAction === input.action) return { error: "Una regla no puede esperar a su propio paso." };
  const minimum = input.min_demo_activity_level === undefined ? 0 : num(input.min_demo_activity_level);
  if (minimum !== 0 && minimum !== 3) return { error: "La condición de generación debe ser 0 o 3." };
  const stageKey = input.stage as StageKey;
  if (minimum === 3 && !["no-abrio", "sin-interaccion", "sin-cuenta"].includes(stageKey)) return { error: "La condición Generó imagen solo corresponde a Demo enviada." };
  if (afterAction && !compatible(stageKey, afterAction)) return { error: "El paso previo no es una acción de esta etapa." };
  // Una regla con acción fuera de su etapa puede quedar apagada (para no perderla), pero no encendida ni nueva.
  const enabled = input.enabled !== false;
  if (enabled && !compatible(stageKey, input.action as Action)) return { error: "Una regla con acción no disponible en su etapa no se puede activar." };
  const position = num(input.position);
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (name.length > 80) return { error: "El nombre de la regla va hasta 80 caracteres." };
  return {
    name: name || null,
    stage: input.stage as StageKey,
    situations: sits,
    action: input.action as Action,
    after_hours: Math.round(after * 10) / 10,
    after_action: afterAction,
    min_demo_activity_level: minimum,
    position: Number.isFinite(position) ? Math.max(0, Math.min(1000, Math.round(position))) : 100,
    enabled,
    hours_from: from,
    hours_to: to,
    days: days.sort(),
  };
}

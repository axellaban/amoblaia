// «Leads» de Follow-up: dónde está cada inmobiliaria hoy, en qué estado de la cola, por qué no sale
// y qué reglas activas dejaron de ejecutarse. No decide nada: lee la cola que ya arma el motor
// (server.ts) y la ordena para ver de un vistazo dónde se traban los leads. Puro: lo usan el
// servidor y los tests.
import { queueDayState, type QueueDayRow } from "./results";
import type { Rule } from "./rules";

/** El estado de un lead en la cola, en lo que hace falta para destrabarlo. */
export type LeadState =
  | "lista" // puede salir ahora
  | "tomada" // alguien la está ejecutando
  | "programada" // sale sola más adelante (horas de la regla, horario, cupo)
  | "reprogramada" // alguien la pospuso
  | "equipo" // pasada a Facu o Axel, o con una respuesta para Facu
  | "respuesta" // tiene una respuesta sin clasificar en la bandeja
  | "bloqueada" // le falta un dato o algo para poder salir
  | "hecha" // ya salió el mensaje de su etapa: espera que avance o conteste
  | "sin_accion"; // ninguna regla le corresponde

export const LEAD_STATES: LeadState[] = ["lista", "tomada", "programada", "reprogramada", "equipo", "respuesta", "bloqueada", "hecha", "sin_accion"];
export const LEAD_STATE_LABEL: Record<LeadState, string> = {
  lista: "Lista para mandar",
  tomada: "Tomada",
  programada: "Programada",
  reprogramada: "Reprogramada",
  equipo: "Esperando al equipo",
  respuesta: "Respuesta sin clasificar",
  bloqueada: "Bloqueada",
  hecha: "Mensaje enviado",
  sin_accion: "Sin acción",
};

/** Lo que la vista necesita de cada item de la cola (QueueItem en server.ts). */
export type LeadInput = {
  agencyId: string;
  name: string;
  stage: string;
  situation: string;
  action: string | null;
  actionLabel: string | null;
  actionReason: string | null;
  ruleKey: string | null;
  blocked: string | null;
  handoffTo: string | null;
  dueAt: string | null;
  snoozedUntil: string | null;
  claim: { by: string; until: string } | null;
  owner: string | null;
  execution: { status: string; at: string } | null;
  /** «Crear demo»: lo que Prospectos dejó en su panel (la propiedad principal, si quedó). */
  demoKit?: { prep: { items: { key: string; ok: boolean; demoId: string | null }[] } | null } | null;
};
export type LeadExecution = { agency_id: string; stage: string; action?: string | null; status: string; sent_at: string | null };
export type LeadStage = { key: string; title: string; goal: string };

export type LeadRow = {
  agencyId: string;
  name: string;
  stage: string;
  situation: string;
  state: LeadState;
  /** Por qué está así, en palabras de la cola. */
  reason: string;
  /** Quién la tiene: Facu, Axel, la persona que la tomó. */
  who: string | null;
  /** Días seguidos en esta etapa y este estado, según la foto diaria de la cola (1 = desde hoy). */
  days: number;
  /** La próxima acción que le corresponde. */
  next: string | null;
  ruleKey: string | null;
  /** El último mensaje que le salió: la regla (o su acción), la etapa y cuándo. */
  lastRule: { label: string; stage: string; at: string } | null;
  /** En «Crear demo» (Interesado, sin demo): dónde se crea a mano, aunque la tarea esté bloqueada. */
  createDemo: string | null;
};
export type RuleHealth = {
  key: string;
  name: string;
  stage: string;
  enabled: boolean;
  /** Último envío confirmado de esta regla (su etapa y su acción). */
  lastSentAt: string | null;
  /** Envíos confirmados en los últimos 21 días. */
  sent21: number;
  /** Leads de la cola a los que hoy les toca esta regla, por estado. */
  states: Partial<Record<LeadState, number>>;
  pending: number;
};
export type LeadAlert =
  | { kind: "regla"; ruleKey: string; name: string; stage: string; days: number | null; pending: number; states: Partial<Record<LeadState, number>> }
  | { kind: "listas"; stage: string; count: number; oldest: number };
export type LeadsView = {
  stages: (LeadStage & { count: number; states: Partial<Record<LeadState, number>>; rules: RuleHealth[] })[];
  rows: LeadRow[];
  alerts: LeadAlert[];
  /** Una regla activa con leads que no sale hace más de estos días se avisa. */
  staleDays: number;
};

const DAY = 86_400_000;
/** The day in Buenos Aires (UTC-3), as YYYY-MM-DD. */
const artDay = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);
const TEAM = /^(Asignada a Facu|Pasada a (Facu|Axel))/;

/** Una regla que no sale hace más de esto, con leads esperándola, se avisa. */
export const STALE_DAYS = 3;
/** Una lista que nadie mandó durante estos días seguidos se avisa. */
export const READY_DAYS = 2;

/** El estado de un lead y por qué, con las mismas reglas que la cola (queueDayState). */
export function leadStateOf(q: LeadInput, now = new Date()): { state: LeadState; reason: string; who: string | null } {
  if (!q.action) return { state: "sin_accion", reason: q.actionReason ?? "Ninguna regla le corresponde ahora.", who: null };
  if (q.execution?.status === "sent") return { state: "hecha", reason: `Ya salió «${q.actionLabel ?? q.action}»: espera que avance o que conteste.`, who: null };
  const b = q.blocked;
  if (q.handoffTo || (b && TEAM.test(b))) {
    const who = q.handoffTo ?? (/Axel/.test(b ?? "") ? "Axel" : "Facu");
    return { state: "equipo", reason: b ?? `Pasada a ${who}.`, who };
  }
  if (b?.startsWith("Tiene una respuesta sin clasificar")) return { state: "respuesta", reason: b, who: null };
  if (q.claim && Date.parse(q.claim.until) > now.getTime()) return { state: "tomada", reason: `La está ejecutando ${q.claim.by}.`, who: q.claim.by };
  if (q.snoozedUntil && Date.parse(q.snoozedUntil) > now.getTime()) return { state: "reprogramada", reason: b ?? "Reprogramada.", who: null };
  if (!b) return { state: "lista", reason: "Puede salir ahora.", who: null };
  const day = queueDayState({ dueAt: q.dueAt, snoozedUntil: q.snoozedUntil, blocked: b }, now);
  if (day === "programada" || q.dueAt) return { state: "programada", reason: b, who: null };
  if (day === "lista") return { state: "lista", reason: b, who: null };
  return { state: "bloqueada", reason: b, who: null };
}

/** El estado como lo guarda la foto diaria de la cola. */
const dayStateOf = (s: LeadState): QueueDayRow["state"] | null =>
  s === "lista" || s === "tomada" ? "lista" : s === "programada" || s === "reprogramada" ? "programada" : s === "hecha" || s === "sin_accion" ? null : "bloqueada";

/** Días seguidos (hasta hoy) en esa etapa con ese estado en la foto diaria. Sin foto, 1. */
function daysIn(history: Map<string, QueueDayRow[]>, agencyId: string, stage: string, state: LeadState, today: string) {
  const want = dayStateOf(state);
  const rows = history.get(agencyId);
  if (!want || !rows?.length) return 1;
  const byDay = new Map(rows.filter((r) => r.stage === stage).map((r) => [r.day, r.state]));
  let n = 0;
  let cursor = Date.parse(`${today}T12:00:00Z`);
  // Today may not be photographed yet: it counts as the state seen now.
  for (let first = true; ; first = false) {
    const day = new Date(cursor).toISOString().slice(0, 10);
    const seen = byDay.get(day);
    if (seen === want || (first && seen === undefined)) n++;
    else break;
    cursor -= DAY;
    if (n > 120) break;
  }
  return Math.max(1, n);
}

/**
 * «Crear demo» a mano: la propiedad que Prospectos dejó en su panel (sus fotos a un clic) o una
 * demo nueva. Solo en «Interesado, sin demo»; la ruta es del panel del equipo de habita.
 */
export function createDemoPath(q: Pick<LeadInput, "agencyId" | "stage" | "demoKit">) {
  if (q.stage !== "sin-demo") return null;
  const main = q.demoKit?.prep?.items.find((i) => i.key === "demo_listing_url" && i.ok && i.demoId);
  return main ? `/admin/inmobiliarias/${q.agencyId}/propiedades/${main.demoId}?seccion=fotos` : `/admin/inmobiliarias/${q.agencyId}/propiedades/nueva`;
}

const ruleName = (r: Pick<Rule, "name" | "action" | "stage">, label: (stage: string, action: string) => string) => r.name?.trim() || label(r.stage, r.action);

export function leadsView(input: {
  items: LeadInput[];
  executions: LeadExecution[];
  rules: Pick<Rule, "key" | "name" | "stage" | "action" | "enabled" | "product_stages">[];
  queueDays: QueueDayRow[] | null;
  stages: LeadStage[];
  /** El nombre de una acción en su etapa (actionLabel en plan.ts). */
  label?: (stage: string, action: string) => string;
  now?: Date;
}): LeadsView {
  const now = input.now ?? new Date();
  const label = input.label ?? ((_: string, action: string) => action);
  const today = artDay(now.getTime());
  const history = new Map<string, QueueDayRow[]>();
  for (const r of input.queueDays ?? []) history.set(r.agency_id, [...(history.get(r.agency_id) ?? []), r]);
  const sent = input.executions.filter((e) => e.status === "sent" && e.sent_at);
  const lastSentByAgency = new Map<string, LeadExecution>();
  for (const e of sent) {
    const prev = lastSentByAgency.get(e.agency_id);
    if (!prev || Date.parse(e.sent_at!) > Date.parse(prev.sent_at!)) lastSentByAgency.set(e.agency_id, e);
  }
  const ruleOfSend = (e: LeadExecution) =>
    input.rules.find((r) => r.action === e.action && (r.stage === e.stage || (r.product_stages ?? []).includes(e.stage as never)));

  const rows: LeadRow[] = input.items.map((q) => {
    const { state, reason, who } = leadStateOf(q, now);
    const last = lastSentByAgency.get(q.agencyId);
    const rule = last ? ruleOfSend(last) : undefined;
    return {
      agencyId: q.agencyId,
      name: q.name,
      stage: q.stage,
      situation: q.situation,
      state,
      reason,
      who: who ?? null,
      days: daysIn(history, q.agencyId, q.stage, state, today),
      next: q.action ? q.actionLabel ?? q.action : null,
      ruleKey: q.ruleKey,
      createDemo: createDemoPath(q),
      lastRule: last ? { label: rule ? ruleName(rule, label) : last.action ? label(last.stage, last.action) : "Mensaje", stage: last.stage, at: last.sent_at! } : null,
    };
  });

  const count = (list: LeadRow[]) => {
    const out: Partial<Record<LeadState, number>> = {};
    for (const r of list) out[r.state] = (out[r.state] ?? 0) + 1;
    return out;
  };
  const active = (r: LeadRow) => r.state !== "hecha" && r.state !== "sin_accion";
  const health = (rule: (typeof input.rules)[number]): RuleHealth => {
    const own = sent.filter((e) => e.action === rule.action && (e.stage === rule.stage || (rule.product_stages ?? []).includes(e.stage as never)));
    const lastSentAt = own.reduce<string | null>((m, e) => (!m || Date.parse(e.sent_at!) > Date.parse(m) ? e.sent_at : m), null);
    const mine = rows.filter((r) => r.ruleKey === rule.key && active(r));
    return {
      key: rule.key,
      name: ruleName(rule, label),
      stage: rule.stage,
      enabled: rule.enabled,
      lastSentAt,
      sent21: own.filter((e) => now.getTime() - Date.parse(e.sent_at!) <= 21 * DAY).length,
      states: count(mine),
      pending: mine.length,
    };
  };
  const rules = input.rules.map(health);

  const stages = input.stages.map((s) => {
    const own = rows.filter((r) => r.stage === s.key);
    return { ...s, count: own.length, states: count(own), rules: rules.filter((r) => r.stage === s.key || rows.some((x) => x.ruleKey === r.key && x.stage === s.key)) };
  });

  const alerts: LeadAlert[] = [];
  for (const r of rules) {
    if (!r.enabled || !r.pending) continue;
    // Calendar days in Buenos Aires: sent on the 12th, on the 19th it is 7 days ago.
    const days = r.lastSentAt ? Math.round((Date.parse(artDay(now.getTime())) - Date.parse(artDay(Date.parse(r.lastSentAt)))) / DAY) : null;
    if (days === null || days > STALE_DAYS) alerts.push({ kind: "regla", ruleKey: r.key, name: r.name, stage: r.stage, days, pending: r.pending, states: r.states });
  }
  for (const s of input.stages) {
    const ready = rows.filter((r) => r.stage === s.key && r.state === "lista" && r.days >= READY_DAYS);
    if (ready.length) alerts.push({ kind: "listas", stage: s.key, count: ready.length, oldest: Math.max(...ready.map((r) => r.days)) });
  }
  // Rules without sends for longer first; then ready tasks nobody sent.
  alerts.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "regla" ? -1 : 1) || (a.kind === "regla" && b.kind === "regla" ? (b.days ?? 999) - (a.days ?? 999) : 0));

  return { stages, rows, alerts, staleDays: STALE_DAYS };
}

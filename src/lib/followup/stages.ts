// Follow-up: una next best action por etapa del embudo de Inmobiliarias. Las
// etapas son los que «se quedaron» en cada paso (la parte naranja de cada
// barra), más las inmobiliarias de prospección todavía sin contactar. Puro:
// lo comparten el servidor, el navegador y los tests.

import { AGENCY_STEPS } from "@/lib/agency/demo-funnel";

export const FOLLOWUP_STAGES = [
  { key: "no-contactado", step: -1, title: "No contactado", goal: "Contactado" },
  { key: "no-responde", step: 0, title: "Contactado, no responde", goal: "Interesado" },
  { key: "sin-demo", step: 1, title: "Interesado, sin demo", goal: "Demo creada" },
  { key: "sin-enviar", step: 2, title: "Demo creada, sin enviar", goal: "Enviada" },
  { key: "no-abrio", step: 3, title: "Enviada, no abrió", goal: "Con visita" },
  { key: "sin-interaccion", step: 4, title: "Visitó, sin interactuar", goal: "Con interacción" },
  { key: "sin-cuenta", step: 5, title: "Interactuó, sin cuenta", goal: "Cuenta creada" },
  { key: "sin-uso", step: 6, title: "Cuenta creada, sin uso", goal: "Cuenta con interacción" },
  { key: "sin-suscripcion", step: 7, title: "Cuenta activa, sin suscripción", goal: "Suscripción" },
] as const;
export type StageKey = (typeof FOLLOWUP_STAGES)[number]["key"];
export const STAGE_KEYS = FOLLOWUP_STAGES.map((s) => s.key) as StageKey[];
export const isStageKey = (v: unknown): v is StageKey => typeof v === "string" && (STAGE_KEYS as string[]).includes(v);
export const stageInfo = (key: StageKey) => FOLLOWUP_STAGES.find((s) => s.key === key)!;
// The last step (Suscripciones) has nothing after it: no follow-up.
if (FOLLOWUP_STAGES.at(-1)!.step !== AGENCY_STEPS.length - 2) throw new Error("FOLLOWUP_STAGES out of sync with AGENCY_STEPS");

export type Channel = "whatsapp" | "task";
export const CTA_KEYS = ["whatsapp", "demo", "panel", "copy", "create_demo"] as const;
export type Cta = (typeof CTA_KEYS)[number];
export const CTA_LABEL: Record<Cta, string> = {
  whatsapp: "Abrir WhatsApp",
  demo: "Link demo",
  panel: "Link panel",
  copy: "Copiar mensaje",
  create_demo: "Crear demo",
};
export const VARIABLES = {
  inmobiliaria: "Nombre de la inmobiliaria",
  decisor: "Nombre de quien decide",
  sdr: "Quien envía",
  demo: "Link a su demo",
  panel: "Link a su panel",
} as const;
export type MessageContext = Partial<Record<keyof typeof VARIABLES, string | null>>;

export type VersionStatus = "active" | "test" | "archived";
export type FollowupVersion = {
  id: string;
  stage: StageKey;
  version: number;
  channel: Channel;
  trigger_label: string;
  body: string;
  ctas: Cta[];
  status: VersionStatus;
  created_at: string;
  status_at: string;
  /** Observaciones: lo que la extensión lee debajo del mensaje antes de ejecutarlo. */
  notes: string;
  /** Cuándo se editó el texto por última vez (null: nunca): sus números juntan el texto anterior y el nuevo. */
  edited_at: string | null;
};
export type ExecutionStatus = "opened" | "sent" | "failed";
export type FollowupExecution = {
  id: string;
  version_id: string;
  stage: StageKey;
  agency_id: string;
  from_step: number;
  status: ExecutionStatus;
  reason: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
};

/**
 * The follow-up stage of an agency, from the same facts as the funnel:
 * `reached` is its highest step (agencyStep), null when it was never
 * contacted. A lost or test agency, a suppressed prospect or one that already
 * subscribed has none. `pendingProspect`: a prospecting account still to
 * contact (not lost or discarded).
 */
export function stageOf(f: { reached: number | null; lost: boolean; test: boolean; suppressed: boolean; pendingProspect: boolean }): StageKey | null {
  if (f.test || f.lost || f.suppressed) return null;
  if (f.reached === null) return f.pendingProspect ? "no-contactado" : null;
  return FOLLOWUP_STAGES.find((s) => s.step === f.reached)?.key ?? null;
}

/** The step the agency is at for the measurement: -1 before it was contacted. */
export const stepValue = (reached: number | null) => (reached === null ? -1 : reached);

/** «fuera»: corrected out of Follow-up (lost, not an agency, a duplicate). */
export const OUT = "fuera" as const;
export type OverrideStage = StageKey | typeof OUT;
export const isOverrideStage = (v: unknown): v is OverrideStage => v === OUT || isStageKey(v);
export type Override = { stage: OverrideStage; step: number } | null;

/**
 * Where an agency goes in Follow-up: its stage from the funnel, unless the
 * team (or the extension) corrected it. The correction holds while the funnel
 * still says what it said then (`override.step`, the funnel's step when it was
 * set); once something real happens (a send, a visit, an account), the funnel
 * rules again. `step` is the one the measurement uses: the corrected stage's.
 */
export function placement(derived: { reached: number | null; stage: StageKey | null }, override: Override) {
  const funnel = stepValue(derived.reached);
  if (override && override.step === funnel) {
    if (override.stage === OUT) return { stage: null, step: funnel, manual: true };
    return { stage: override.stage, step: stageInfo(override.stage).step, manual: true };
  }
  return { stage: derived.stage, step: funnel, manual: false };
}

/** The queue's order: score from highest to lowest (without a score, last); then the ones still to do with a WhatsApp, the longest waiting first. */
export function byScore<T extends { score: number | null; wa: string | null; since: string; execution: { status: string } | null }>(a: T, b: T) {
  const score = (b.score ?? -1) - (a.score ?? -1);
  if (score) return score;
  const rank = (q: T) => (q.execution?.status === "sent" ? 2 : q.wa ? 0 : 1);
  return rank(a) - rank(b) || a.since.localeCompare(b.since);
}

/** Small stable hash (FNV-1a) for the A/B split: the same agency always gets the same version. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The version an agency gets in a stage: the one it already started with
 * (opened, sent or failed) while it is still offered, else the active one or,
 * with a test running, half of the agencies get the test.
 */
export function versionFor(agencyId: string, versions: FollowupVersion[], previous: FollowupExecution[] = []) {
  const live = versions.filter((v) => v.status !== "archived");
  const active = live.find((v) => v.status === "active") ?? null;
  const test = live.find((v) => v.status === "test") ?? null;
  const started = [...previous].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).find((e) => live.some((v) => v.id === e.version_id));
  if (started) return live.find((v) => v.id === started.version_id)!;
  if (test && active) return hash(`${agencyId}:${active.stage}`) % 2 ? test : active;
  return active ?? test;
}

/**
 * Fills the {{variables}}; an unknown or empty one stays visible so the
 * message is never sent with a hole. {{decisor}} is the exception: without a
 * name it goes away with its comma («Hola {{decisor}}, soy…» → «Hola, soy…»;
 * «{{decisor}}, te dejo…» → «Te dejo…»).
 */
export function fillMessage(text: string, ctx: MessageContext) {
  let out = text;
  if (!ctx.decisor?.trim())
    out = out
      .replace(/[ \t]*\{\{\s*decisor\s*\}\}/g, "")
      .replace(/^([ \t]*),[ \t]*(\S)/gm, (_, sp: string, c: string) => sp + c.toUpperCase());
  return out.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => {
    const v = ctx[key as keyof MessageContext];
    return v && v.trim() ? v.trim() : m;
  });
}

/**
 * A person's first name, or null when the field holds a category instead of
 * a name: the prospecting sheet writes «Por confirmar», «Familiar (apellido)»,
 * «Dueño/a con nombre propio», «Marca comercial» or «Franquicia / corporativa».
 */
export function personName(v: string | null | undefined) {
  const t = v?.trim() ?? "";
  if (!t || t.length > 60 || /[/()@\d]|confirmar|familiar|dueñ|marca|franquicia|corporativ|inmobiliaria|equipo|recepci|administraci|ventas/i.test(t)) return null;
  const first = t.split(/\s+/)[0];
  return /^\p{Lu}[\p{L}'-]+$/u.test(first) ? first : null;
}
export const missingVariables = (text: string) => [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];
/** The links a version needs resolved: the ones in its text and its CTAs. */
export function linksNeeded(v: Pick<FollowupVersion, "body" | "ctas">) {
  const vars = missingVariables(v.body);
  return { demo: vars.includes("demo") || v.ctas.includes("demo"), panel: vars.includes("panel") || v.ctas.includes("panel") };
}

/**
 * Each version's numbers. Executions: sent, once per agency. Conversions: of
 * those, the agencies whose step today is past the one they were at when it
 * was sent (they reached the next step after it). The rate is null without
 * executions; under `small` executions the sample is small.
 */
export function versionStats(versions: FollowupVersion[], executions: FollowupExecution[], stepNow: Map<string, number>, small = 30) {
  return versions.map((v) => {
    const sent = executions.filter((e) => e.version_id === v.id && e.status === "sent");
    const converted = sent.filter((e) => (stepNow.get(e.agency_id) ?? -1) > e.from_step).length;
    return {
      id: v.id,
      executions: sent.length,
      conversions: converted,
      rate: sent.length ? converted / sent.length : null,
      opened: executions.filter((e) => e.version_id === v.id && e.status === "opened").length,
      smallSample: sent.length > 0 && sent.length < small,
    };
  });
}
export type VersionStats = ReturnType<typeof versionStats>[number];

/** «12%», «4.5%» under 10%, «—» without executions. */
export const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(r < 0.1 && r > 0 ? 1 : 0).replace(".", ",")}%`);

/** Validates a new version (or an edit of one) from the panel. Returns the clean fields or an error message. */
export function cleanVersion(input: { stage?: unknown; channel?: unknown; trigger?: unknown; body?: unknown; ctas?: unknown; status?: unknown; notes?: unknown }) {
  if (!isStageKey(input.stage)) return { error: "Etapa desconocida." } as const;
  const channel = input.channel === "task" ? "task" : input.channel === "whatsapp" ? "whatsapp" : null;
  if (!channel) return { error: "El canal es WhatsApp o tarea del equipo." } as const;
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return { error: "Escribí la next best action." } as const;
  if (body.length > 4000) return { error: "El texto supera los 4000 caracteres." } as const;
  const unknown = missingVariables(body).filter((v) => !(v in VARIABLES));
  if (unknown.length) return { error: `Variable desconocida: {{${unknown[0]}}}. Se pueden usar ${Object.keys(VARIABLES).map((k) => `{{${k}}}`).join(", ")}.` } as const;
  const trigger = typeof input.trigger === "string" ? input.trigger.trim().slice(0, 120) : "";
  const ctas = Array.isArray(input.ctas) ? CTA_KEYS.filter((k) => (input.ctas as unknown[]).includes(k)) : [];
  const status = input.status === "test" ? "test" : "active";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (notes.length > 4000) return { error: "Las observaciones superan los 4000 caracteres." } as const;
  return { stage: input.stage, channel, trigger, body, ctas, status, notes } as const;
}

const EXEC_TEXT: Record<ExecutionStatus, string> = { sent: "enviado", opened: "WhatsApp abierto, sin confirmar", failed: "no se envió" };
/** A prospecting send by its step (0 a conversation message, 1 to 3 the sequence). */
const STEP_TEXT = ["Mensaje de conversación enviado", "Primer mensaje enviado", "Seguimiento enviado", "Último mensaje enviado"];

/**
 * The latest thing that happened with an agency, for the extension to decide:
 * a Follow-up execution, a prospecting send (Adquisición, Chapa) or what the
 * agency itself did (a visit, a reply, its account). Without any of those,
 * when it entered the list.
 */
export function lastAction(
  agency: { lastActivity: { at: string; text: string } | null; createdAt: string },
  account: { created_at: string } | undefined,
  addedByHand: boolean,
  versions: Pick<FollowupVersion, "id" | "version" | "stage">[],
  executions: Pick<FollowupExecution, "version_id" | "status" | "reason" | "updated_at">[],
  attempts: { status: string; sent_at: string | null; step: number }[],
): { text: string; at: string } {
  const facts: { text: string; at: string }[] = [];
  for (const e of executions) {
    const v = versions.find((x) => x.id === e.version_id);
    const what = v ? `Follow-up «${stageInfo(v.stage).title}» V${v.version}` : "Follow-up";
    facts.push({ text: `${what}: ${EXEC_TEXT[e.status]}${e.status === "failed" && e.reason ? ` (${e.reason})` : ""}`, at: e.updated_at });
  }
  for (const t of attempts) if (t.status === "sent" && t.sent_at) facts.push({ text: STEP_TEXT[t.step] ?? "Mensaje enviado", at: t.sent_at });
  if (agency.lastActivity) facts.push(agency.lastActivity);
  const latest = facts.sort((a, b) => b.at.localeCompare(a.at))[0];
  if (latest) return latest;
  if (account) return { text: "Cargada en prospección", at: account.created_at };
  return { text: addedByHand ? "Agregada a mano" : "Creada", at: agency.createdAt };
}

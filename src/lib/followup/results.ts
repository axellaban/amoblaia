// Follow-up, Fase 4: qué acción y qué versión mueven inmobiliarias. Puro: lo
// comparten el servidor y los tests.
//
// - Ejecutados: envíos confirmados (una vez por versión e inmobiliaria).
// - Conversión: la inmobiliaria pasó del paso en que estaba al enviarla, dentro
//   de la ventana (7 o 14 días desde el envío; «sin límite»: cuando sea).
// - Atribución al último mensaje: si varios mensajes de la misma etapa
//   precedieron a una misma conversión, cuenta solo el último antes de ella; los
//   otros figuran como asistencia. Una conversión nunca suma dos veces.
// - Muestra chica: menos de `small` ejecutados; no se declara ganadora.

export type ResultExecution = {
  version_id: string;
  agency_id: string;
  stage: string;
  action?: string | null;
  from_step: number;
  status: "opened" | "sent" | "failed";
  sent_at: string | null;
  updated_at: string;
  converted_at?: string | null;
};
export type ResultVersion = { id: string; stage: string; action?: string | null; version: number; status: string };
export const WINDOWS = { "7": 7, "14": 14, todo: null } as const;
export type WindowKey = keyof typeof WINDOWS;
const DAY = 86_400_000;

/** For each sent execution: whether the conversion after it is attributed to it, inside the window. */
export function attribute(executions: ResultExecution[], stepNow: Map<string, number>, windowDays: number | null) {
  const sent = executions.filter((e) => e.status === "sent" && e.sent_at);
  const credited = new Map<ResultExecution, { hours: number }>();
  const assisted = new Set<ResultExecution>();
  const groups = new Map<string, ResultExecution[]>();
  for (const e of sent) groups.set(`${e.agency_id}:${e.from_step}`, [...(groups.get(`${e.agency_id}:${e.from_step}`) ?? []), e]);
  for (const list of groups.values()) {
    const e0 = list[0];
    if ((stepNow.get(e0.agency_id) ?? -1) <= e0.from_step) continue;
    // Choose the earliest documented conversion, not whichever row happened
    // to be returned first by the database.
    const recorded = list.map((e) => e.converted_at ? Date.parse(e.converted_at) : NaN)
      .filter(Number.isFinite).sort((a, b) => a - b);
    if (!recorded.length) continue;
    const t = recorded[0];
    // The last message sent before the conversion takes it; the earlier ones assisted.
    const before = list.filter((e) => Date.parse(e.sent_at!) <= t).sort((a, b) => Date.parse(b.sent_at!) - Date.parse(a.sent_at!));
    const last = before[0];
    if (!last) continue;
    const hours = (t - Date.parse(last.sent_at!)) / 3_600_000;
    if (windowDays === null || hours <= windowDays * 24) credited.set(last, { hours });
    for (const e of before.slice(1)) assisted.add(e);
  }
  return { credited, assisted };
}

export type VersionResult = {
  versionId: string;
  stage: string;
  action: string;
  version: number;
  status: string;
  eligible: number;
  executed: number;
  conversions: number;
  assisted: number;
  rate: number | null;
  medianHours: number | null;
  failed: number;
  smallSample: boolean;
  best: boolean;
};

export function versionResults(
  versions: ResultVersion[],
  executions: ResultExecution[],
  stepNow: Map<string, number>,
  windowDays: number | null,
  pendingByVersion: Map<string, number>,
  small = 30,
): VersionResult[] {
  const { credited, assisted } = attribute(executions, stepNow, windowDays);
  const rows = versions.map((v) => {
    const mine = executions.filter((e) => e.version_id === v.id);
    const sent = mine.filter((e) => e.status === "sent");
    const conv = sent.filter((e) => credited.has(e));
    const hours = conv.map((e) => credited.get(e)!.hours).sort((a, b) => a - b);
    return {
      versionId: v.id,
      stage: v.stage,
      action: v.action ?? "principal",
      version: v.version,
      status: v.status,
      eligible: sent.length + (pendingByVersion.get(v.id) ?? 0),
      executed: sent.length,
      conversions: conv.length,
      assisted: sent.filter((e) => assisted.has(e)).length,
      rate: sent.length ? conv.length / sent.length : null,
      medianHours: hours.length ? hours[Math.floor((hours.length - 1) / 2)] : null,
      failed: mine.filter((e) => e.status === "failed").length,
      smallSample: sent.length < small,
      best: false,
    };
  });
  // The best of each step, only among versions with enough sample (and only if there are two to compare).
  const steps = new Set(rows.map((r) => `${r.stage}:${r.action}`));
  for (const s of steps) {
    const measured = rows.filter((r) => `${r.stage}:${r.action}` === s && !r.smallSample && r.rate !== null);
    if (measured.length > 1) measured.reduce((a, b) => ((b.rate ?? 0) > (a.rate ?? 0) ? b : a)).best = true;
  }
  return rows;
}

/** Sunday closing date of an instant's Mon–Sun reporting week in Argentina. */
export function weekOf(iso: string) {
  const t = new Date(Date.parse(iso) - 3 * 3_600_000);
  const daysToSunday = (7 - t.getUTCDay()) % 7;
  t.setUTCDate(t.getUTCDate() + daysToSunday);
  return t.toISOString().slice(0, 10);
}
export function lastWeeks(n: number, now = new Date()) {
  const out: string[] = [];
  const start = Date.parse(`${weekOf(now.toISOString())}T00:00:00Z`);
  for (let i = n - 1; i >= 0; i--) out.push(new Date(start - i * 7 * DAY).toISOString().slice(0, 10));
  return out;
}

/** Executions sent and conversions attributed (inside the window), per week. */
export function weekly(executions: ResultExecution[], stepNow: Map<string, number>, windowDays: number | null, weeks = 8, now = new Date()) {
  const { credited } = attribute(executions, stepNow, windowDays);
  return lastWeeks(weeks, now).map((w) => ({
    week: w,
    executed: executions.filter((e) => e.status === "sent" && e.sent_at && weekOf(e.sent_at) === w).length,
    conversions: [...credited.entries()].filter(([e, c]) => weekOf(new Date(Date.parse(e.sent_at!) + c.hours * 3_600_000).toISOString()) === w).length,
  }));
}

export type CohortAgency = { firstContact: string | null; firstReply: string | null; step: number; greetingVersion: number | null };
const RATIOS = [
  { key: "respondio", test: (a: CohortAgency) => Boolean(a.firstReply) },
  { key: "interes", test: (a: CohortAgency) => a.step >= 1 },
  { key: "demo", test: (a: CohortAgency) => a.step >= 3 },
  { key: "cuenta", test: (a: CohortAgency) => a.step >= 6 },
  { key: "suscripcion", test: (a: CohortAgency) => a.step >= 8 },
] as const;
export type CohortRow = { cohort: string; size: number } & Record<(typeof RATIOS)[number]["key"], number>;

/** Cohorts by the week of first contact or first reply: how many of them reached each step since. */
export function cohorts(agencies: CohortAgency[], by: "contacto" | "respuesta", weeks = 8, now = new Date()): CohortRow[] {
  return lastWeeks(weeks, now).map((w) => {
    const own = agencies.filter((a) => {
      const at = by === "contacto" ? a.firstContact : a.firstReply;
      return at && weekOf(at) === w;
    });
    const row = { cohort: w, size: own.length } as CohortRow;
    for (const r of RATIOS) row[r.key] = own.filter(r.test).length;
    return row;
  });
}

/** The same counts by the version of the greeting each agency received. */
export function bySegment(agencies: CohortAgency[]): CohortRow[] {
  const keys = [...new Set(agencies.filter((a) => a.firstContact).map((a) => a.greetingVersion))].sort((a, b) => (a ?? 0) - (b ?? 0));
  return keys.map((k) => {
    const own = agencies.filter((a) => a.firstContact && a.greetingVersion === k);
    const row = { cohort: k === null ? "Antes de Follow-up (Adquisición)" : `Saludo V${k}`, size: own.length } as CohortRow;
    for (const r of RATIOS) row[r.key] = own.filter(r.test).length;
    return row;
  });
}

/** Blocked reasons grouped by their kind (the text before its details). */
export function blockReasons(reasons: string[]) {
  const out = new Map<string, number>();
  for (const r of reasons) {
    const k = r.replace(/[:(].*$/, "").replace(/\.$/, "").replace(/ el \d.*$/, "").replace(/ para$/, "").trim();
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n }));
}

// ── Ejecución de la cola, por día ──────────────────────────────────────────
// Qué estuvo pendiente cada día (la foto diaria de la cola, más lo que se
// ejecutó ese día aunque la foto no lo haya visto), cuánto se ejecutó, quién
// (persona o bot) y cuánto fue exitoso: la ejecución tiene una conversión
// atribuida (la misma atribución de arriba, sin límite de ventana).

export type QueueDayRow = { day: string; agency_id: string; stage: string; action: string; state: "lista" | "bloqueada" | "programada" };
export type DayExecution = ResultExecution & { executed_by?: "humano" | "bot" | null };
export type DayTypeCount = {
  type: string;
  stages: string[];
  pending: number;
  human: number;
  bot: number;
  successHuman: number;
  successBot: number;
  blocked: number;
  unclaimed: number;
  failed: number;
  scheduled: number;
};
/** La misma cuenta por etapa técnica de la cola: para cruzar la ejecución de cada etapa con el paso del embudo al que lleva. */
export type DayStageCount = { stage: string; pending: number; executed: number; success: number };
export type ExecutionDay = { day: string; captured: boolean; types: DayTypeCount[]; stages: DayStageCount[] };

/** The last `n` Buenos Aires dates, oldest first, ending today. */
export function lastDays(n: number, now = new Date()) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(artDay(now.getTime() - i * DAY));
  return out;
}
/** YYYY-MM-DD in Buenos Aires (UTC-3 all year). */
const artDay = (t: number | string) => new Date((typeof t === "number" ? t : Date.parse(t)) - 3 * 3_600_000).toISOString().slice(0, 10);

export function executionDays(
  rows: QueueDayRow[],
  executions: DayExecution[],
  stepNow: Map<string, number>,
  label: (stage: string, action: string) => string,
  n = 35,
  now = new Date(),
): ExecutionDay[] {
  const { credited } = attribute(executions, stepNow, null);
  const days = lastDays(n, now);
  const inRange = new Set(days);
  type Cell = { stage: string; action: string; state?: QueueDayRow["state"]; sent?: DayExecution; failed?: boolean };
  const byDay = new Map<string, Map<string, Cell>>();
  const cell = (day: string, agency: string, stage: string, action: string) => {
    if (!byDay.has(day)) byDay.set(day, new Map());
    const m = byDay.get(day)!;
    const k = `${agency}:${stage}:${action}`;
    if (!m.has(k)) m.set(k, { stage, action });
    return m.get(k)!;
  };
  const captured = new Set<string>();
  for (const r of rows) {
    if (!inRange.has(r.day)) continue;
    captured.add(r.day);
    cell(r.day, r.agency_id, r.stage, r.action).state = r.state;
  }
  for (const e of executions) {
    const action = e.action ?? "principal";
    if (e.status === "sent" && e.sent_at) {
      const d = artDay(e.sent_at);
      if (inRange.has(d)) cell(d, e.agency_id, e.stage, action).sent = e;
    } else if (e.status === "failed") {
      const d = artDay(e.updated_at);
      if (inRange.has(d)) cell(d, e.agency_id, e.stage, action).failed = true;
    }
  }
  return days.map((day) => {
    const types = new Map<string, DayTypeCount>();
    const stages = new Map<string, DayStageCount>();
    for (const c of byDay.get(day)?.values() ?? []) {
      const type = label(c.stage, c.action);
      if (!types.has(type)) types.set(type, { type, stages: [], pending: 0, human: 0, bot: 0, successHuman: 0, successBot: 0, blocked: 0, unclaimed: 0, failed: 0, scheduled: 0 });
      const t = types.get(type)!;
      if (!t.stages.includes(c.stage)) t.stages.push(c.stage);
      // Rescheduled on purpose and not executed that day: shown, but not owed that day.
      if (!c.sent && !c.failed && c.state === "programada") { t.scheduled++; continue; }
      t.pending++;
      if (!stages.has(c.stage)) stages.set(c.stage, { stage: c.stage, pending: 0, executed: 0, success: 0 });
      const st = stages.get(c.stage)!;
      st.pending++;
      if (c.sent) st.executed++;
      if (c.sent) {
        const bot = c.sent.executed_by === "bot";
        if (bot) t.bot++; else t.human++;
        if (credited.has(c.sent)) { st.success++; if (bot) t.successBot++; else t.successHuman++; }
      } else if (c.failed) t.failed++;
      else if (c.state === "bloqueada") t.blocked++;
      else t.unclaimed++;
    }
    return { day, captured: captured.has(day), types: [...types.values()].sort((a, b) => b.pending - a.pending || a.type.localeCompare(b.type)), stages: [...stages.values()] };
  });
}

/** Executions and attributed conversions per week, for each type of action (the trend of each row). */
export function weeklyByType(
  executions: ResultExecution[],
  stepNow: Map<string, number>,
  windowDays: number | null,
  label: (stage: string, action: string) => string,
  weeks = 8,
  now = new Date(),
) {
  const groups = new Map<string, ResultExecution[]>();
  for (const e of executions) {
    const t = label(e.stage, e.action ?? "principal");
    groups.set(t, [...(groups.get(t) ?? []), e]);
  }
  // Attribution runs over every execution (a conversion belongs to the last message, whatever its type).
  const { credited } = attribute(executions, stepNow, windowDays);
  const out: Record<string, { week: string; executed: number; conversions: number }[]> = {};
  for (const [t, list] of groups)
    out[t] = lastWeeks(weeks, now).map((w) => ({
      week: w,
      executed: list.filter((e) => e.status === "sent" && e.sent_at && weekOf(e.sent_at) === w).length,
      conversions: list.filter((e) => credited.has(e) && weekOf(e.sent_at!) === w).length,
    }));
  return out;
}

// ── Cohortes con el embudo de Follow-up ────────────────────────────────────
// Las mismas cohortes (semana de contacto, de primera respuesta, versión del
// saludo), contadas con las etapas comerciales de Follow-up desde Contactado:
// cuántas de la cohorte llegaron a cada etapa (el paso del embudo de hoy).

export type FunnelCohortRow = { cohort: string; size: number; reached: number[] };

/** `thresholds[i]`: the first funnel step of stage i (an agency at that step or later reached it). */
export function funnelCohorts(agencies: CohortAgency[], thresholds: readonly number[], by: "contacto" | "respuesta" | "version", weeks = 8, now = new Date()): FunnelCohortRow[] {
  const count = (own: CohortAgency[]) => thresholds.map((t) => own.filter((a) => a.step >= t).length);
  if (by === "version") {
    const keys = [...new Set(agencies.filter((a) => a.firstContact).map((a) => a.greetingVersion))].sort((a, b) => (a ?? 0) - (b ?? 0));
    return keys.map((k) => {
      const own = agencies.filter((a) => a.firstContact && a.greetingVersion === k);
      return { cohort: k === null ? "Antes de Follow-up (Adquisición)" : `Saludo V${k}`, size: own.length, reached: count(own) };
    });
  }
  return lastWeeks(weeks, now).map((w) => {
    const own = agencies.filter((a) => {
      const at = by === "contacto" ? a.firstContact : a.firstReply;
      return at && weekOf(at) === w;
    });
    return { cohort: w, size: own.length, reached: count(own) };
  });
}

// ── Qué le corresponde a hoy ────────────────────────────────────────────────
// Pendiente de hoy es lo que la cola le asigna a hoy: lo listo, lo que vence o
// vuelve hoy, lo que solo espera el horario de hoy y lo que está trabado por un
// dato a corregir. No es de hoy («programada», no cuenta): lo que espera cupo de
// primer contacto (el tope diario de saludos), lo programado o reprogramado para
// otro día, lo que espera que la persona conteste y lo de un día no hábil.

export type QueueDayInput = { dueAt?: string | null; snoozedUntil?: string | null; blocked?: string | null };
const NOT_TODAY = [/^Sin cupo para primer contacto/i, /^Tope de \d+ contactos nuevos/i, /esper(á|ando) que (conteste|responda)/i, /los domingos no se escribe/i, /^D[ií]a no habilitado/i];
export function queueDayState(q: QueueDayInput, now = new Date()): QueueDayRow["state"] {
  const endOfToday = Date.parse(`${artDay(now.getTime())}T00:00:00-03:00`) + DAY;
  if (q.dueAt && Date.parse(q.dueAt) >= endOfToday) return "programada";
  if (q.snoozedUntil && Date.parse(q.snoozedUntil) >= endOfToday) return "programada";
  const b = q.blocked;
  if (!b) return "lista";
  if (NOT_TODAY.some((r) => r.test(b))) return "programada";
  // Due later today or only outside today's hours: still owed today.
  if (/^(Programada para|Reprogramada|Fuera de horario|Fuera de la ventana)/i.test(b)) return new Date(now.getTime() - 3 * 3_600_000).getUTCDay() === 0 ? "programada" : "lista";
  return "bloqueada";
}

/**
 * A prospect not yet contacted that is stuck on data (no WhatsApp, a possible duplicate, already contacted
 * by the sheet) is never assigned to today: the daily first-contact quota only goes to those that can be
 * contacted. So it is not today's pending either.
 */
export function firstContactState(stage: string, state: QueueDayRow["state"], firstStage = "no-contactado"): QueueDayRow["state"] {
  return stage === firstStage && state === "bloqueada" ? "programada" : state;
}

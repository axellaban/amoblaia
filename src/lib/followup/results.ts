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

/** Friday closing date of an instant's Sat–Fri reporting week in Argentina. */
export function weekOf(iso: string) {
  const t = new Date(Date.parse(iso) - 3 * 3_600_000);
  const daysToFriday = (5 - t.getUTCDay() + 7) % 7;
  t.setUTCDate(t.getUTCDate() + daysToFriday);
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

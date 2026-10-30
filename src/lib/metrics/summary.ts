// Aggregated metrics for the Chapa Labs dashboard (/api/metricas). Pure: the
// route reads the rows and this turns them into totals and daily series, with
// no names, phones or emails. Prospecting reuses the panel's own rules
// (src/lib/prospecting/metrics.ts), so both always show the same numbers.
import { summarize, isHumanReply, type Filters } from "@/lib/prospecting/metrics";
import { artDate, dayEnd, dayStart, isDate } from "@/lib/prospecting/time";
import type { Dataset } from "@/lib/prospecting/types";

export type DemoRow = { status: string; activity_level: number; activity_visitors: number; created_at: string; published_at: string | null };
export type ActivityRow = { kind: string; created_at: string };
export type PaymentRow = { user_id: string; status: string; amount_cents: number; paid_at: string | null; created_at: string };
export type Range = { from?: string | null; to?: string | null };

/** Approved payments, also after a partial refund (same rule as the catalog). */
const PAID = new Set(["approved", "partially_refunded"]);
const ACTIVITY = ["visita", "interaccion", "descarga", "generacion", "panel", "compra"] as const;

const inRange = (iso: string | null | undefined, r: Range) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return (!isDate(r.from) || t >= dayStart(r.from)) && (!isDate(r.to) || t < dayEnd(r.to));
};

/** Adds `n` to `key` of the day of `iso`, creating the row with zeros for `keys`. */
function bump<K extends string>(days: Map<string, Record<K, number>>, iso: string, keys: readonly K[], key: K, n = 1) {
  const date = artDate(iso);
  const row = days.get(date) ?? days.set(date, Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>).get(date)!;
  row[key] += n;
}
const series = <K extends string>(days: Map<string, Record<K, number>>) =>
  [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => ({ date, ...row }));

function funnel(ds: Dataset, f: Filters) {
  const s = summarize(ds, f);
  return {
    prospectados: s.prospected,
    contactados: s.sent,
    mensajes: s.messages,
    respondieron: s.replied.observed,
    interesados: s.interested.observed,
    vinculados: s.linked,
    activados: s.activated.observed,
    clientes: s.customers.observed,
    demos: s.demo,
  };
}

export function prospectingMetrics(ds: Dataset, r: Range) {
  const f: Filters = { from: r.from, to: r.to };
  const total = funnel(ds, f);
  const values = (pick: (a: Dataset["accounts"][number]) => string | null) =>
    [...new Set(ds.accounts.map((a) => pick(a) || ""))].filter(Boolean).sort();
  const porSdr = values((a) => a.sdr).map((sdr) => ({ sdr, ...funnel(ds, { ...f, sdr }) }));
  const channels = [...new Set(ds.attempts.filter((a) => a.status === "sent").map((a) => a.channel))].sort();
  const porCanal = channels.map((canal) => ({ canal, ...funnel(ds, { ...f, channel: canal }) }));

  const keys = ["envios", "nuevos", "respuestas", "interesados", "reuniones"] as const;
  const days = new Map<string, Record<(typeof keys)[number], number>>();
  const firstSend = new Map<string, string>();
  for (const a of ds.attempts) {
    if (a.status !== "sent" || !a.sent_at) continue;
    const prev = firstSend.get(a.account_id);
    if (!prev || Date.parse(a.sent_at) < Date.parse(prev)) firstSend.set(a.account_id, a.sent_at);
    if (inRange(a.sent_at, r)) bump(days, a.sent_at, keys, "envios");
  }
  for (const iso of firstSend.values()) if (inRange(iso, r)) bump(days, iso, keys, "nuevos");
  for (const e of ds.events) {
    if (e.corrected || !inRange(e.occurred_at, r)) continue;
    if (isHumanReply(e)) bump(days, e.occurred_at, keys, "respuestas");
    else if (e.type === "interest") bump(days, e.occurred_at, keys, "interesados");
    else if (e.type === "meeting") bump(days, e.occurred_at, keys, "reuniones");
  }
  const etapas: Record<string, number> = {};
  for (const a of ds.accounts) etapas[a.stage] = (etapas[a.stage] ?? 0) + 1;
  return { ...total, etapas, porSdr, porCanal, diario: series(days) };
}

/** Every commercial demo (prospected or not): how far its visitors and its agency went. */
export function demoMetrics(demos: DemoRow[], activity: ActivityRow[], r: Range) {
  const scope = demos.filter((d) => inRange(d.created_at, r));
  const reached = (level: number) => scope.filter((d) => d.activity_level >= level).length;
  const keys = ["creadas", "publicadas", ...ACTIVITY] as const;
  const days = new Map<string, Record<(typeof keys)[number], number>>();
  for (const d of demos) {
    if (inRange(d.created_at, r)) bump(days, d.created_at, keys, "creadas");
    if (d.published_at && inRange(d.published_at, r)) bump(days, d.published_at, keys, "publicadas");
  }
  for (const a of activity) {
    if (!inRange(a.created_at, r) || !(ACTIVITY as readonly string[]).includes(a.kind)) continue;
    bump(days, a.created_at, keys, a.kind as (typeof ACTIVITY)[number]);
  }
  return {
    creadas: scope.length,
    publicadas: scope.filter((d) => d.status === "published").length,
    ingresaron: reached(1),
    interactuaron: reached(2),
    generaron: reached(3),
    panel: reached(4),
    suscribieron: reached(5),
    visitantes: scope.reduce((n, d) => n + d.activity_visitors, 0),
    diario: series(days),
  };
}

/** Approved payments in the range; a subscriber is a buyer whose first approved payment falls in it. */
export function revenueMetrics(payments: PaymentRow[], r: Range) {
  const paid = payments.filter((p) => PAID.has(p.status)).map((p) => ({ ...p, at: p.paid_at ?? p.created_at }));
  const first = new Map<string, string>();
  for (const p of paid) {
    const prev = first.get(p.user_id);
    if (!prev || Date.parse(p.at) < Date.parse(prev)) first.set(p.user_id, p.at);
  }
  const keys = ["pagos", "ingresos", "nuevos"] as const;
  const days = new Map<string, Record<(typeof keys)[number], number>>();
  let pagos = 0;
  let cents = 0;
  for (const p of paid) {
    if (!inRange(p.at, r)) continue;
    pagos++;
    cents += p.amount_cents;
    bump(days, p.at, keys, "pagos");
    bump(days, p.at, keys, "ingresos", p.amount_cents / 100);
  }
  let nuevos = 0;
  for (const at of first.values())
    if (inRange(at, r)) {
      nuevos++;
      bump(days, at, keys, "nuevos");
    }
  return { moneda: "ARS", pagos, ingresos: cents / 100, nuevos, clientes: first.size, diario: series(days) };
}

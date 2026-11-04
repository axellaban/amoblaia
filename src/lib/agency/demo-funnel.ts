// The demos funnel of the team's «Inmobiliarias» panel: seven steps, from a
// demo created to a subscription, counted per demo and cumulative (a demo
// that reached a step counts in every step before it). Pure: shared with the
// browser and tested on its own.

export const FUNNEL_STEPS = [
  "Demos creadas",
  "Enviadas",
  "Con visita",
  "Con interacción",
  "Cuenta creada",
  "Cuenta con interacción",
  "Suscripciones",
] as const;
/** One demo's step, in the list's «Demo» column. */
export const STEP_LABEL = ["Creada", "Enviada", "Con visita", "Con interacción", "Cuenta creada", "Cuenta activa", "Suscripta"] as const;
/** 0 created … 6 subscribed: the index in FUNNEL_STEPS. */
export type FunnelStep = number;

export type DemoFunnelFacts = {
  sentAt: string | null;
  /** The demo's activity: 1 visit, 2 interaction or download, 3 generated an image, 4 own panel, 5 subscribed. */
  activityLevel: number;
  /** Its agency has its habita account. */
  hasOwner: boolean;
  /** That account did something in its panel after creating it (a property, an import or an image). */
  ownerActive: boolean;
  /** That account has an active subscription. */
  subscribed: boolean;
};

/** The highest step a demo reached. A later fact always wins, like the commercial stage. */
export function funnelStep(f: DemoFunnelFacts): FunnelStep {
  const level = Math.max(0, f.activityLevel || 0);
  if (f.subscribed || level >= 5) return 6;
  if (f.hasOwner && f.ownerActive) return 5;
  if (f.hasOwner || level >= 4) return 4;
  if (level >= 2) return 3;
  if (level >= 1) return 2;
  if (f.sentAt) return 1;
  return 0;
}

/** How many demos reached each step, and each step's share of the one before (null without a base). */
export function funnelCounts(steps: FunnelStep[]) {
  const counts = FUNNEL_STEPS.map((_, i) => steps.filter((s) => s >= i).length);
  return counts.map((count, i) => ({
    label: FUNNEL_STEPS[i],
    count,
    ofPrevious: i === 0 ? null : counts[i - 1] ? Math.round((count / counts[i - 1]) * 100) : null,
    ofFirst: counts[0] ? count / counts[0] : 0,
  }));
}

/** Test agencies stay out of the funnel: their names start with «QA» (QA Habita, QA_Habita). */
export const isTestAgency = (name: string) => /^qa(?![a-záéíóúñ])/i.test(name.trim());

/** The period presets of the funnel's date filter, by the demo's creation date. */
export const PERIODS = [
  { key: "hoy", label: "Hoy" },
  { key: "7", label: "7 días" },
  { key: "30", label: "30 días" },
  { key: "mes", label: "Este mes" },
  { key: "todo", label: "Todo" },
] as const;

export type Period = { key: string; from: string | null; to: string | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const valid = (v: string) => DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
/** YYYY-MM-DD of a moment in Argentina (the team's day). */
export const argDay = (ms: number) => new Date(ms - 3 * 3600000).toISOString().slice(0, 10);

/**
 * The period from the URL: `desde`/`hasta` (YYYY-MM-DD) win over a preset;
 * no parameter means everything. Days are Argentina days, both ends included.
 */
export function parsePeriod(p: { periodo?: string; desde?: string; hasta?: string }, now = Date.now()): Period {
  const from = p.desde && valid(p.desde) ? p.desde : null;
  const to = p.hasta && valid(p.hasta) ? p.hasta : null;
  if (from || to) return { key: "rango", from, to: to && from && to < from ? from : to };
  const today = argDay(now);
  if (p.periodo === "hoy") return { key: "hoy", from: today, to: today };
  if (p.periodo === "7" || p.periodo === "30") return { key: p.periodo, from: argDay(now - (Number(p.periodo) - 1) * 86400000), to: today };
  if (p.periodo === "mes") return { key: "mes", from: `${today.slice(0, 8)}01`, to: today };
  return { key: "todo", from: null, to: null };
}

/** Whether a demo created at `iso` falls in the period. */
export function inPeriod(iso: string, p: Period) {
  const day = argDay(new Date(iso).getTime());
  return (!p.from || day >= p.from) && (!p.to || day <= p.to);
}

/** «28/10» for the list: the day a demo was created, in Argentina. */
export const shortDay = (iso: string) => {
  const d = argDay(new Date(iso).getTime());
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
};

/** An agency's demos created in the period: how many, the highest step reached and the latest creation. */
export function demosInPeriod(demos: { createdAt: string; step: FunnelStep }[], p: Period) {
  const list = demos.filter((d) => inPeriod(d.createdAt, p));
  return {
    count: list.length,
    step: list.length ? Math.max(...list.map((d) => d.step)) : null,
    latest: list.map((d) => d.createdAt).sort().at(-1) ?? null,
  };
}

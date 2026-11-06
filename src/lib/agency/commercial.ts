// Where each agency stands commercially, for the team's «Inmobiliarias»
// panel: one funnel of six stages, derived only from facts in the database
// (prospecting, demos sent and their activity, the account and its
// subscription). Pure: shared with the browser and tested on its own.

import type { Stage as ProspectStage } from "@/lib/prospecting/types";

export const COMMERCIAL_STAGES = ["prospect", "contacted", "demo_sent", "interacted", "panel", "client"] as const;
export type CommercialStage = (typeof COMMERCIAL_STAGES)[number];

/** The funnel's step names (the detail's bar). */
export const STAGE_STEP: Record<CommercialStage, string> = {
  prospect: "Prospecto",
  contacted: "Contactada",
  demo_sent: "Demo enviada",
  interacted: "Interactuó",
  panel: "Con panel",
  client: "Cliente",
};

/** The list's filter tabs, one per stage. */
export const STAGE_TAB: Record<CommercialStage, string> = {
  prospect: "Prospectos",
  contacted: "Contactadas",
  demo_sent: "Demo enviada",
  interacted: "Interactuaron",
  panel: "Con panel",
  client: "Clientes",
};

/** The stage in a URL (?etapa=), in Spanish like the rest of the team's addresses. */
export const STAGE_PARAM: Record<CommercialStage, string> = {
  prospect: "prospectos",
  contacted: "contactadas",
  demo_sent: "demo-enviada",
  interacted: "interactuaron",
  panel: "con-panel",
  client: "clientes",
};
export const stageFromParam = (v: string | null | undefined): CommercialStage | null =>
  (Object.keys(STAGE_PARAM) as CommercialStage[]).find((k) => STAGE_PARAM[k] === v) ?? null;

/** Prospecting stages that mean someone of the team already reached out. */
const CONTACTED: readonly ProspectStage[] = ["sent", "conversation", "interested", "activated", "customer", "lost"];

/** A score at or above this is a «lead caliente» (same threshold as the lead classes). */
export const HOT_SCORE = 60;

export type CommercialFacts = {
  /** Its prospecting account's stage; null when it never went through Adquisición. */
  prospectStage: ProspectStage | null;
  /** Some demo was sent (on WhatsApp from the panel or marked by hand). */
  demoSent: boolean;
  /** The highest activity step of its demos (1 visit … 4 own panel, 5 subscribed). */
  activityLevel: number;
  /** Lead score from external visitors; null: nobody outside the team yet. */
  score: number | null;
  /** It has its habita account. */
  hasOwner: boolean;
  /** Its owner has an active subscription. */
  subscribed: boolean;
};

/**
 * The stage reached, the highest that the facts prove. A later fact always
 * wins: an agency that created its account is «Con panel» even if its demo
 * was never marked as sent.
 */
export function commercialStage(f: CommercialFacts): CommercialStage {
  if (f.subscribed || f.activityLevel >= 5 || f.prospectStage === "customer") return "client";
  if (f.hasOwner) return "panel";
  if (f.activityLevel >= 1 || f.score !== null) return "interacted";
  if (f.demoSent) return "demo_sent";
  if (f.prospectStage && CONTACTED.includes(f.prospectStage)) return "contacted";
  return "prospect";
}

export const stageIndex = (s: CommercialStage) => COMMERCIAL_STAGES.indexOf(s);

export type NextAction = {
  text: string;
  /** What the button does: create a property, send a demo, open its WhatsApp, or see its panel. */
  kind: "new_property" | "publish" | "send_demo" | "whatsapp" | "support";
  cta: string;
};

/**
 * One fixed recommendation per stage (and whether it already has a demo to
 * send). Deliberately simple: the team reads why, and decides.
 */
export function nextAction(stage: CommercialStage, demos: { total: number; published: number }): NextAction {
  switch (stage) {
    case "prospect":
    case "contacted":
      if (!demos.total) return { text: "Crear su primera demo con una de sus propiedades.", kind: "new_property", cta: "Nueva propiedad" };
      if (!demos.published) return { text: "Terminar y publicar su demo para poder enviarla.", kind: "publish", cta: "Ver propiedades" };
      return { text: "Enviarle la demo por WhatsApp.", kind: "send_demo", cta: "Enviar demo" };
    case "demo_sent":
      return { text: "Hacer seguimiento: todavía no abrió la demo.", kind: "whatsapp", cta: "Contactar por WhatsApp" };
    case "interacted":
      return { text: "Contactar para impulsar la creación de su panel.", kind: "whatsapp", cta: "Contactar por WhatsApp" };
    case "panel":
      return { text: "Acompañar su primera propiedad y ofrecerle un plan.", kind: "whatsapp", cta: "Contactar por WhatsApp" };
    case "client":
      return { text: "Cliente activo: revisar que siga publicando propiedades.", kind: "support", cta: "Ver como cliente" };
  }
}

export type ActivityFact = { at: string; text: string };

/** The most recent of the known facts (ties keep the first given), or null. */
export function lastActivity(facts: (ActivityFact | null | undefined)[]): ActivityFact | null {
  let best: ActivityFact | null = null;
  for (const f of facts) if (f && (!best || f.at > best.at)) best = f;
  return best;
}

/** «Hace 2 horas», «Ayer», «Hace 5 días»: how long ago, for the team's lists. */
export function agoText(iso: string, now = Date.now()) {
  const ms = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Recién";
  if (min < 60) return `Hace ${min} ${min === 1 ? "minuto" : "minutos"}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Hace ${h} ${h === 1 ? "hora" : "horas"}`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Ayer";
  if (d < 30) return `Hace ${d} días`;
  const m = Math.floor(d / 30);
  if (m < 12) return `Hace ${m} ${m === 1 ? "mes" : "meses"}`;
  return new Date(iso).toLocaleDateString("es-AR");
}

/** The account column: active subscription, registered, or none yet. */
export type AccountState = "active" | "registered" | "none";
export const ACCOUNT_LABEL: Record<AccountState, string> = { active: "Activa", registered: "Registrada", none: "Sin cuenta" };
export const accountState = (a: { hasOwner: boolean; subscribed: boolean }): AccountState =>
  a.subscribed ? "active" : a.hasOwner ? "registered" : "none";

/** One row of the list, as the server computes it. */
export type CommercialRow = {
  id: string;
  name: string;
  coverPhotoId: string | null;
  stage: CommercialStage;
  hasOwner: boolean;
  subscribed: boolean;
  prospect: boolean;
  properties: number;
  published: number;
  score: number | null;
  lastActivity: ActivityFact | null;
  createdAt: string;
  /** A test agency (QA): out of the demos funnel. */
  test: boolean;
  /** Prospecting: its step (0 contacted, 1 interested; demo-funnel.ts), when it was first contacted and whether the account is lost. Absent: never contacted. */
  prospectFunnel?: { step: number; at: string; lost?: boolean; replied?: boolean } | null;
  /** Its demos: when each was created and the funnel step it reached (demo-funnel.ts). */
  demos: { createdAt: string; step: number; id?: string; sent?: boolean }[];
  /** Its contact WhatsApp, as loaded on the agency (null when unknown). */
  whatsapp?: string | null;
  /** Its latest published demo, whose agency link the list copies (null without one). */
  shareDemo?: { id: string; token: string } | null;
};

export type ListFilters = {
  stage: CommercialStage | null;
  q: string;
  account: AccountState | null;
  minScore: number | null;
  /** Only agencies with activity in the last N days. */
  days: number | null;
};

/** The list's order: the newest agencies first by default; lead score or latest activity, either way, from the column headers. */
export type ListSort = { by: "creada" | "score" | "actividad"; dir: "desc" | "asc" };
export const DEFAULT_SORT: ListSort = { by: "creada", dir: "desc" };

/** The order from the URL (`orden=score`, `orden=actividad-asc`…); anything else is the default. */
export function sortFromParam(v: string): ListSort {
  const [by, dir] = v.split("-");
  if (by !== "score" && by !== "actividad" && by !== "creada") return DEFAULT_SORT;
  return { by, dir: dir === "asc" ? "asc" : "desc" };
}
/** The URL value of an order: empty for the default. */
export const sortParam = (s: ListSort) => (s.by === DEFAULT_SORT.by && s.dir === DEFAULT_SORT.dir ? "" : s.dir === "desc" ? s.by : `${s.by}-${s.dir}`);

/** Sorts a copy of the rows. Rows without a score or activity go last either way; ties by name. */
export function sortRows<T extends CommercialRow>(rows: T[], s: ListSort): T[] {
  const key = (r: CommercialRow): number | string | null =>
    s.by === "score" ? r.score : s.by === "actividad" ? (r.lastActivity?.at ?? null) : r.createdAt;
  const sign = s.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null || kb === null) return ka === kb ? a.name.localeCompare(b.name) : ka === null ? 1 : -1;
    const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
    return c * sign || a.name.localeCompare(b.name);
  });
}

/** The list after its filters, most recent activity first. */
export function filterRows(rows: CommercialRow[], f: ListFilters, now = Date.now()) {
  const q = f.q.trim().toLowerCase();
  const since = f.days ? now - f.days * 86400000 : null;
  return rows
    .filter(
      (r) =>
        (!f.stage || r.stage === f.stage) &&
        (!q || r.name.toLowerCase().includes(q)) &&
        (!f.account || accountState(r) === f.account) &&
        (f.minScore === null || (r.score ?? -1) >= f.minScore) &&
        (since === null || (r.lastActivity !== null && new Date(r.lastActivity.at).getTime() >= since)),
    )
    .sort((a, b) => (b.lastActivity?.at ?? b.createdAt).localeCompare(a.lastActivity?.at ?? a.createdAt) || a.name.localeCompare(b.name));
}

/** The cards above the list and the count of each tab. */
export function listTotals(rows: CommercialRow[]) {
  const byStage = Object.fromEntries(COMMERCIAL_STAGES.map((s) => [s, 0])) as Record<CommercialStage, number>;
  for (const r of rows) byStage[r.stage] += 1;
  return {
    total: rows.length,
    hot: rows.filter((r) => (r.score ?? 0) >= HOT_SCORE).length,
    withAccount: rows.filter((r) => r.hasOwner).length,
    paying: rows.filter((r) => r.subscribed).length,
    byStage,
  };
}

/**
 * Lead Engagement Score (lead_score_v1): pure, deterministic and explainable.
 * Events are the source of truth; the same events, in any order and with
 * any repetition, always give the same result. No I/O here: the server,
 * the panel, the tests and the backfill script all call these functions.
 * See docs/LEAD_SCORE.md for the rules in words.
 */
import {
  AGENCY_LINKS,
  BUYER_LINKS,
  CLASSES,
  FEATURE_LABELS,
  FEATURES,
  LEAD_EVENTS,
  LEAD_SCORE_VERSION,
  LEAD_TIME_ZONE,
  WEIGHTS,
  type DataQuality,
  type EventSource,
  type Feature,
  type Identity,
  type LeadClassKey,
  type LeadEventName,
  type VisitorType,
} from "./config.ts";

/** One normalized event, as stored in lead_events. */
export type LeadEvent = {
  event_id: string;
  event_name: LeadEventName;
  occurred_at: string;
  demo_id: string;
  agency_id: string | null;
  visitor_id: string;
  session_id?: string | null;
  ph_device_id?: string | null;
  view_id?: string | null;
  style_id?: string | null;
  photo_id?: string | null;
  generation_id?: string | null;
  property_id?: string | null;
  /** demo_active_time: active milliseconds (cumulative for its event_id). */
  value?: number | null;
  source: EventSource;
  visitor_type?: VisitorType | null;
  is_internal: boolean;
  internal_reason?: string | null;
  identity: Identity;
  quality: DataQuality;
  link_type?: string | null;
};

export type CommercialFacts = { agencyCta: boolean; pricing: boolean; signup: boolean; contact: boolean };
export type ActivationFacts = {
  generationStarted: boolean;
  generationsCompleted: number;
  importStarted: boolean;
  importCompleted: boolean;
  accountCreated: boolean;
};

/** What a visitor did on a demo, already deduplicated: the input of the score. */
export type VisitorFacts = {
  styles: string[];
  photos: string[];
  comparison: boolean;
  activeMs: number;
  features: Feature[];
  commercial: CommercialFacts;
  activation: ActivationFacts;
  days: string[];
};

export type Breakdown = {
  visual: number;
  depth: number;
  commercial: number;
  activation: number;
  recurrence: number;
  raw: number;
  score: number;
  /** True when the 39 cap (no commercial nor activation signal) lowered the score. */
  capped: boolean;
};

export type VisitorScore = {
  demo_id: string;
  agency_id: string | null;
  visitor_id: string;
  /** Other ids merged into this visitor (the PostHog device of the same browser). */
  aliases: string[];
  score: number;
  classification: LeadClassKey;
  score_version: typeof LEAD_SCORE_VERSION;
  breakdown: Breakdown;
  facts: VisitorFacts;
  explanation: string;
  signals: string[];
  first_event_at: string;
  last_event_at: string;
  last_qualifying_event_at: string | null;
  attribution_confidence: Identity;
  visitor_type: VisitorType;
  is_internal: boolean;
  internal_reasons: string[];
  score_data_quality: DataQuality;
  sessions: string[];
  events: number;
};

const KNOWN = new Set<string>(LEAD_EVENTS);
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Calendar day (YYYY-MM-DD) of an instant in Buenos Aires. */
export function dayOf(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: LEAD_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * One row per event_id. A repeated delivery (retry, beacon and fetch, a
 * second backfill run) is the same event. Active time keeps the largest
 * cumulative value of its id, so a later report of the same page view
 * replaces, never adds. The choice never depends on the input order.
 */
export function dedupeEvents(events: LeadEvent[]): LeadEvent[] {
  const out = new Map<string, LeadEvent>();
  for (const e of events) {
    if (!e || !KNOWN.has(e.event_name) || !e.event_id) continue;
    const prev = out.get(e.event_id);
    if (!prev) {
      out.set(e.event_id, e);
      continue;
    }
    if (e.event_name === "demo_active_time") {
      const a = prev.value ?? 0;
      const b = e.value ?? 0;
      if (b > a || (b === a && byText(e.occurred_at, prev.occurred_at) > 0)) out.set(e.event_id, e);
    } else if (byText(e.occurred_at, prev.occurred_at) < 0) out.set(e.event_id, e);
  }
  return [...out.values()].sort((a, b) => byText(a.occurred_at, b.occurred_at) || byText(a.event_id, b.event_id));
}

/**
 * The visitor an event belongs to. Historical events (backfill) are keyed by
 * the PostHog device ("ph:<device>"); new events carry both the browser's
 * own id and that device, so both histories of one browser merge into the
 * browser's id. With two candidates the smallest id wins (deterministic).
 */
export function visitorResolver(events: LeadEvent[]) {
  const alias = new Map<string, string>();
  for (const e of events) {
    if (!e.ph_device_id || e.visitor_id.startsWith("ph:")) continue;
    const key = `ph:${e.ph_device_id}`;
    const prev = alias.get(key);
    if (!prev || byText(e.visitor_id, prev) < 0) alias.set(key, e.visitor_id);
  }
  return (visitor: string) => alias.get(visitor) ?? visitor;
}

/** Deduplicated facts of one visitor's events (all of the same demo). */
export function factsOf(events: LeadEvent[]): VisitorFacts {
  const styles = new Set<string>();
  const photos = new Set<string>();
  const days = new Set<string>();
  const completed = new Set<string>();
  const active = new Map<string, number>();
  let comparison = false;
  const commercial: CommercialFacts = { agencyCta: false, pricing: false, signup: false, contact: false };
  const activation: ActivationFacts = { generationStarted: false, generationsCompleted: 0, importStarted: false, importCompleted: false, accountCreated: false };
  for (const e of dedupeEvents(events)) {
    const day = dayOf(e.occurred_at);
    if (day) days.add(day);
    switch (e.event_name) {
      case "demo_style_selected":
        // Without its style id a selection cannot be told apart from another: it does not count.
        if (e.style_id && e.style_id !== "original") styles.add(e.style_id);
        break;
      case "demo_photo_selected":
        if (e.photo_id) photos.add(e.photo_id);
        break;
      case "demo_comparison_used":
        comparison = true;
        break;
      case "demo_active_time":
        active.set(e.event_id, Math.max(active.get(e.event_id) ?? 0, Math.max(0, Number(e.value) || 0)));
        break;
      case "demo_agency_cta_clicked":
        commercial.agencyCta = true;
        break;
      case "demo_pricing_viewed":
        commercial.pricing = true;
        break;
      case "demo_signup_started":
        commercial.signup = true;
        break;
      case "demo_contact_requested":
        commercial.contact = true;
        break;
      case "demo_generation_started":
        activation.generationStarted = true;
        break;
      case "demo_generation_completed":
        // One per generation: the same result reported twice is one.
        completed.add(e.generation_id || e.event_id);
        break;
      case "demo_property_import_started":
        activation.importStarted = true;
        break;
      case "demo_property_import_completed":
        activation.importCompleted = true;
        break;
      case "demo_account_created":
        activation.accountCreated = true;
        break;
      default:
        break;
    }
  }
  activation.generationsCompleted = completed.size;
  const facts = {
    styles: [...styles].sort(byText),
    photos: [...photos].sort(byText),
    comparison,
    activeMs: [...active.values()].reduce((s, v) => s + v, 0),
    commercial,
    activation,
    days: [...days].sort(byText),
  };
  const used: Record<Feature, boolean> = {
    style_selection: facts.styles.length > 0,
    photo_navigation: facts.photos.length > 0,
    comparison,
    generation: activation.generationStarted || activation.generationsCompleted > 0,
    commercial: commercial.agencyCta || commercial.pricing || commercial.signup || commercial.contact,
  };
  return { ...facts, features: FEATURES.filter((f) => used[f]) };
}

/** The five dimensions, each within its maximum, and the final 0–100 score. */
export function scoreFacts(f: VisitorFacts): Breakdown {
  const W = WEIGHTS;
  const visual = clamp(
    Math.min(W.visual.stylesMax, f.styles.length * W.visual.perStyle) +
      Math.min(W.visual.photosMax, f.photos.length * W.visual.perPhoto) +
      (f.comparison ? W.visual.comparison : 0),
    W.visual.max,
  );
  const seconds = f.activeMs / 1000;
  const depth = clamp(
    W.depth.activeSteps.reduce((s, [at, pts]) => s + (seconds >= at ? pts : 0), 0) +
      (f.features.length >= W.depth.featuresMin ? W.depth.features : 0),
    W.depth.max,
  );
  const c = f.commercial;
  const commercial = clamp(
    (c.agencyCta ? W.commercial.agencyCta : 0) +
      (c.pricing ? W.commercial.pricing : 0) +
      (c.signup ? W.commercial.signup : 0) +
      (c.contact ? W.commercial.contact : 0),
    W.commercial.max,
  );
  const a = f.activation;
  const activation = clamp(
    (a.generationStarted ? W.activation.generationStarted : 0) +
      (a.generationsCompleted > 0 ? W.activation.generationCompleted : 0) +
      (a.importStarted ? W.activation.importStarted : 0) +
      (a.importCompleted || a.accountCreated ? W.activation.importCompletedOrAccount : 0),
    W.activation.max,
  );
  const recurrence = clamp(
    (f.days.length >= 2 ? W.recurrence.secondDay : 0) + (f.days.length >= 3 ? W.recurrence.thirdDay : 0),
    W.recurrence.max,
  );
  const raw = visual + depth + commercial + activation + recurrence;
  const ceiling = commercial === 0 && activation === 0 ? W.noIntentCap : 100;
  const score = clamp(Math.min(raw, ceiling), 100);
  return { visual, depth, commercial, activation, recurrence, raw, score, capped: raw > ceiling };
}

export function classify(score: number) {
  const s = clamp(score, 100);
  const c = CLASSES.find((k) => s >= k.min) ?? CLASSES[CLASSES.length - 1];
  return { key: c.key as LeadClassKey, label: c.label as string };
}
export const classLabel = (key: string) => CLASSES.find((c) => c.key === key)?.label ?? "Sin datos";

/** The observed signals, strongest first (their weight decides the order). */
export function signalsOf(f: VisitorFacts): string[] {
  const out: [number, string][] = [];
  const W = WEIGHTS;
  if (f.commercial.contact) out.push([W.commercial.contact, "Solicitó contacto"]);
  if (f.activation.importCompleted) out.push([W.activation.importCompletedOrAccount, "Completó una importación"]);
  if (f.activation.accountCreated) out.push([W.activation.importCompletedOrAccount - 0.1, "Creó su cuenta"]);
  if (f.commercial.agencyCta) out.push([W.commercial.agencyCta, "Clic en CTA para inmobiliarias"]);
  if (f.activation.generationsCompleted > 0) out.push([W.activation.generationCompleted, "Generó una imagen"]);
  if (f.commercial.pricing) out.push([W.commercial.pricing, "Consultó precios"]);
  if (f.commercial.signup) out.push([W.commercial.signup, "Inició el registro"]);
  if (f.comparison) out.push([W.visual.comparison, "Usó el slider antes/después"]);
  if (f.activation.importStarted) out.push([W.activation.importStarted, "Inició una importación"]);
  if (f.activation.generationStarted && !f.activation.generationsCompleted) out.push([W.activation.generationStarted, "Pidió una generación"]);
  if (f.styles.length) out.push([f.styles.length * W.visual.perStyle, f.styles.length === 1 ? "Eligió un estilo" : `Eligió ${f.styles.length} estilos`]);
  if (f.photos.length) out.push([f.photos.length * W.visual.perPhoto, f.photos.length === 1 ? "Exploró una foto" : `Exploró ${f.photos.length} fotos`]);
  if (f.days.length >= 2) out.push([W.recurrence.secondDay, `Volvió en ${f.days.length} días distintos`]);
  return out.sort((a, b) => b[0] - a[0] || byText(a[1], b[1])).map(([, s]) => s);
}

const list = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
const minutes = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
};

/** A sentence built only from the facts: nothing is inferred. */
export function explain(f: VisitorFacts, b: Breakdown, who = "un visitante externo") {
  const did: string[] = [];
  if (f.commercial.contact) did.push("solicitó contacto");
  if (f.commercial.agencyCta) did.push("hizo clic en un CTA para inmobiliarias");
  if (f.commercial.pricing) did.push("consultó precios");
  if (f.commercial.signup) did.push("empezó el registro");
  if (f.activation.accountCreated) did.push("creó su cuenta");
  if (f.activation.importCompleted) did.push("completó una importación");
  else if (f.activation.importStarted) did.push("inició una importación");
  if (f.activation.generationsCompleted) did.push(f.activation.generationsCompleted === 1 ? "generó una imagen" : `generó ${f.activation.generationsCompleted} imágenes`);
  else if (f.activation.generationStarted) did.push("pidió una generación");
  if (f.comparison) did.push("usó el slider");
  if (f.styles.length) did.push(f.styles.length === 1 ? "eligió un estilo" : `eligió ${f.styles.length} estilos`);
  if (f.photos.length) did.push(f.photos.length === 1 ? "exploró una foto" : `exploró ${f.photos.length} fotos`);
  if (f.activeMs >= 1000) did.push(`estuvo ${minutes(f.activeMs)} activo`);
  if (f.days.length >= 2) did.push(`regresó en ${f.days.length} días diferentes`);
  if (!did.length) return `Score ${b.score}: ${who} abrió la demo, sin acciones que sumen puntos.`;
  const cap = b.capped ? ` Sin señales comerciales ni de activación, el score se limita a ${WEIGHTS.noIntentCap}.` : "";
  return `Score ${b.score} porque ${who} ${list(did)}.${cap}`;
}

const IDENTITY_RANK: Record<Identity, number> = { anonymous: 0, linked: 1, identified: 2 };
const QUALITY_RANK: Record<DataQuality, number> = { complete: 0, partial: 1, insufficient: 2 };

/**
 * Every visitor's score on one demo. `internalVisitors` are ids the team
 * marked by hand (a browser id or "ph:<device>"); they and any event flagged
 * internal make the whole visitor internal: kept for QA, out of the score
 * the panel ranks by.
 */
export function scoreDemoEvents(
  events: LeadEvent[],
  internalVisitors: ReadonlySet<string> = new Set(),
  demoId?: string,
): VisitorScore[] {
  // Only this demo's events: another demo never moves its score.
  const clean = dedupeEvents(demoId ? events.filter((e) => e.demo_id === demoId) : events);
  const resolve = visitorResolver(clean);
  const groups = new Map<string, LeadEvent[]>();
  for (const e of clean) {
    const v = resolve(e.visitor_id);
    groups.set(v, [...(groups.get(v) ?? []), e]);
  }
  const out: VisitorScore[] = [];
  for (const [visitor, own] of [...groups.entries()].sort((a, b) => byText(a[0], b[0]))) {
    const aliases = [...new Set(own.map((e) => e.visitor_id).filter((v) => v !== visitor))].sort(byText);
    const devices = [...new Set(own.map((e) => (e.ph_device_id ? `ph:${e.ph_device_id}` : "")).filter(Boolean))];
    const ids = [visitor, ...aliases, ...devices];
    const reasons = new Set<string>();
    for (const e of own) if (e.is_internal) reasons.add(e.internal_reason || "internal");
    if (ids.some((id) => internalVisitors.has(id))) reasons.add("manual");
    const internal = reasons.size > 0;
    const facts = factsOf(own);
    const breakdown = scoreFacts(facts);
    const identity = own.reduce<Identity>((best, e) => (IDENTITY_RANK[e.identity] > IDENTITY_RANK[best] ? e.identity : best), "anonymous");
    const links = new Set(own.map((e) => e.link_type).filter(Boolean) as string[]);
    const visitorType: VisitorType = internal
      ? "internal"
      : identity === "identified" || [...links].some((l) => AGENCY_LINKS.includes(l))
        ? "agency"
        : [...links].some((l) => BUYER_LINKS.includes(l))
          ? "buyer"
          : "unknown";
    const qualities = new Set(own.map((e) => e.quality));
    const quality: DataQuality =
      qualities.size === 1 && qualities.has("insufficient")
        ? "insufficient"
        : [...qualities].some((q) => QUALITY_RANK[q] > 0)
          ? "partial"
          : "complete";
    const qualifying = own.filter((e) => e.event_name !== "demo_opened");
    const first = own[0];
    out.push({
      demo_id: first.demo_id,
      agency_id: own.find((e) => e.agency_id)?.agency_id ?? null,
      visitor_id: visitor,
      aliases,
      score: breakdown.score,
      classification: classify(breakdown.score).key,
      score_version: LEAD_SCORE_VERSION,
      breakdown,
      facts,
      explanation: explain(facts, breakdown, internal ? "un visitante interno" : "un visitante externo"),
      signals: signalsOf(facts),
      first_event_at: first.occurred_at,
      last_event_at: own[own.length - 1].occurred_at,
      last_qualifying_event_at: qualifying.length ? qualifying[qualifying.length - 1].occurred_at : null,
      attribution_confidence: identity,
      visitor_type: visitorType,
      is_internal: internal,
      internal_reasons: [...reasons].sort(byText),
      score_data_quality: quality,
      sessions: [...new Set(own.map((e) => e.session_id).filter(Boolean) as string[])].sort(byText),
      events: own.length,
    });
  }
  return out;
}

/** A visitor score as a lead_visitor_scores row (habita_lead_replace_scores). */
export function scoreRow(s: VisitorScore) {
  return {
    visitor_id: s.visitor_id,
    agency_id: s.agency_id,
    score: s.score,
    classification: s.classification,
    score_version: s.score_version,
    visual_score: s.breakdown.visual,
    depth_score: s.breakdown.depth,
    commercial_score: s.breakdown.commercial,
    activation_score: s.breakdown.activation,
    recurrence_score: s.breakdown.recurrence,
    score_breakdown: { ...s.breakdown, facts: s.facts },
    explanation: s.explanation,
    signals: s.signals,
    aliases: s.aliases,
    sessions: s.sessions,
    events: s.events,
    first_event_at: s.first_event_at,
    last_event_at: s.last_event_at,
    last_qualifying_event_at: s.last_qualifying_event_at,
    attribution_confidence: s.attribution_confidence,
    visitor_type: s.visitor_type,
    is_internal: s.is_internal,
    internal_reasons: s.internal_reasons,
    score_data_quality: s.score_data_quality,
  };
}

export const featureLabel = (f: Feature) => FEATURE_LABELS[f];

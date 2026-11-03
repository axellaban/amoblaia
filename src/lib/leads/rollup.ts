/**
 * Demo and agency views of the visitor scores. v1 never adds scores up:
 * a demo is as hot as its hottest external visitor, an agency as its
 * hottest demo. Internal visitors are counted apart and never rank.
 */
import type { DataQuality, Identity, LeadClassKey } from "./config.ts";
import { classify } from "./score.ts";

/** The stored fields of a visitor score the views need (lead_visitor_scores). */
export type ScoreRow = {
  demo_id: string;
  agency_id: string | null;
  visitor_id: string;
  score: number;
  classification: string;
  commercial_score: number;
  activation_score: number;
  signals: string[];
  explanation: string;
  last_event_at: string;
  attribution_confidence: Identity;
  visitor_type: string;
  is_internal: boolean;
  score_data_quality: DataQuality;
  /** Other ids of the same browser (its PostHog device). */
  aliases?: string[];
};

export type DemoRollup = {
  demo_id: string;
  agency_id: string | null;
  /** null: no external activity (only the team, or nobody). */
  score: number | null;
  classification: LeadClassKey | null;
  external_visitors: number;
  internal_visitors: number;
  engaged_visitors: number;
  commercial_visitors: number;
  last_external_at: string | null;
  top_visitor_id: string | null;
  top_signals: string[];
  explanation: string | null;
  attribution_confidence: Identity | null;
  score_data_quality: DataQuality | null;
  /** Some external visitor came only through a buyer or public link. */
  public_exposure: boolean;
};

export type AgencyRollup = {
  agency_id: string;
  score: number | null;
  classification: LeadClassKey | null;
  top_demo_id: string | null;
  demos: number;
  demos_visited: number;
  external_visitors: number;
  internal_visitors: number;
  last_activity_at: string | null;
  commercial_signals: string[];
  has_commercial_signal: boolean;
  main_signal: string | null;
  explanation: string | null;
  attribution_confidence: Identity | null;
  score_data_quality: DataQuality | null;
  public_exposure: boolean;
  /** External visitors that also opened another agency's demo: worth checking whether they are the team. */
  shared_visitors: number;
};

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
/** Highest score first; ties go to the most recent, then the id, so the choice is stable. */
const better = (a: ScoreRow, b: ScoreRow) =>
  b.score - a.score || (b.last_event_at > a.last_event_at ? 1 : b.last_event_at < a.last_event_at ? -1 : 0) || (a.visitor_id < b.visitor_id ? -1 : 1);
const hasIntent = (r: ScoreRow) => r.commercial_score > 0 || r.activation_score > 0;

export function rollupDemo(demoId: string, agencyId: string | null, rows: ScoreRow[]): DemoRollup {
  const own = rows.filter((r) => r.demo_id === demoId);
  const external = own.filter((r) => !r.is_internal).sort(better);
  const top = external[0] ?? null;
  return {
    demo_id: demoId,
    agency_id: agencyId,
    score: top ? top.score : null,
    classification: top ? classify(top.score).key : null,
    external_visitors: external.length,
    internal_visitors: own.length - external.length,
    engaged_visitors: external.filter((r) => r.score > 0).length,
    commercial_visitors: external.filter((r) => r.commercial_score > 0).length,
    last_external_at: external.reduce<string | null>((m, r) => later(m, r.last_event_at), null),
    top_visitor_id: top?.visitor_id ?? null,
    top_signals: top?.signals.slice(0, 3) ?? [],
    explanation: top?.explanation ?? null,
    attribution_confidence: top?.attribution_confidence ?? null,
    score_data_quality: top?.score_data_quality ?? null,
    public_exposure: external.some((r) => r.visitor_type === "buyer"),
  };
}

/**
 * Visitors seen on demos of more than one agency (external only), matching
 * each browser by its id and its aliases: one browser merged with its PostHog
 * device on one demo and not on another is still the same browser.
 */
export function sharedVisitors(rows: ScoreRow[]) {
  const agencies = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.is_internal || !r.agency_id) continue;
    for (const key of [r.visitor_id, ...(r.aliases ?? [])]) agencies.set(key, (agencies.get(key) ?? new Set()).add(r.agency_id));
  }
  const shared = new Set<string>();
  for (const r of rows) if ([r.visitor_id, ...(r.aliases ?? [])].some((key) => (agencies.get(key)?.size ?? 0) > 1)) shared.add(r.visitor_id);
  return shared;
}

export function rollupAgency(agencyId: string, demoIds: string[], rows: ScoreRow[], shared = sharedVisitors(rows)): AgencyRollup {
  const own = rows.filter((r) => r.agency_id === agencyId && demoIds.includes(r.demo_id));
  const external = own.filter((r) => !r.is_internal).sort(better);
  const top = external[0] ?? null;
  const uniqueExternal = new Set(external.map((r) => r.visitor_id));
  const uniqueInternal = new Set(own.filter((r) => r.is_internal).map((r) => r.visitor_id));
  const signals = [...new Set(external.filter(hasIntent).flatMap((r) => r.signals))];
  return {
    agency_id: agencyId,
    score: top ? top.score : null,
    classification: top ? classify(top.score).key : null,
    top_demo_id: top?.demo_id ?? null,
    demos: demoIds.length,
    demos_visited: new Set(external.map((r) => r.demo_id)).size,
    external_visitors: uniqueExternal.size,
    internal_visitors: uniqueInternal.size,
    last_activity_at: external.reduce<string | null>((m, r) => later(m, r.last_event_at), null),
    commercial_signals: signals,
    has_commercial_signal: external.some((r) => r.commercial_score > 0),
    main_signal: top?.signals[0] ?? null,
    explanation: top?.explanation ?? null,
    attribution_confidence: top?.attribution_confidence ?? null,
    score_data_quality: top?.score_data_quality ?? null,
    public_exposure: external.some((r) => r.visitor_type === "buyer"),
    shared_visitors: [...uniqueExternal].filter((v) => shared.has(v)).length,
  };
}

import { describe, expect, it } from "vitest";
import { LEAD_SCORE_VERSION, WEIGHTS } from "@/lib/leads/config";
import { classify, dayOf, dedupeEvents, factsOf, scoreDemoEvents, scoreFacts, type LeadEvent } from "@/lib/leads/score";
import { rollupAgency, rollupDemo, type ScoreRow } from "@/lib/leads/rollup";

const DEMO = "11111111-1111-4111-8111-111111111111";
const OTHER_DEMO = "22222222-2222-4222-8222-222222222222";
const AGENCY = "33333333-3333-4333-8333-333333333333";
let n = 0;
function ev(event_name: LeadEvent["event_name"], extra: Partial<LeadEvent> = {}): LeadEvent {
  n += 1;
  return {
    event_id: `e-${n}`,
    event_name,
    occurred_at: `2026-10-30T15:${String(n % 60).padStart(2, "0")}:00.000Z`,
    demo_id: DEMO,
    agency_id: AGENCY,
    visitor_id: "visitor-a",
    source: "client",
    is_internal: false,
    identity: "linked",
    quality: "complete",
    link_type: "presentation_invitation",
    ...extra,
  };
}
const scoreOf = (events: LeadEvent[]) => scoreFacts(factsOf(events));
const only = (events: LeadEvent[], internal: Set<string> = new Set()) => {
  const all = scoreDemoEvents(events, internal, DEMO);
  expect(all).toHaveLength(1);
  return all[0];
};
const activeTime = (seconds: number) => ev("demo_active_time", { value: seconds * 1000 });

describe("lead_score_v1: visual interaction", () => {
  it("a visitor without interactions scores 0", () => {
    expect(only([ev("demo_opened")]).score).toBe(0);
  });
  it("one style selected scores 4", () => {
    expect(scoreOf([ev("demo_style_selected", { style_id: "modern" })]).visual).toBe(4);
  });
  it("the same style selected 34 times scores 4", () => {
    const events = Array.from({ length: 34 }, () => ev("demo_style_selected", { style_id: "modern" }));
    expect(scoreOf(events).visual).toBe(4);
    expect(only(events).score).toBe(4);
  });
  it("two distinct styles score 8, and a third adds nothing (max 8)", () => {
    expect(scoreOf([ev("demo_style_selected", { style_id: "modern" }), ev("demo_style_selected", { style_id: "nordic" })]).visual).toBe(8);
    expect(
      scoreOf(["modern", "nordic", "boho"].map((s) => ev("demo_style_selected", { style_id: s }))).visual,
    ).toBe(8);
  });
  it("a selection without style id, or back to the original, does not count", () => {
    expect(scoreOf([ev("demo_style_selected", { style_id: null }), ev("demo_style_selected", { style_id: "original" })]).visual).toBe(0);
  });
  it("three distinct photos score 6, repeated photos once", () => {
    const photos = ["p1", "p2", "p3", "p1", "p2"].map((p) => ev("demo_photo_selected", { photo_id: p }));
    expect(scoreOf(photos).visual).toBe(6);
    expect(scoreOf([...photos, ev("demo_photo_selected", { photo_id: "p4" })]).visual).toBe(6);
  });
  it("the slider used many times scores 6 once", () => {
    expect(scoreOf(Array.from({ length: 9 }, () => ev("demo_comparison_used"))).visual).toBe(6);
  });
  it("the dimension never goes over 20", () => {
    const events = [
      ...["a", "b", "c"].map((s) => ev("demo_style_selected", { style_id: s })),
      ...["p1", "p2", "p3", "p4"].map((p) => ev("demo_photo_selected", { photo_id: p })),
      ev("demo_comparison_used"),
    ];
    expect(scoreOf(events).visual).toBe(WEIGHTS.visual.max);
  });
});

describe("lead_score_v1: depth", () => {
  it("adds 3, 4 and 4 points at 30, 90 and 180 active seconds", () => {
    expect(scoreOf([activeTime(29)]).depth).toBe(0);
    expect(scoreOf([activeTime(30)]).depth).toBe(3);
    expect(scoreOf([activeTime(89)]).depth).toBe(3);
    expect(scoreOf([activeTime(90)]).depth).toBe(7);
    expect(scoreOf([activeTime(180)]).depth).toBe(11);
    expect(scoreOf([activeTime(5000)]).depth).toBe(11);
  });
  it("sums the active time of different page views", () => {
    expect(scoreOf([activeTime(20), activeTime(20)]).depth).toBe(3);
  });
  it("a later report of the same page view replaces it, never adds", () => {
    const first = ev("demo_active_time", { event_id: "view-1:active", value: 20000 });
    const later = { ...first, value: 40000, occurred_at: "2026-10-30T16:00:00.000Z" };
    expect(factsOf([first, later, first]).activeMs).toBe(40000);
    expect(factsOf([later, first]).activeMs).toBe(40000);
  });
  it("two distinct functionalities add 4; the dimension stays within 15", () => {
    const two = [ev("demo_style_selected", { style_id: "modern" }), ev("demo_comparison_used")];
    expect(scoreOf(two).depth).toBe(4);
    expect(scoreOf([...two, activeTime(600)]).depth).toBe(WEIGHTS.depth.max);
  });
});

describe("lead_score_v1: commercial, activation and recurrence", () => {
  it("each commercial action counts once per visitor and demo, capped at 35", () => {
    expect(scoreOf([ev("demo_agency_cta_clicked"), ev("demo_agency_cta_clicked")]).commercial).toBe(12);
    expect(
      scoreOf([ev("demo_agency_cta_clicked"), ev("demo_pricing_viewed"), ev("demo_signup_started"), ev("demo_contact_requested")]).commercial,
    ).toBe(35);
  });
  it("a successful generation counts once; a failed one (no completion) does not", () => {
    const started = ev("demo_generation_started", { source: "server", generation_id: "g1" });
    expect(scoreOf([started]).activation).toBe(5);
    const done = ev("demo_generation_completed", { source: "server", generation_id: "g1" });
    const retry = { ...done, event_id: "retry-of-g1" };
    expect(scoreOf([started, done, retry]).activation).toBe(17);
    expect(factsOf([started, done, retry]).activation.generationsCompleted).toBe(1);
  });
  it("activation is capped at 25", () => {
    const events = [
      ev("demo_generation_started"),
      ev("demo_generation_completed", { generation_id: "g" }),
      ev("demo_property_import_started"),
      ev("demo_property_import_completed"),
      ev("demo_account_created"),
    ];
    expect(scoreOf(events).activation).toBe(25);
  });
  it("counts calendar days in Buenos Aires: 3 points on a second day, 2 more on a third", () => {
    // 02:30 UTC on the 30th is still the 29th in Buenos Aires.
    expect(dayOf("2026-10-30T02:30:00.000Z")).toBe("2026-10-29");
    const sameDay = [ev("demo_opened", { occurred_at: "2026-10-29T13:00:00.000Z" }), ev("demo_opened", { occurred_at: "2026-10-30T02:30:00.000Z" })];
    expect(scoreOf(sameDay).recurrence).toBe(0);
    const two = [...sameDay, ev("demo_opened", { occurred_at: "2026-10-30T13:00:00.000Z" })];
    expect(scoreOf(two).recurrence).toBe(3);
    const three = [...two, ev("demo_opened", { occurred_at: "2026-11-02T13:00:00.000Z" })];
    expect(scoreOf(three).recurrence).toBe(5);
  });
  it("a page reload the same day is not a return", () => {
    expect(scoreOf([ev("demo_opened"), ev("demo_opened"), ev("demo_opened")]).recurrence).toBe(0);
  });
});

describe("lead_score_v1: final score", () => {
  const everything = () => [
    ...["a", "b"].map((s) => ev("demo_style_selected", { style_id: s })),
    ...["p1", "p2", "p3"].map((p) => ev("demo_photo_selected", { photo_id: p })),
    ev("demo_comparison_used"),
    activeTime(400),
    ev("demo_agency_cta_clicked"),
    ev("demo_pricing_viewed"),
    ev("demo_signup_started"),
    ev("demo_contact_requested"),
    ev("demo_generation_started"),
    ev("demo_generation_completed", { generation_id: "g" }),
    ev("demo_account_created"),
    ev("demo_opened", { occurred_at: "2026-11-01T15:00:00.000Z" }),
    ev("demo_opened", { occurred_at: "2026-11-03T15:00:00.000Z" }),
  ];
  it("never goes over 100 nor below 0", () => {
    const b = scoreOf(everything());
    // The five maxima add up to exactly 100.
    expect([b.visual, b.depth, b.commercial, b.activation, b.recurrence]).toEqual([20, 15, 35, 25, 5]);
    expect(b.score).toBe(100);
    expect(scoreFacts({ ...factsOf(everything()), styles: Array.from({ length: 40 }, (_, i) => `s${i}`) }).score).toBe(100);
    expect(scoreOf([]).score).toBe(0);
  });
  it("without commercial interest nor activation, it stops at 39", () => {
    const events = everything().filter(
      (e) => !e.event_name.startsWith("demo_agency") && !["demo_pricing_viewed", "demo_signup_started", "demo_contact_requested"].includes(e.event_name) && !e.event_name.includes("generation") && e.event_name !== "demo_account_created",
    );
    const b = scoreOf(events);
    expect(b.commercial + b.activation).toBe(0);
    expect(b.raw).toBeGreaterThan(39);
    expect(b.score).toBe(39);
    expect(b.capped).toBe(true);
  });
  it("classifies at the boundaries 19/20, 39/40, 59/60 and 79/80", () => {
    expect([19, 20, 39, 40, 59, 60, 79, 80, 0, 100].map((s) => classify(s).label)).toEqual([
      "Muy frío",
      "Frío",
      "Frío",
      "Tibio",
      "Tibio",
      "Caliente",
      "Caliente",
      "Muy caliente",
      "Muy frío",
      "Muy caliente",
    ]);
  });
  it("is versioned and explains itself only with what happened", () => {
    const s = only([ev("demo_pricing_viewed"), ev("demo_comparison_used"), ...["p1", "p2"].map((p) => ev("demo_photo_selected", { photo_id: p }))]);
    expect(s.score_version).toBe(LEAD_SCORE_VERSION);
    expect(s.score).toBe(10 + 6 + 4 + 4);
    expect(s.explanation).toBe("Score 24 porque un visitante externo consultó precios, usó el slider y exploró 2 fotos.");
    expect(s.explanation).not.toMatch(/probabilidad|%/);
  });
});

describe("events: duplicates, order and isolation", () => {
  it("a duplicated event does not add twice", () => {
    const cta = ev("demo_agency_cta_clicked");
    const style = ev("demo_style_selected", { style_id: "modern" });
    expect(dedupeEvents([cta, cta, style, style])).toHaveLength(2);
    expect(only([cta, cta, style, style]).score).toBe(only([cta, style]).score);
  });
  it("events out of order give the same result", () => {
    const events = [
      ev("demo_opened", { occurred_at: "2026-10-28T12:00:00.000Z" }),
      ev("demo_style_selected", { style_id: "modern" }),
      ev("demo_pricing_viewed"),
      ev("demo_opened", { occurred_at: "2026-10-31T12:00:00.000Z" }),
      activeTime(100),
    ];
    const forward = only(events);
    const backward = only([...events].reverse());
    const shuffled = only([events[2], events[4], events[0], events[3], events[1]]);
    expect(backward).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });
  it("an event of another demo or another visitor does not move the score", () => {
    const mine = [ev("demo_style_selected", { style_id: "modern" })];
    const base = only(mine).score;
    const noise = [ev("demo_pricing_viewed", { demo_id: OTHER_DEMO }), ev("demo_agency_cta_clicked", { visitor_id: "visitor-b" })];
    const all = scoreDemoEvents([...mine, ...noise], new Set(), DEMO);
    expect(all.find((s) => s.visitor_id === "visitor-a")!.score).toBe(base);
    expect(all.map((s) => s.visitor_id)).toEqual(["visitor-a", "visitor-b"]);
  });
  it("merges the PostHog history of the same browser into its visitor", () => {
    const old = ev("demo_style_selected", { visitor_id: "ph:device-1", style_id: "modern", source: "backfill", quality: "partial" });
    const fresh = ev("demo_style_selected", { visitor_id: "visitor-a", ph_device_id: "device-1", style_id: "nordic" });
    const s = only([old, fresh]);
    expect(s.visitor_id).toBe("visitor-a");
    expect(s.aliases).toEqual(["ph:device-1"]);
    expect(s.facts.styles).toEqual(["modern", "nordic"]);
    expect(s.score_data_quality).toBe("partial");
  });
});

describe("visitors: internal, external and identity", () => {
  it("an internal event makes the visitor internal; an external one stays external", () => {
    const internal = scoreDemoEvents([ev("demo_pricing_viewed", { visitor_id: "team", is_internal: true, internal_reason: "team_session" })], new Set(), DEMO)[0];
    expect(internal.is_internal).toBe(true);
    expect(internal.visitor_type).toBe("internal");
    expect(internal.internal_reasons).toEqual(["team_session"]);
    const external = only([ev("demo_pricing_viewed")]);
    expect(external.is_internal).toBe(false);
    expect(external.visitor_type).toBe("agency");
  });
  it("marking a visitor (or its device) as internal later changes the recalculation", () => {
    const events = [ev("demo_pricing_viewed", { ph_device_id: "device-9" })];
    expect(only(events).is_internal).toBe(false);
    expect(only(events, new Set(["visitor-a"])).is_internal).toBe(true);
    expect(only(events, new Set(["ph:device-9"])).internal_reasons).toEqual(["manual"]);
  });
  it("an anonymous visitor with the link is linked, never identified as the owner", () => {
    expect(only([ev("demo_opened")]).attribution_confidence).toBe("linked");
    expect(only([ev("demo_opened", { identity: "anonymous", link_type: "buyer" })]).attribution_confidence).toBe("anonymous");
    expect(only([ev("demo_opened", { identity: "anonymous", link_type: "buyer" })]).visitor_type).toBe("buyer");
    expect(only([ev("demo_opened"), ev("demo_account_created", { identity: "identified" })]).attribution_confidence).toBe("identified");
  });
});

describe("demo and agency views", () => {
  const row = (over: Partial<ScoreRow>): ScoreRow => ({
    demo_id: DEMO,
    agency_id: AGENCY,
    visitor_id: "v",
    score: 0,
    classification: "very_cold",
    commercial_score: 0,
    activation_score: 0,
    signals: [],
    explanation: "",
    last_event_at: "2026-10-30T12:00:00.000Z",
    attribution_confidence: "linked",
    visitor_type: "agency",
    is_internal: false,
    score_data_quality: "complete",
    ...over,
  });
  it("a demo is its best external visitor, never the sum (several visitors do not inflate it)", () => {
    const rows = [row({ visitor_id: "a", score: 30 }), row({ visitor_id: "b", score: 25 }), row({ visitor_id: "c", score: 20 })];
    const d = rollupDemo(DEMO, AGENCY, rows);
    expect(d.score).toBe(30);
    expect(d.top_visitor_id).toBe("a");
    expect(d.external_visitors).toBe(3);
  });
  it("only internal visitors means no external activity, not a score", () => {
    const d = rollupDemo(DEMO, AGENCY, [row({ visitor_id: "team", score: 90, is_internal: true })]);
    expect(d.score).toBeNull();
    expect(d.internal_visitors).toBe(1);
  });
  it("an agency takes its best demo and counts a visitor of two demos once", () => {
    const rows = [
      row({ visitor_id: "a", score: 40, commercial_score: 12, signals: ["Clic en CTA para inmobiliarias"] }),
      row({ visitor_id: "a", demo_id: OTHER_DEMO, score: 70, activation_score: 17, signals: ["Generó una imagen"] }),
      row({ visitor_id: "team", demo_id: OTHER_DEMO, score: 99, is_internal: true }),
    ];
    const a = rollupAgency(AGENCY, [DEMO, OTHER_DEMO], rows);
    expect(a.score).toBe(70);
    expect(a.top_demo_id).toBe(OTHER_DEMO);
    expect(a.external_visitors).toBe(1);
    expect(a.internal_visitors).toBe(1);
    expect(a.demos_visited).toBe(2);
    expect(a.commercial_signals.sort()).toEqual(["Clic en CTA para inmobiliarias", "Generó una imagen"]);
  });
  it("flags external visitors who also opened another agency's demo", () => {
    const rows = [row({ visitor_id: "x" }), row({ visitor_id: "x", agency_id: "other-agency", demo_id: OTHER_DEMO })];
    expect(rollupAgency(AGENCY, [DEMO], rows).shared_visitors).toBe(1);
  });
});

describe("shared visitors across agencies", () => {
  it("matches a browser by its aliases too", () => {
    const base = {
      score: 10, classification: "very_cold", commercial_score: 0, activation_score: 0, signals: [], explanation: "",
      last_event_at: "2026-10-30T12:00:00.000Z", attribution_confidence: "linked" as const, visitor_type: "agency", is_internal: false, score_data_quality: "complete" as const,
    };
    const rows: ScoreRow[] = [
      { ...base, demo_id: DEMO, agency_id: AGENCY, visitor_id: "browser-1", aliases: ["ph:device-1"] },
      { ...base, demo_id: OTHER_DEMO, agency_id: "other-agency", visitor_id: "ph:device-1" },
    ];
    expect(rollupAgency(AGENCY, [DEMO], rows).shared_visitors).toBe(1);
    expect(rollupAgency("other-agency", [OTHER_DEMO], rows).shared_visitors).toBe(1);
  });
});

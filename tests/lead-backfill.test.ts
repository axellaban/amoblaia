import { describe, expect, it } from "vitest";
import { internalDevicesOf, mapAll, mapPostHogEvent, stagingEvents, type PostHogRow, type StagingRow } from "@/lib/leads/backfill";
import { dedupeEvents, scoreDemoEvents } from "@/lib/leads/score";

const DEMO = "f4165d33-192f-4ea6-94e1-4a1a2c7b0c5f";
const AGENCY = "8fac7831-e2be-4dbd-bfa3-c8e55a32fae3";
const ctx = (internal: string[] = []) => ({ demos: new Map([[DEMO, AGENCY]]), internalDevices: new Set(internal) });
let n = 0;
const row = (event: string, properties: Record<string, unknown> = {}, over: Partial<PostHogRow> = {}): PostHogRow => ({
  uuid: `01a18e00-0000-7000-8000-${String(++n).padStart(12, "0")}`,
  event,
  timestamp: `2026-10-30T16:${String(n % 60).padStart(2, "0")}:00.000Z`,
  distinct_id: "device-ext",
  properties: { demo_id: DEMO, tracking_version: 2, app_env: "production", demo_link_type: "presentation_invitation", $session_id: "s1", ...properties },
  ...over,
});

describe("backfill: only verified meanings become points", () => {
  it("the 34 demo_style_viewed of O'farrel score nothing (time on screen, not clicks)", () => {
    const rows = Array.from({ length: 34 }, () => row("demo_style_viewed", { style_id: "modern", end_reason: "hidden" }));
    const { events, report } = mapAll([row("demo_vista"), ...rows], ctx());
    expect(report.skipped["ambiguous:demo_style_viewed"]).toBe(34);
    expect(events.map((e) => e.event_name)).toEqual(["demo_opened"]);
    expect(scoreDemoEvents(events, new Set(), DEMO)[0].score).toBe(0);
  });

  it("demo_estilo is a click: counted by distinct style, including the old `estilo` property", () => {
    const rows = [row("demo_estilo", { style_id: "modern" }), row("demo_estilo", { style_id: "modern" }), row("demo_estilo", { estilo: "nordic", tracking_version: 1 })];
    const s = scoreDemoEvents(mapAll(rows, ctx()).events, new Set(), DEMO)[0];
    expect(s.facts.styles).toEqual(["modern", "nordic"]);
    expect(s.score_data_quality).toBe("partial");
  });

  it("a style selection without its style does not count (rule 4)", () => {
    expect(mapPostHogEvent(row("demo_estilo", {}), ctx()).reason).toBe("style_missing");
  });

  it("photo changes count only with the visitor's method and the photo", () => {
    expect(mapPostHogEvent(row("demo_photo_changed", { photo_id: "p2", method: "thumbnail" }), ctx()).event?.event_name).toBe("demo_photo_selected");
    expect(mapPostHogEvent(row("demo_photo_changed", { photo_id: "p2" }), ctx()).reason).toBe("photo_unverified");
  });

  it("a slider gesture that moved nothing is not a use", () => {
    expect(mapPostHogEvent(row("comparison_slider_used", { travel: 0, input: "touch" }), ctx()).reason).toBe("slider_unmoved");
    expect(mapPostHogEvent(row("comparison_slider_used", { travel: 40, input: "touch" }), ctx()).event?.event_name).toBe("demo_comparison_used");
  });

  it("ambiguous or unrelated events never become points", () => {
    for (const e of ["agency_signup_started", "diseno_generado", "foto_subida", "demo_contacto", "demo_generation_completed", "demo_owner_generar", "cta_clicked"])
      expect(mapPostHogEvent(row(e), ctx()).event).toBeNull();
  });

  it("skips events of demos that do not exist", () => {
    expect(mapPostHogEvent(row("demo_vista", { demo_id: "00000000-0000-4000-8000-000000000000" }), ctx()).reason).toBe("no_demo");
  });
});

describe("backfill: internal traffic", () => {
  it("a device the team used at any time is internal for all its events", () => {
    const rows = [row("demo_vista", {}, { distinct_id: "team-phone" }), row("demo_owner_precios", { is_internal: true }, { distinct_id: "team-phone" })];
    const devices = internalDevicesOf(rows);
    expect([...devices]).toEqual(["team-phone"]);
    const { events } = mapAll(rows, ctx([...devices]));
    expect(events.every((e) => e.is_internal)).toBe(true);
    expect(scoreDemoEvents(events, new Set(), DEMO)[0].visitor_type).toBe("internal");
  });
  it("preview and local environments are internal; an external device is not", () => {
    expect(mapPostHogEvent(row("demo_vista", { app_env: "preview" }), ctx()).event?.internal_reason).toBe("non_production");
    expect(mapPostHogEvent(row("demo_vista"), ctx()).event?.is_internal).toBe(false);
  });
});

describe("backfill: generations confirmed by the database", () => {
  const staging = (over: Partial<StagingRow> = {}): StagingRow => ({
    key: "key-1",
    demo_id: DEMO,
    visitor: "habita-visitor-1",
    photo_id: "p1",
    style: "coastal",
    created_at: "2026-10-29T23:00:15.000Z",
    generation_id: "gen-1",
    status: "succeeded",
    result_path: "u/p/gen-1.jpg",
    finished_at: "2026-10-29T23:01:10.000Z",
    ...over,
  });
  it("counts a succeeded generation once and a failed one only as started", () => {
    const done = stagingEvents([staging()], [], ctx());
    expect(done.map((e) => e.event_name)).toEqual(["demo_generation_started", "demo_generation_completed"]);
    const failed = stagingEvents([staging({ key: "key-2", status: "failed", result_path: null })], [], ctx());
    expect(failed.map((e) => e.event_name)).toEqual(["demo_generation_started"]);
    expect(dedupeEvents([...done, ...stagingEvents([staging()], [], ctx())])).toHaveLength(2);
  });
  it("links the PostHog device only on a single matching click, and inherits its internal flag", () => {
    const click = row("demo_owner_generar", { style_id: "coastal" }, { distinct_id: "team-phone", timestamp: "2026-10-29T23:00:13.000Z" });
    const linked = stagingEvents([staging()], [click], ctx(["team-phone"]));
    expect(linked[0].ph_device_id).toBe("team-phone");
    expect(linked[0].is_internal).toBe(true);
    const other = row("demo_owner_generar", { style_id: "coastal" }, { distinct_id: "someone", timestamp: "2026-10-29T23:00:14.000Z" });
    expect(stagingEvents([staging()], [click, other], ctx())[0].ph_device_id).toBeNull();
  });
  it("uses the live server's ids, so live and historical records of a generation are one", () => {
    expect(stagingEvents([staging()], [], ctx()).map((e) => e.event_id)).toEqual(["s:gen-start:key-1", "s:gen-done:gen-1"]);
  });
});

describe("backfill: idempotent and resumable", () => {
  it("running twice, or resuming from a page, gives the same scores", () => {
    const rows = [row("demo_vista"), row("demo_estilo", { style_id: "modern" }), row("demo_active_time", { active_ms: 95000 }), row("demo_owner_precios")];
    const once = scoreDemoEvents(mapAll(rows, ctx()).events, new Set(), DEMO);
    const twice = scoreDemoEvents([...mapAll(rows, ctx()).events, ...mapAll(rows, ctx()).events], new Set(), DEMO);
    const resumed = scoreDemoEvents([...mapAll(rows.slice(0, 2), ctx()).events, ...mapAll(rows.slice(1), ctx()).events], new Set(), DEMO);
    expect(twice).toEqual(once);
    expect(resumed).toEqual(once);
    expect(once[0].score).toBe(4 + 7 + 4 + 10);
  });
  it("incremental (event by event) and full recalculation agree", () => {
    const rows = [row("demo_vista"), row("comparison_slider_used", { travel: 30 }), row("demo_agency_cta_clicked")];
    const events = mapAll(rows, ctx()).events;
    let incremental = scoreDemoEvents([], new Set(), DEMO);
    for (let i = 1; i <= events.length; i++) incremental = scoreDemoEvents(events.slice(0, i), new Set(), DEMO);
    expect(incremental).toEqual(scoreDemoEvents(events, new Set(), DEMO));
  });
});

import { describe, expect, it } from "vitest";
import { normalizeClientBatch, serverGenerationEvent, type IngestContext } from "@/lib/leads/ingest";
import { scoreDemoEvents } from "@/lib/leads/score";

const NOW = Date.parse("2026-10-30T18:00:00.000Z");
const ctx = (over: Partial<IngestContext> = {}): IngestContext => ({
  demoId: "11111111-1111-4111-8111-111111111111",
  agencyId: "33333333-3333-4333-8333-333333333333",
  team: false,
  member: false,
  userId: null,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  now: NOW,
  ...over,
});
const body = (events: object[], over: Record<string, unknown> = {}) => ({
  visitor: "b3c1f0de-1111-4a2b-9c3d-000000000001",
  view: "view-00000001",
  session: "019a-session",
  device: "019a-device",
  link: "presentation_invitation",
  events,
  ...over,
});
const e = (name: string, over: Record<string, unknown> = {}) => ({ id: `id-${Math.random().toString(36).slice(2, 12)}`, name, at: "2026-10-30T17:59:00.000Z", ...over });

describe("lead events from the public demo", () => {
  it("rejects a batch without a valid visitor or a list of events", () => {
    expect(normalizeClientBatch({ visitor: "x", events: [] }, ctx())).toBeNull();
    expect(normalizeClientBatch({ visitor: "b3c1f0de-1111-4a2b-9c3d-000000000001", events: "no" }, ctx())).toBeNull();
  });

  it("takes the demo from the server, never from the body", () => {
    const b = normalizeClientBatch({ ...body([e("demo_opened", { demo_id: "evil" })]), demo_id: "evil" }, ctx())!;
    expect(b.events[0].demo_id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("never accepts generations from the browser, nor activation from a non-member", () => {
    const b = normalizeClientBatch(
      body([e("demo_generation_completed"), e("demo_generation_started"), e("demo_account_created"), e("demo_property_import_completed"), e("demo_style_viewed"), e("demo_opened")]),
      ctx(),
    )!;
    expect(b.events.map((x) => x.event_name)).toEqual(["demo_opened"]);
    expect(b.dropped).toBe(5);
  });

  it("accepts the activation of a signed-in member of the demo's agency, identified", () => {
    const b = normalizeClientBatch(body([e("demo_account_created"), e("demo_property_import_started")]), ctx({ member: true }))!;
    expect(b.events.map((x) => [x.event_name, x.identity, x.visitor_type])).toEqual([
      ["demo_account_created", "identified", "agency"],
      ["demo_property_import_started", "identified", "agency"],
    ]);
  });

  it("marks the team, flagged devices, automation and bots as internal", () => {
    expect(normalizeClientBatch(body([e("demo_opened")]), ctx({ team: true }))!.events[0]).toMatchObject({ is_internal: true, internal_reason: "team_session", visitor_type: "internal" });
    expect(normalizeClientBatch(body([e("demo_opened")], { internal: true }), ctx())!.events[0].internal_reason).toBe("device_flag");
    expect(normalizeClientBatch(body([e("demo_opened")], { automation: true }), ctx())!.events[0].internal_reason).toBe("automation");
    expect(normalizeClientBatch(body([e("demo_opened")]), ctx({ userAgent: "facebookexternalhit/1.1" }))!.events[0].internal_reason).toBe("bot");
    expect(normalizeClientBatch(body([e("demo_opened")]), ctx())!.events[0].is_internal).toBe(false);
  });

  it("a visitor with the link is linked; a buyer link is anonymous", () => {
    expect(normalizeClientBatch(body([e("demo_opened")]), ctx())!.events[0].identity).toBe("linked");
    const buyer = normalizeClientBatch(body([e("demo_opened")], { link: "buyer" }), ctx())!.events[0];
    expect([buyer.identity, buyer.visitor_type]).toEqual(["anonymous", "buyer"]);
    expect(normalizeClientBatch(body([e("demo_opened")], { link: "https://evil.example/?codigo=123" }), ctx())!.events[0].link_type).toBeNull();
  });

  it("keeps one active-time row per page view and bounds its value", () => {
    const b = normalizeClientBatch(body([e("demo_active_time", { value: 30000 }), e("demo_active_time", { value: 99999999999 })]), ctx())!;
    expect(b.events.map((x) => x.event_id)).toEqual(["c:view-00000001:active", "c:view-00000001:active"]);
    expect(b.events[1].value).toBe(6 * 3600 * 1000);
    expect(normalizeClientBatch(body([e("demo_active_time", { value: 1000 })], { view: undefined }), ctx())!.events).toHaveLength(0);
  });

  it("uses the server's clock for times far in the past or in the future", () => {
    const b = normalizeClientBatch(body([e("demo_opened", { at: "2020-01-01T00:00:00Z" }), e("demo_opened", { at: "2030-01-01T00:00:00Z" })]), ctx())!;
    expect(b.events.map((x) => x.occurred_at)).toEqual([new Date(NOW).toISOString(), new Date(NOW).toISOString()]);
  });

  it("keeps only well-formed ids: no free text, links or codes reach the table", () => {
    const b = normalizeClientBatch(body([e("demo_style_selected", { style: "modern<script>", photo: "a b c", codigo: "SECRETO" })]), ctx())!;
    expect(b.events[0].style_id).toBeNull();
    expect(b.events[0].photo_id).toBeNull();
    expect(JSON.stringify(b.events)).not.toMatch(/SECRETO|script/);
  });

  it("accepts at most 50 events per batch", () => {
    const b = normalizeClientBatch(body(Array.from({ length: 60 }, () => e("demo_opened"))), ctx())!;
    expect(b.events).toHaveLength(50);
    expect(b.dropped).toBe(10);
  });

  it("a retried batch is the same events (same ids)", () => {
    const events = [e("demo_style_selected", { style: "modern" }), e("demo_pricing_viewed")];
    const first = normalizeClientBatch(body(events), ctx())!.events;
    const retry = normalizeClientBatch(body(events), ctx())!.events;
    expect(scoreDemoEvents([...first, ...retry])[0].score).toBe(scoreDemoEvents(first)[0].score);
  });
});

describe("generations confirmed by the server", () => {
  const args = {
    demoId: "11111111-1111-4111-8111-111111111111",
    agencyId: null,
    visitor: "b3c1f0de-1111-4a2b-9c3d-000000000001",
    photoId: "p",
    styleId: "modern",
    at: "2026-10-30T17:00:00.000Z",
    team: false,
  };
  it("count once per generation, however many times they are recorded", () => {
    const started = serverGenerationEvent("demo_generation_started", { ...args, generationId: "key-1" });
    const done = serverGenerationEvent("demo_generation_completed", { ...args, generationId: "job-1" });
    const s = scoreDemoEvents([started, done, done, started])[0];
    expect(s.breakdown.activation).toBe(17);
    expect(s.facts.activation.generationsCompleted).toBe(1);
  });
  it("a request without a stored result (failed) only counts as started", () => {
    const s = scoreDemoEvents([serverGenerationEvent("demo_generation_started", { ...args, generationId: "key-2" })])[0];
    expect(s.breakdown.activation).toBe(5);
    expect(s.facts.activation.generationsCompleted).toBe(0);
  });
  it("the team's own generations are internal", () => {
    expect(scoreDemoEvents([serverGenerationEvent("demo_generation_started", { ...args, generationId: "k", team: true })])[0].is_internal).toBe(true);
  });
});

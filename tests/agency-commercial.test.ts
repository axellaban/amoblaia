import { describe, expect, it } from "vitest";
import {
  agoText,
  commercialStage,
  filterRows,
  lastActivity,
  listTotals,
  nextAction,
  stageFromParam,
  STAGE_PARAM,
  type CommercialFacts,
  type CommercialRow,
} from "@/lib/agency/commercial";

const none: CommercialFacts = { prospectStage: null, demoSent: false, activityLevel: 0, score: null, hasOwner: false, subscribed: false };

describe("commercialStage", () => {
  it("is a prospect without any fact", () => {
    expect(commercialStage(none)).toBe("prospect");
    expect(commercialStage({ ...none, prospectStage: "pending" })).toBe("prospect");
    expect(commercialStage({ ...none, prospectStage: "discarded" })).toBe("prospect");
  });
  it("is contacted once the team reached out in Adquisición", () => {
    for (const s of ["sent", "conversation", "interested", "lost"] as const) expect(commercialStage({ ...none, prospectStage: s })).toBe("contacted");
  });
  it("climbs with each later fact, whatever came before", () => {
    expect(commercialStage({ ...none, demoSent: true })).toBe("demo_sent");
    expect(commercialStage({ ...none, demoSent: true, activityLevel: 1 })).toBe("interacted");
    // A visit proves the demo reached it even if it was never marked as sent.
    expect(commercialStage({ ...none, score: 12 })).toBe("interacted");
    expect(commercialStage({ ...none, hasOwner: true })).toBe("panel");
    expect(commercialStage({ ...none, hasOwner: true, subscribed: true })).toBe("client");
    expect(commercialStage({ ...none, activityLevel: 5 })).toBe("client");
    expect(commercialStage({ ...none, prospectStage: "customer" })).toBe("client");
  });
});

describe("nextAction", () => {
  it("starts with a demo, then publishing it, then sending it", () => {
    expect(nextAction("prospect", { total: 0, published: 0 }).kind).toBe("new_property");
    expect(nextAction("contacted", { total: 2, published: 0 }).kind).toBe("publish");
    expect(nextAction("prospect", { total: 1, published: 1 }).kind).toBe("send_demo");
  });
  it("follows up on WhatsApp after the demo, and checks a client's panel", () => {
    expect(nextAction("demo_sent", { total: 1, published: 1 }).kind).toBe("whatsapp");
    expect(nextAction("interacted", { total: 1, published: 1 }).text).toMatch(/panel/);
    expect(nextAction("client", { total: 1, published: 1 }).kind).toBe("support");
  });
});

describe("helpers", () => {
  it("keeps the latest fact", () => {
    expect(lastActivity([null, { at: "2026-11-01T10:00:00Z", text: "a" }, { at: "2026-11-02T10:00:00Z", text: "b" }])?.text).toBe("b");
    expect(lastActivity([])).toBeNull();
  });
  it("says how long ago in the team's words", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    expect(agoText("2026-11-03T10:00:00Z", now)).toBe("Hace 2 horas");
    expect(agoText("2026-11-02T10:00:00Z", now)).toBe("Ayer");
    expect(agoText("2026-10-29T12:00:00Z", now)).toBe("Hace 5 días");
  });
  it("reads every stage back from its URL value", () => {
    for (const [stage, param] of Object.entries(STAGE_PARAM)) expect(stageFromParam(param)).toBe(stage);
    expect(stageFromParam("otra")).toBeNull();
  });
});

const row = (over: Partial<CommercialRow>): CommercialRow => ({
  id: over.name ?? "x",
  name: "x",
  coverPhotoId: null,
  stage: "prospect",
  hasOwner: false,
  subscribed: false,
  prospect: true,
  properties: 0,
  published: 0,
  score: null,
  lastActivity: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});

describe("list", () => {
  const rows = [
    row({ name: "Demaio", stage: "interacted", score: 72, lastActivity: { at: "2026-11-03T10:00:00Z", text: "Vio una demo" } }),
    row({ name: "Del Mar", stage: "client", hasOwner: true, subscribed: true, score: 91, lastActivity: { at: "2026-11-03T11:00:00Z", text: "x" } }),
    row({ name: "Bianchi", score: 18 }),
    row({ name: "Russillo", stage: "panel", hasOwner: true, lastActivity: { at: "2026-10-01T00:00:00Z", text: "x" } }),
  ];
  it("counts the cards and each tab", () => {
    const t = listTotals(rows);
    expect(t).toMatchObject({ total: 4, hot: 2, withAccount: 2, paying: 1 });
    expect(t.byStage).toMatchObject({ prospect: 1, interacted: 1, panel: 1, client: 1, contacted: 0, demo_sent: 0 });
  });
  it("filters by stage, name, account, score and recent activity; latest first", () => {
    const base = { stage: null, q: "", account: null, minScore: null, days: null };
    expect(filterRows(rows, base).map((r) => r.name)).toEqual(["Del Mar", "Demaio", "Bianchi", "Russillo"]);
    expect(filterRows(rows, { ...base, stage: "panel" }).map((r) => r.name)).toEqual(["Russillo"]);
    expect(filterRows(rows, { ...base, q: "dem" }).map((r) => r.name)).toEqual(["Demaio"]);
    expect(filterRows(rows, { ...base, account: "none" }).map((r) => r.name)).toEqual(["Demaio", "Bianchi"]);
    expect(filterRows(rows, { ...base, minScore: 60 }).map((r) => r.name)).toEqual(["Del Mar", "Demaio"]);
    expect(filterRows(rows, { ...base, days: 7 }, Date.parse("2026-11-03T12:00:00Z")).map((r) => r.name)).toEqual(["Del Mar", "Demaio"]);
  });
});

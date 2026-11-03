import { describe, expect, it } from "vitest";
import { demosInPeriod, funnelCounts, funnelStep, inPeriod, isTestAgency, parsePeriod, shortDay, type DemoFunnelFacts } from "@/lib/agency/demo-funnel";

const none: DemoFunnelFacts = { sentAt: null, activityLevel: 0, hasOwner: false, ownerActive: false, subscribed: false };

describe("funnelStep", () => {
  it("climbs with each fact, a later one always wins", () => {
    expect(funnelStep(none)).toBe(0);
    expect(funnelStep({ ...none, sentAt: "2026-10-30T10:00:00Z" })).toBe(1);
    // A visit proves the demo reached them even if it was never marked as sent.
    expect(funnelStep({ ...none, activityLevel: 1 })).toBe(2);
    expect(funnelStep({ ...none, activityLevel: 2 })).toBe(3);
    expect(funnelStep({ ...none, activityLevel: 3 })).toBe(3);
    expect(funnelStep({ ...none, hasOwner: true })).toBe(4);
    expect(funnelStep({ ...none, activityLevel: 4 })).toBe(4);
    expect(funnelStep({ ...none, hasOwner: true, ownerActive: true })).toBe(5);
    // Activity without an account does not count as an active account.
    expect(funnelStep({ ...none, ownerActive: true })).toBe(0);
    expect(funnelStep({ ...none, subscribed: true })).toBe(6);
    expect(funnelStep({ ...none, activityLevel: 5 })).toBe(6);
  });
});

describe("funnelCounts", () => {
  it("is cumulative, with each step's share of the one before", () => {
    const f = funnelCounts([0, 1, 1, 2, 3, 3, 6]);
    expect(f.map((s) => s.count)).toEqual([7, 6, 4, 3, 1, 1, 1]);
    expect(f[0].ofPrevious).toBeNull();
    expect(f[1].ofPrevious).toBe(86);
    expect(f[4].ofPrevious).toBe(33);
    expect(f[6].ofFirst).toBeCloseTo(1 / 7);
  });
  it("has no share without a base", () => {
    const f = funnelCounts([]);
    expect(f.every((s) => s.count === 0)).toBe(true);
    expect(f[2].ofPrevious).toBeNull();
  });
});

describe("isTestAgency", () => {
  it("marks names that start with QA", () => {
    expect(isTestAgency("QA Habita")).toBe(true);
    expect(isTestAgency("QA_Habita")).toBe(true);
    expect(isTestAgency("qa-dueño")).toBe(true);
    expect(isTestAgency("Quality Propiedades")).toBe(false);
    expect(isTestAgency("Qatar Inmobiliaria")).toBe(false);
    expect(isTestAgency("Del Rosso & Asociados")).toBe(false);
  });
});

describe("periods", () => {
  // 3/11/2026 10:00 in Argentina.
  const now = Date.parse("2026-11-03T13:00:00Z");
  it("reads presets in Argentina days, both ends included", () => {
    expect(parsePeriod({ periodo: "7" }, now)).toEqual({ key: "7", from: "2026-10-28", to: "2026-11-03" });
    expect(parsePeriod({ periodo: "mes" }, now)).toEqual({ key: "mes", from: "2026-11-01", to: "2026-11-03" });
    expect(parsePeriod({}, now)).toEqual({ key: "todo", from: null, to: null });
    expect(parsePeriod({ periodo: "raro" }, now).key).toBe("todo");
  });
  it("prefers explicit dates and ignores bad ones", () => {
    expect(parsePeriod({ periodo: "7", desde: "2026-10-26", hasta: "2026-10-31" }, now)).toEqual({ key: "rango", from: "2026-10-26", to: "2026-10-31" });
    expect(parsePeriod({ desde: "2026-10-31", hasta: "2026-10-26" }, now)).toEqual({ key: "rango", from: "2026-10-31", to: "2026-10-31" });
    expect(parsePeriod({ desde: "ayer" }, now).key).toBe("todo");
  });
  it("puts a late-night demo on its Argentina day", () => {
    const p = { key: "rango", from: "2026-11-02", to: "2026-11-02" };
    // 2/11 at 23:30 in Argentina is already 3/11 in UTC.
    expect(inPeriod("2026-11-03T02:30:00Z", p)).toBe(true);
    expect(inPeriod("2026-11-03T03:30:00Z", p)).toBe(false);
    expect(shortDay("2026-11-03T02:30:00Z")).toBe("02/11");
  });
  it("sums an agency's demos of the period", () => {
    const p = { key: "rango", from: "2026-10-30", to: "2026-11-03" };
    const v = demosInPeriod(
      [
        { createdAt: "2026-10-20T12:00:00Z", step: 6 },
        { createdAt: "2026-10-31T12:00:00Z", step: 2 },
        { createdAt: "2026-11-02T12:00:00Z", step: 1 },
      ],
      p,
    );
    expect(v).toEqual({ count: 2, step: 2, latest: "2026-11-02T12:00:00Z" });
    expect(demosInPeriod([], p)).toEqual({ count: 0, step: null, latest: null });
  });
});

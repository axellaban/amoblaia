import { describe, expect, it } from "vitest";
import { AGENCY_STEPS, agencyStep, barScale, contactedSend, demosInPeriod, legacyProspectStep, funnelCounts, prospectStep, funnelStep, inPeriod, isTestAgency, parsePeriod, shortDay, type DemoFunnelFacts } from "@/lib/agency/demo-funnel";

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
    expect(parsePeriod({ periodo: "hoy" }, now)).toEqual({ key: "hoy", from: "2026-11-03", to: "2026-11-03" });
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

describe("the whole funnel (sheet + demos)", () => {
  it("puts the two prospecting steps before the demo ones: there is no reply step", () => {
    expect(AGENCY_STEPS.slice(0, 3)).toEqual(["Contactados", "Interesados", "Demos creadas"]);
    expect(AGENCY_STEPS).not.toContain("Saludo respondido");
    expect(AGENCY_STEPS).toHaveLength(9);
  });
  it("takes the highest step of each part, and a demo counts in the prospecting steps", () => {
    expect(prospectStep(null)).toBeNull();
    expect(prospectStep({ contacted: false, replied: false, interested: false })).toBeNull();
    expect(prospectStep({ contacted: true, replied: false, interested: false })).toBe(0);
    // A reply without interest (greeting, «Neutro», «No interesado») stays at «Contactados».
    expect(prospectStep({ contacted: true, replied: true, interested: false })).toBe(0);
    expect(prospectStep({ contacted: true, replied: true, interested: true })).toBe(1);
    expect(agencyStep(null, null)).toBeNull();
    expect(agencyStep(1, null)).toBe(1);
    expect(agencyStep(null, 0)).toBe(2);
    expect(agencyStep(1, 4)).toBe(6);
    const f = funnelCounts([0, 1, 2, 8], AGENCY_STEPS);
    expect(f.map((s) => s.count)).toEqual([4, 3, 2, 1, 1, 1, 1, 1, 1]);
  });
});

describe("barScale", () => {
  it("cuts the bars that dwarf the rest, so the small steps are not flat, and keeps the order", () => {
    const counts = [363, 176, 70, 53, 45, 40, 23, 4, 2, 0];
    const s = barScale(counts);
    expect(s.breakAt).toBe(78);
    expect(counts.map((c) => s.isBroken(c))).toEqual([true, true, false, false, false, false, false, false, false, false]);
    const h = counts.map((c) => s.height(c));
    expect(h[0]).toBe(100);
    expect(h[9]).toBe(0);
    // Every step is lower than the one before it.
    for (let i = 1; i < h.length; i++) expect(h[i]).toBeLessThan(h[i - 1]);
    // To scale below the cut: 70 is a bit under it, 23 about a third of 70, and 4 is visible (not 1%).
    expect(h[2]).toBeGreaterThan(55);
    expect(h[2]).toBeLessThan(78);
    expect(h[6] / h[2]).toBeCloseTo(23 / 70, 5);
    expect(h[7]).toBeGreaterThan(3);
  });
  it("draws everything to scale when no bar dwarfs the rest", () => {
    const s = barScale([10, 8, 6, 3]);
    expect(s.breakAt).toBeNull();
    expect(s.height(10)).toBe(100);
    expect(s.height(5)).toBe(50);
    expect(s.isBroken(10)).toBe(false);
    expect(barScale([0, 0]).height(0)).toBe(0);
  });
});

describe("contactedSend", () => {
  it("a send to a channel whose every contact is invalid («Número incorrecto», «Sin WhatsApp») reached no one", () => {
    expect(contactedSend("whatsapp", [{ channel: "whatsapp", invalid: true }, { channel: "email", invalid: false }])).toBe(false);
    expect(contactedSend("whatsapp", [{ channel: "whatsapp", invalid: true }, { channel: "whatsapp", invalid: false }])).toBe(true);
    // No contact of that channel, or an unknown channel: nothing says it failed.
    expect(contactedSend("whatsapp", [])).toBe(true);
    expect(contactedSend("unknown", [{ channel: "whatsapp", invalid: true }])).toBe(true);
    expect(contactedSend(null, [{ channel: "whatsapp", invalid: true }])).toBe(true);
  });
});

describe("legacyProspectStep (Chapa Labs)", () => {
  it("keeps the old three-step encoding Chapa reads: 0 contacted, 1 replied, 2 interested", () => {
    expect(legacyProspectStep({ step: 0 })).toBe(0);
    expect(legacyProspectStep({ step: 0, replied: true })).toBe(1);
    expect(legacyProspectStep({ step: 1, replied: true })).toBe(2);
  });
});

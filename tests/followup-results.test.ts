import { describe, expect, it } from "vitest";
import { attribute, blockReasons, bySegment, cohorts, versionResults, weekOf, weekly, type ResultExecution } from "@/lib/followup/results";

const ex = (agency: string, version: string, sent: string, from = 0, converted: string | null = null, status: ResultExecution["status"] = "sent"): ResultExecution => ({
  version_id: version,
  agency_id: agency,
  stage: "no-responde",
  action: "principal",
  from_step: from,
  status,
  sent_at: status === "sent" ? sent : null,
  updated_at: sent,
  converted_at: converted,
});

describe("attribution", () => {
  it("credits only the last message before the conversion; the earlier ones assisted", () => {
    const list = [ex("a", "v1", "2026-11-01T10:00:00Z", 0, "2026-11-05T10:00:00Z"), ex("a", "v2", "2026-11-03T10:00:00Z", 0, "2026-11-05T10:00:00Z")];
    const { credited, assisted } = attribute(list, new Map([["a", 1]]), 7);
    expect([...credited.keys()].map((e) => e.version_id)).toEqual(["v2"]);
    expect([...assisted].map((e) => e.version_id)).toEqual(["v1"]);
    expect(credited.get(list[1])!.hours).toBe(48);
  });

  it("respects the window: a conversion after 7 days counts in 14 and without limit", () => {
    const list = [ex("a", "v1", "2026-11-01T10:00:00Z", 0, "2026-11-10T10:00:00Z")];
    const step = new Map([["a", 1]]);
    expect(attribute(list, step, 7).credited.size).toBe(0);
    expect(attribute(list, step, 14).credited.size).toBe(1);
    expect(attribute(list, step, null).credited.size).toBe(1);
  });

  it("does not count an agency that did not move, or one without a known time", () => {
    expect(attribute([ex("a", "v1", "2026-11-01T10:00:00Z", 0, "2026-11-02T10:00:00Z")], new Map([["a", 0]]), null).credited.size).toBe(0);
    expect(attribute([ex("a", "v1", "2026-11-01T10:00:00Z", 0, null)], new Map([["a", 1]]), null).credited.size).toBe(0);
  });
});

describe("versionResults", () => {
  it("counts eligible, executed, conversions, rate, time, failures and the sample", () => {
    const versions = [
      { id: "v1", stage: "no-responde", action: "principal", version: 1, status: "active" },
      { id: "v2", stage: "no-responde", action: "principal", version: 2, status: "test" },
    ];
    const list = [ex("a", "v1", "2026-11-01T10:00:00Z", 0, "2026-11-02T10:00:00Z"), ex("b", "v1", "2026-11-01T10:00:00Z"), ex("c", "v2", "2026-11-01T10:00:00Z", 0, null, "failed")];
    const rows = versionResults(versions, list, new Map([["a", 1], ["b", 0]]), 7, new Map([["v1", 3]]));
    expect(rows[0]).toMatchObject({ eligible: 5, executed: 2, conversions: 1, rate: 0.5, medianHours: 24, failed: 0, smallSample: true, best: false });
    expect(rows[1]).toMatchObject({ executed: 0, failed: 1, rate: null });
  });

  it("marks the best only between versions with enough sample", () => {
    const versions = [
      { id: "v1", stage: "s", action: "principal", version: 1, status: "active" },
      { id: "v2", stage: "s", action: "principal", version: 2, status: "test" },
    ];
    const list: ResultExecution[] = [];
    const step = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      list.push(ex(`a${i}`, "v1", "2026-11-01T10:00:00Z", 0, i < 6 ? "2026-11-02T10:00:00Z" : null));
      list.push(ex(`b${i}`, "v2", "2026-11-01T10:00:00Z", 0, i < 12 ? "2026-11-02T10:00:00Z" : null));
      step.set(`a${i}`, i < 6 ? 1 : 0);
      step.set(`b${i}`, i < 12 ? 1 : 0);
    }
    const rows = versionResults(versions, list, step, 7, new Map());
    expect(rows.map((r) => r.best)).toEqual([false, true]);
  });
});

describe("weeks and cohorts", () => {
  it("groups reporting weeks Monday to Sunday in Argentina", () => {
    expect(weekOf("2026-11-09T12:00:00Z")).toBe("2026-11-15");
    // Sunday 23:30 local (Monday 02:30 UTC) still closes that Sunday's week.
    expect(weekOf("2026-11-09T02:30:00Z")).toBe("2026-11-08");
    expect(weekOf("2026-11-15T20:00:00Z")).toBe("2026-11-15");
    expect(weekOf("2026-11-16T12:00:00Z")).toBe("2026-11-22");
  });

  it("weekly counts executions by send week and conversions by conversion week", () => {
    const list = [ex("a", "v1", "2026-11-02T12:00:00Z", 0, "2026-11-10T12:00:00Z")];
    const w = weekly(list, new Map([["a", 1]]), null, 2, new Date("2026-11-12T12:00:00Z"));
    expect(w).toEqual([
      { week: "2026-11-08", executed: 1, conversions: 0 },
      { week: "2026-11-15", executed: 0, conversions: 1 },
    ]);
  });

  it("groups agencies by the week of first contact or reply, and by greeting version", () => {
    const agencies = [
      { firstContact: "2026-11-03T12:00:00Z", firstReply: "2026-11-10T12:00:00Z", step: 3, greetingVersion: 2 },
      { firstContact: "2026-11-04T12:00:00Z", firstReply: null, step: 0, greetingVersion: 2 },
      { firstContact: "2026-11-10T12:00:00Z", firstReply: null, step: 0, greetingVersion: null },
    ];
    const now = new Date("2026-11-12T12:00:00Z");
    expect(cohorts(agencies, "contacto", 2, now)).toEqual([
      { cohort: "2026-11-08", size: 2, respondio: 1, interes: 1, demo: 1, cuenta: 0, suscripcion: 0 },
      { cohort: "2026-11-15", size: 1, respondio: 0, interes: 0, demo: 0, cuenta: 0, suscripcion: 0 },
    ]);
    expect(cohorts(agencies, "respuesta", 2, now)[1].size).toBe(1);
    expect(bySegment(agencies).map((r) => [r.cohort, r.size])).toEqual([
      ["Antes de Follow-up (Adquisición)", 1],
      ["Saludo V2", 2],
    ]);
  });

  it("groups block reasons by kind", () => {
    expect(blockReasons(["Sin WhatsApp: cargalo.", "Sin WhatsApp: cargalo.", "Programada para el 9/11 10:00 (Seguimiento 2, a las 72 h).", "Fuera de horario: lunes a sábado de 9 a 19."])).toEqual([
      { reason: "Sin WhatsApp", n: 2 },
      { reason: "Programada", n: 1 },
      { reason: "Fuera de horario", n: 1 },
    ]);
  });
});
 
describe("atribución con fechas observadas", () => {
  it("usa la conversión más antigua documentada, independientemente del orden del registro", () => {
    const list = [
      ex("a", "v1", "2026-11-01T10:00:00Z", 0, "2026-11-06T10:00:00Z"),
      ex("a", "v2", "2026-11-03T10:00:00Z", 0, "2026-11-04T10:00:00Z"),
    ];
    const { credited, assisted } = attribute(list, new Map([["a", 1]]), null);
    expect([...credited.keys()].map((e) => e.version_id)).toEqual(["v2"]);
    expect(credited.get(list[1])?.hours).toBe(24);
    expect([...assisted].map((e) => e.version_id)).toEqual(["v1"]);
  });
});

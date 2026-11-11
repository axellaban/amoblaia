import { describe, expect, it } from "vitest";
import { executionDays, funnelCohorts, lastDays, weeklyByType, type DayExecution, type QueueDayRow } from "@/lib/followup/results";

const now = new Date("2026-11-11T15:00:00Z"); // 12:00 in Buenos Aires
const label = (stage: string, action: string) => (action === "precios" ? "Precios" : stage === "no-contactado" ? "Saludo" : "Next best action");
const ex = (agency: string, stage: string, sent: string, o: Partial<DayExecution> = {}): DayExecution => ({
  version_id: `v-${stage}`, agency_id: agency, stage, action: "principal", from_step: 0, status: "sent", sent_at: sent, updated_at: sent, converted_at: null, ...o,
});
const row = (day: string, agency: string, stage: string, state: QueueDayRow["state"] = "lista", action = "principal"): QueueDayRow => ({ day, agency_id: agency, stage, action, state });

describe("executionDays", () => {
  it("lists Buenos Aires days ending today", () => {
    expect(lastDays(3, now)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    // 01:00 UTC on the 11th is still the 10th in Buenos Aires.
    expect(lastDays(1, new Date("2026-11-11T01:00:00Z"))).toEqual(["2026-11-10"]);
  });

  it("splits a day's pending actions by type: executed by a person or a bot, successful, blocked, not taken, rescheduled", () => {
    const rows = [
      row("2026-11-10", "a", "no-contactado"),
      row("2026-11-10", "b", "no-contactado"),
      row("2026-11-10", "c", "no-contactado", "bloqueada"),
      row("2026-11-10", "d", "no-contactado"),
      row("2026-11-10", "e", "no-contactado", "programada"),
      row("2026-11-10", "f", "sin-uso", "lista", "precios"),
    ];
    const executions = [
      ex("a", "no-contactado", "2026-11-10T13:00:00Z", { converted_at: "2026-11-10T18:00:00Z" }),
      ex("b", "no-contactado", "2026-11-10T14:00:00Z", { executed_by: "bot" }),
      // Executed that day though the photo never saw it: still pending that day.
      ex("g", "no-contactado", "2026-11-10T15:00:00Z", { executed_by: "bot", converted_at: "2026-11-11T10:00:00Z" }),
      ex("f", "sin-uso", "2026-11-10T16:00:00Z", { status: "failed", sent_at: null, action: "precios" }),
    ];
    const steps = new Map([["a", 1], ["b", 0], ["g", 1]]);
    const day = executionDays(rows, executions, steps, label, 2, now)[0];
    expect(day).toMatchObject({ day: "2026-11-10", captured: true });
    expect(day.types.find((t) => t.type === "Saludo")).toEqual({
      type: "Saludo", stages: ["no-contactado"], pending: 5, human: 1, bot: 2, successHuman: 1, successBot: 1, blocked: 1, unclaimed: 1, failed: 0, scheduled: 1,
    });
    expect(day.types.find((t) => t.type === "Precios")).toMatchObject({ pending: 1, failed: 1, human: 0 });
  });

  it("marks the days without a photo of the queue", () => {
    const out = executionDays([], [ex("a", "no-contactado", "2026-11-11T13:00:00Z")], new Map(), label, 2, now);
    expect(out.map((d) => d.captured)).toEqual([false, false]);
    expect(out[1].types[0]).toMatchObject({ pending: 1, human: 1 });
  });
});

describe("weeklyByType", () => {
  it("counts each type's executions and attributed conversions per week", () => {
    const list = [ex("a", "no-contactado", "2026-11-09T13:00:00Z", { converted_at: "2026-11-10T13:00:00Z" }), ex("b", "sin-uso", "2026-11-09T13:00:00Z")];
    const out = weeklyByType(list, new Map([["a", 1]]), 7, label, 2, now);
    expect(out.Saludo.at(-1)).toMatchObject({ executed: 1, conversions: 1 });
    expect(out["Next best action"].at(-1)).toMatchObject({ executed: 1, conversions: 0 });
  });
});

describe("funnelCohorts", () => {
  const a = (firstContact: string | null, commercial: number, greetingVersion: number | null = 1) => ({ firstContact, firstReply: null, step: 0, greetingVersion, commercial });
  it("counts how many of each cohort reached each stage of the panel", () => {
    const list = [a("2026-11-09T13:00:00Z", 1), a("2026-11-10T13:00:00Z", 3), a("2026-11-10T13:00:00Z", 5)];
    const rows = funnelCohorts(list, 6, "contacto", 1, now);
    expect(rows).toEqual([{ cohort: "2026-11-13", size: 3, reached: [3, 3, 2, 2, 1, 1] }]);
    expect(funnelCohorts([...list, a("2026-10-01T13:00:00Z", 0, null)], 6, "version", 8, now).map((r) => r.cohort)).toEqual(["Antes de Follow-up (Adquisición)", "Saludo V1"]);
  });
});

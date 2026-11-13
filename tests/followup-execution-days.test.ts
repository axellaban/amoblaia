import { describe, expect, it } from "vitest";
import { executionDays, firstContactState, funnelCohorts, lastDays, queueDayState, weeklyByType, type DayExecution, type QueueDayRow } from "@/lib/followup/results";

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
    // The same day by stage of the queue: what the funnel step of each stage got.
    expect(day.stages.find((s) => s.stage === "no-contactado")).toEqual({ stage: "no-contactado", pending: 5, executed: 3, success: 2 });
    expect(day.stages.find((s) => s.stage === "sin-uso")).toEqual({ stage: "sin-uso", pending: 1, executed: 0, success: 0 });
  });

  it("counts as successful an action whose agency advanced afterwards, even without the hour of the advance (never a greeting)", () => {
    const executions = [
      // Demo sent, then the agency created its account: no timestamp recorded, from_step 5 → now 6.
      ex("a", "sin-cuenta", "2026-11-10T13:00:00Z", { from_step: 5 }),
      // Two messages at the same step: only the last one takes it.
      ex("b", "sin-interaccion", "2026-11-09T13:00:00Z", { from_step: 4 }),
      ex("b", "sin-interaccion", "2026-11-10T13:00:00Z", { from_step: 4 }),
      // Did not advance: not successful.
      ex("c", "sin-cuenta", "2026-11-10T13:00:00Z", { from_step: 5 }),
      // A greeting without a recorded reply is not successful, though it is at «Contactados» now.
      ex("d", "no-contactado", "2026-11-10T13:00:00Z", { from_step: -1 }),
    ];
    const steps = new Map([["a", 6], ["b", 5], ["c", 5], ["d", 0]]);
    const [d9, d10] = executionDays([], executions, steps, (s) => s, 3, now);
    expect(d9.types.find((t) => t.type === "sin-interaccion")).toMatchObject({ human: 1, successHuman: 0 });
    expect(d10.types.find((t) => t.type === "sin-interaccion")).toMatchObject({ human: 1, successHuman: 1 });
    expect(d10.types.find((t) => t.type === "sin-cuenta")).toMatchObject({ human: 2, successHuman: 1 });
    expect(d10.types.find((t) => t.type === "no-contactado")).toMatchObject({ human: 1, successHuman: 0 });
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
    const out = weeklyByType(list, new Map([["a", 1]]), label, 2, now);
    expect(out.Saludo.at(-1)).toMatchObject({ executed: 1, conversions: 1 });
    expect(out["Next best action"].at(-1)).toMatchObject({ executed: 1, conversions: 0 });
  });
});

describe("funnelCohorts", () => {
  // Follow-up's commercial stages from Contactado: Contactado 0, Interesado 1, Demo enviada 3, Cuenta creada 6, Cuenta activa 7, Cliente 8.
  const T = [0, 1, 3, 6, 7, 8];
  const a = (firstContact: string | null, step: number, greetingVersion: number | null = 1) => ({ firstContact, firstReply: null, step, greetingVersion });
  it("counts how many of each cohort reached each Follow-up stage, from Contactado", () => {
    const list = [a("2026-11-09T13:00:00Z", 0), a("2026-11-10T13:00:00Z", 3), a("2026-11-10T13:00:00Z", 8), a("2026-11-10T14:00:00Z", -1)];
    const rows = funnelCohorts(list, T, "contacto", 1, now);
    expect(rows).toEqual([{ cohort: "2026-11-15", size: 4, reached: [3, 2, 2, 1, 1, 1] }]);
    expect(funnelCohorts([...list, a("2026-10-01T13:00:00Z", 0, null)], T, "version", 8, now).map((r) => r.cohort)).toEqual(["Antes de Follow-up (Adquisición)", "Saludo V1"]);
  });
});

describe("queueDayState: only what the queue assigns to today is pending", () => {
  // Wednesday 11/11, 12:00 in Buenos Aires.
  it("counts what is ready, due later today, outside today's hours or stuck on data", () => {
    expect(queueDayState({}, now)).toBe("lista");
    expect(queueDayState({ dueAt: "2026-11-11T20:00:00Z", blocked: "Programada para el 11/11 17:00 (Seguimiento 2, a las 48 h de nuestro último mensaje)." }, now)).toBe("lista");
    expect(queueDayState({ blocked: "Fuera de horario: los mensajes van de lunes a sábado de 9 a 19 (hora de Argentina)." }, now)).toBe("lista");
    expect(queueDayState({ blocked: "Sin WhatsApp: cargalo en la ficha o marcala «Sin WhatsApp»." }, now)).toBe("bloqueada");
  });
  it("leaves out the first contacts beyond the daily cap, other days and those waiting for an answer", () => {
    expect(queueDayState({ blocked: "Sin cupo para primer contacto: 48 registrados y 0 externos en 24 h, máximo 48. Se habilitará al liberarse un cupo." }, now)).toBe("programada");
    expect(queueDayState({ dueAt: "2026-11-12T13:00:00Z", blocked: "Programada para el 12/11 10:00." }, now)).toBe("programada");
    expect(queueDayState({ snoozedUntil: "2026-11-15T12:00:00Z", blocked: "Reprogramada para el 15/11." }, now)).toBe("programada");
    expect(queueDayState({ blocked: "Ya le escribimos después de su última respuesta (10/11 18:00): esperá que conteste." }, now)).toBe("programada");
    // On Sunday nothing outside hours is owed.
    expect(queueDayState({ blocked: "Fuera de horario: los mensajes van de lunes a sábado de 9 a 19 (hora de Argentina)." }, new Date("2026-11-15T15:00:00Z"))).toBe("programada");
  });
});

describe("firstContactState", () => {
  it("a prospect stuck on data is not today's pending; later stages still are", () => {
    expect(firstContactState("no-contactado", "bloqueada")).toBe("programada");
    expect(firstContactState("no-contactado", "lista")).toBe("lista");
    expect(firstContactState("no-responde", "bloqueada")).toBe("bloqueada");
  });
});

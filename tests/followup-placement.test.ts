import { describe, expect, it } from "vitest";
import { OUT, byScore, cleanVersion, contradictsFunnel, placement } from "@/lib/followup/stages";

describe("placement", () => {
  it("uses the funnel's stage without a correction", () => {
    expect(placement({ reached: 0, stage: "no-responde" }, null)).toEqual({ stage: "no-responde", step: 0, manual: false });
  });
  it("keeps a correction while the funnel says the same", () => {
    expect(placement({ reached: 0, stage: "no-responde" }, { stage: "sin-demo", step: 0 })).toEqual({ stage: "sin-demo", step: 1, manual: true });
    expect(placement({ reached: null, stage: "no-contactado" }, { stage: OUT, step: -1 })).toEqual({ stage: null, step: -1, manual: true });
  });
  it("never holds a correction behind what its demo already did", () => {
    // Larco, Echarte: demo created (sin-enviar), set to «Interesado» → sin-demo by hand.
    expect(placement({ reached: 2, stage: "sin-enviar" }, { stage: "sin-demo", step: 2 })).toEqual({ stage: "sin-enviar", step: 2, manual: false });
    // Pluchino: demo sent (no-abrio), held at sin-demo / sin-enviar by hand.
    expect(placement({ reached: 3, stage: "no-abrio" }, { stage: "sin-demo", step: 3 })).toEqual({ stage: "no-abrio", step: 3, manual: false });
    expect(placement({ reached: 3, stage: "no-abrio" }, { stage: "sin-enviar", step: 3 })).toEqual({ stage: "no-abrio", step: 3, manual: false });
    // Palma: visited (sin-interaccion), set to «No abrió» by hand.
    expect(placement({ reached: 4, stage: "sin-interaccion" }, { stage: "no-abrio", step: 4 })).toEqual({ stage: "sin-interaccion", step: 4, manual: false });
    // Cepeñas: interacted (sin-cuenta), set to «No abrió» by hand.
    expect(placement({ reached: 5, stage: "sin-cuenta" }, { stage: "no-abrio", step: 5 })).toEqual({ stage: "sin-cuenta", step: 5, manual: false });
  });
  it("still allows a correction forward, back to the conversation steps or out", () => {
    expect(placement({ reached: 2, stage: "sin-enviar" }, { stage: "no-abrio", step: 2 })).toEqual({ stage: "no-abrio", step: 3, manual: true });
    expect(placement({ reached: 3, stage: "no-abrio" }, { stage: "no-responde", step: 3 })).toEqual({ stage: "no-responde", step: 0, manual: true });
    expect(placement({ reached: 3, stage: "no-abrio" }, { stage: OUT, step: 3 })).toEqual({ stage: null, step: 3, manual: true });
  });
  it("lets the funnel rule again once something real happens", () => {
    expect(placement({ reached: 3, stage: "no-abrio" }, { stage: "sin-demo", step: 0 })).toEqual({ stage: "no-abrio", step: 3, manual: false });
  });
});

describe("contradictsFunnel", () => {
  it("is true only for a demo step behind the funnel", () => {
    expect(contradictsFunnel("sin-demo", 2)).toBe(true);
    expect(contradictsFunnel("sin-enviar", 2)).toBe(false);
    expect(contradictsFunnel("no-responde", 5)).toBe(false);
    expect(contradictsFunnel("no-contactado", 0)).toBe(false);
    expect(contradictsFunnel(OUT, 5)).toBe(false);
    expect(contradictsFunnel("sin-uso", null)).toBe(false);
  });
});

describe("byScore", () => {
  const q = (score: number | null, wa: string | null = "549", sent = false, since = "2026-11-01") => ({ score, wa, since, execution: sent ? { status: "sent" } : null });
  it("orders by score from highest to lowest, without a score last", () => {
    const list = [q(10), q(null), q(90), q(55)].sort(byScore);
    expect(list.map((x) => x.score)).toEqual([90, 55, 10, null]);
  });
  it("breaks ties: to do with WhatsApp first, then the longest waiting", () => {
    const list = [q(50, "549", true), q(50, null), q(50, "549", false, "2026-11-05"), q(50, "549", false, "2026-11-02")].sort(byScore);
    expect(list.map((x) => [x.wa, x.execution?.status ?? null, x.since])).toEqual([
      ["549", null, "2026-11-02"],
      ["549", null, "2026-11-05"],
      [null, null, "2026-11-01"],
      ["549", "sent", "2026-11-01"],
    ]);
  });
});

describe("cleanVersion notes", () => {
  it("keeps the observations and limits them", () => {
    const ok = cleanVersion({ stage: "no-responde", channel: "whatsapp", body: "Hola", notes: "  No mandar sábados  " });
    expect("notes" in ok && ok.notes).toBe("No mandar sábados");
    expect(cleanVersion({ stage: "no-responde", channel: "whatsapp", body: "Hola", notes: "x".repeat(4001) })).toEqual({ error: "Las observaciones superan los 4000 caracteres." });
  });
});

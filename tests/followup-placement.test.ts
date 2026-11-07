import { describe, expect, it } from "vitest";
import { OUT, byScore, cleanVersion, placement } from "@/lib/followup/stages";

describe("placement", () => {
  it("uses the funnel's stage without a correction", () => {
    expect(placement({ reached: 0, stage: "no-responde" }, null)).toEqual({ stage: "no-responde", step: 0, manual: false });
  });
  it("keeps a correction while the funnel says the same", () => {
    expect(placement({ reached: 0, stage: "no-responde" }, { stage: "sin-demo", step: 0 })).toEqual({ stage: "sin-demo", step: 1, manual: true });
    expect(placement({ reached: null, stage: "no-contactado" }, { stage: OUT, step: -1 })).toEqual({ stage: null, step: -1, manual: true });
  });
  it("lets the funnel rule again once something real happens", () => {
    expect(placement({ reached: 3, stage: "no-abrio" }, { stage: "sin-demo", step: 0 })).toEqual({ stage: "no-abrio", step: 3, manual: false });
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

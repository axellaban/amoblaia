import { describe, expect, it } from "vitest";
import { pickForQueue, type Candidate } from "./pool";

const candidate = (id: string, status: Candidate["status"], score: number, hardReady = true): Candidate =>
  ({ id, status, score, hardReady });

describe("HABITA prospect queue selection regressions", () => {
  it("reserves 15% of a 20-place batch for eligible exploration", () => {
    const ranked = Array.from({ length: 25 }, (_, i) => candidate(`rank-${i}`, "calificado", 100 - i));
    const exploratory = Array.from({ length: 10 }, (_, i) => candidate(`explore-${i}`, "enriquecido", 10));
    const selected = pickForQueue([...ranked, ...exploratory], 20, () => 0);
    expect(selected.top).toHaveLength(17);
    expect(selected.explore).toHaveLength(3);
    expect(new Set([...selected.top, ...selected.explore]).size).toBe(20);
  });

  it("never selects discarded, already queued or hard-ineligible accounts", () => {
    const selected = pickForQueue([
      candidate("rank", "calificado", 90),
      candidate("discarded", "descartado", 100),
      candidate("queued", "en_cola", 100),
      candidate("unready", "enriquecido", 100, false),
      candidate("explore", "descubierto", 10),
    ], 5, () => 0);
    expect([...selected.top, ...selected.explore]).toEqual(["rank", "explore"]);
  });

  it("does not duplicate an exploration pick in the ranked selection", () => {
    const selected = pickForQueue([
      candidate("a", "calificado", 100),
      candidate("b", "calificado", 90),
      candidate("c", "enriquecido", 30),
    ], 5, () => 0);
    expect(new Set([...selected.top, ...selected.explore]).size).toBe(3);
  });
  it("fills the requested batch from exploration when ranked supply is scarce", () => {
    const ranked = [candidate("rank-1", "calificado", 99), candidate("rank-2", "calificado", 98)];
    const exploratory = Array.from({ length: 30 }, (_, i) => candidate(`explore-${i}`, "enriquecido", 20));
    const selected = pickForQueue([...ranked, ...exploratory], 20, () => 0);
    expect(selected.top).toEqual(["rank-1", "rank-2"]);
    expect(selected.explore).toHaveLength(18);
    expect(new Set([...selected.top, ...selected.explore]).size).toBe(20);
  });

  it("does not exceed the number of eligible candidates or duplicate them", () => {
    const selected = pickForQueue([
      candidate("eligible", "calificado", 90),
      candidate("explorable", "descubierto", 10),
      candidate("discarded", "descartado", 100),
    ], 48, () => 0);
    expect([...selected.top, ...selected.explore]).toEqual(["eligible", "explorable"]);
  });

});

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

  it("deduplicates repeated account IDs across queue candidates", () => {
    const selected = pickForQueue([
      candidate("rank-1", "calificado", 90),
      candidate("rank-1", "calificado", 90),
      candidate("explore-1", "enriquecido", 30),
      candidate("explore-1", "enriquecido", 30),
    ], 5, () => 0);
    expect(selected.top).toEqual(["rank-1"]);
    expect(selected.explore).toEqual(["explore-1"]);
    expect(new Set([...selected.top, ...selected.explore]).size).toBe(2);
  });


  it("keeps manual exclusions and queued states when duplicated by a join", () => {
    const selected = pickForQueue([
      candidate("excluded", "descartado", 1),
      candidate("excluded", "calificado", 100),
      candidate("queued", "calificado", 100),
      candidate("queued", "en_cola", 1),
      candidate("safe", "calificado", 80),
    ], 5, () => 0);
    expect([...selected.top, ...selected.explore]).toEqual(["safe"]);
  });

  it("prefers eligible and qualified snapshots over stale duplicate rows", () => {
    const selected = pickForQueue([
      candidate("a", "calificado", 100, false),
      candidate("a", "calificado", 80, true),
      candidate("b", "descubierto", 10, true),
      candidate("b", "calificado", 70, true),
    ], 5, () => 0);
    expect(selected.top).toEqual(["a", "b"]);
  });

  it("uses deterministic score and ID tie-breaks independent of input order", () => {
    const rows = [
      candidate("z", "calificado", 80),
      candidate("a", "calificado", 80),
      candidate("m", "calificado", 95),
      candidate("q", "calificado", 80),
    ];
    expect(pickForQueue(rows, 3, () => 0).top).toEqual(["m", "a", "q"]);
    expect(pickForQueue([...rows].reverse(), 3, () => 0).top).toEqual(["m", "a", "q"]);
  });

  it("returns no entries for zero or negative capacity", () => {
    const rows = [candidate("ready", "calificado", 100), candidate("explore", "enriquecido", 10)];
    for (const capacity of [0, -1, -100]) {
      expect(pickForQueue(rows, capacity, () => 0)).toEqual({ top: [], explore: [] });
    }
  });

  it("respects exploration share at 5 and 48 slots when supply is ample", () => {
    const rows = [
      ...Array.from({ length: 70 }, (_, i) => candidate(`rank-${i}`, "calificado", 100 - i)),
      ...Array.from({ length: 30 }, (_, i) => candidate(`explore-${i}`, "enriquecido", 10)),
    ];
    const five = pickForQueue(rows, 5, () => 0);
    const fortyEight = pickForQueue(rows, 48, () => 0);
    expect([five.top.length, five.explore.length]).toEqual([4, 1]);
    expect([fortyEight.top.length, fortyEight.explore.length]).toEqual([41, 7]);
    expect(new Set([...fortyEight.top, ...fortyEight.explore]).size).toBe(48);
  });
});


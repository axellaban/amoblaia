import { describe, expect, it } from "vitest";
import { cellLive, creationSettled, type CellState } from "../src/lib/demos/editor-logic";

// QA 16/11 am: after «Generar versión» in the image studio, «Creando Moderno: … se abre sola cuando
// esté lista.» stayed next to «¡Imagen lista!» for minutes. The note now ends with the creation.
const none: CellState = { kind: "none" };
const v1: CellState = { kind: "ready", generationId: "v1", running: false };
const v1Running: CellState = { kind: "ready", generationId: "v1", running: true };
const v2: CellState = { kind: "ready", generationId: "v2", running: false };

describe("Creation note", () => {
  it("knows when a style is in progress", () => {
    expect(cellLive({ kind: "waiting" })).toBe(true);
    expect(cellLive({ kind: "queued", generationId: "g" })).toBe(true);
    expect(cellLive(v1Running)).toBe(true);
    expect(cellLive(v1)).toBe(false);
    expect(cellLive(none)).toBe(false);
  });

  it("stays while the creation is in progress", () => {
    expect(creationSettled(v1, v1Running, false)).toBe(false);
    expect(creationSettled(none, { kind: "running", generationId: "g" }, true)).toBe(false);
  });

  it("does not end before the creation is seen starting", () => {
    expect(creationSettled(v1, v1, false)).toBe(false);
    expect(creationSettled(none, none, false)).toBe(false);
  });

  it("ends when a new version of an existing style is ready", () => {
    expect(creationSettled(v1, v1, true)).toBe(true);
    expect(creationSettled(v1, v2, false)).toBe(true);
  });

  it("ends when the first version is ready, or the creation fails", () => {
    expect(creationSettled(none, v2, false)).toBe(true);
    const failed = { kind: "failed", generation: {} } as CellState;
    expect(creationSettled(none, failed, false)).toBe(true);
  });
});

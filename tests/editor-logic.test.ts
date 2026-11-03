import { describe, expect, it } from "vitest";
import {
  cardStyles,
  cellState,
  groupBySpace,
  missingTasks,
  photoSummary,
  roomConflict,
  taskKey,
} from "../src/lib/demos/editor-logic";
import { nextAction, safeReturn } from "../src/lib/agency/shared";
import { downloadName, type EditorPhoto, type GenerationRow } from "../src/lib/demos/shared";

const gen = (id: string, style: string, status: GenerationRow["status"], created = "2026-10-01"): GenerationRow => ({
  id,
  style,
  status,
  mode: "furnish",
  room: "living",
  created_at: created,
  error_code: null,
});
const photo = (over: Partial<EditorPhoto> = {}): EditorPhoto => ({
  id: "p1",
  spaceId: null,
  projectId: "pj1",
  position: 0,
  visible: true,
  room: "bedroom",
  label: null,
  mode: "furnish",
  discarded: [],
  source: null,
  charged: false,
  shown: {},
  generations: [],
  retouches: [], shownRetouch: null,
  ...over,
});

describe("State of each photo + style", () => {
  it("keeps a created version ready (viewable and downloadable) whatever else happens", () => {
    const p = photo({ shown: { modern: "g1" }, generations: [gen("g2", "modern", "running", "2026-10-02"), gen("g1", "modern", "succeeded")] });
    expect(cellState(p, "modern", false)).toEqual({ kind: "ready", generationId: "g1", running: true });
  });

  it("tells running, queued, waiting in this tab, failed and uncertain apart", () => {
    expect(cellState(photo({ generations: [gen("g", "modern", "running")] }), "modern", false).kind).toBe("running");
    expect(cellState(photo({ generations: [gen("g", "modern", "queued")] }), "modern", false).kind).toBe("queued");
    expect(cellState(photo(), "modern", true).kind).toBe("waiting");
    expect(cellState(photo({ generations: [gen("g", "modern", "failed")] }), "modern", false).kind).toBe("failed");
    expect(cellState(photo({ generations: [gen("g", "modern", "needs_review")] }), "modern", false).kind).toBe("uncertain");
    // A discarded uncertain result is settled: the style can be created again.
    expect(cellState(photo({ discarded: ["g"], generations: [gen("g", "modern", "needs_review")] }), "modern", false).kind).toBe("none");
  });
});

describe("Batch", () => {
  const photos = [
    photo({ id: "a", shown: { modern: "ga" }, generations: [gen("ga", "modern", "succeeded")] }),
    photo({ id: "b", generations: [gen("gb", "modern", "needs_review")] }),
    photo({ id: "c", generations: [gen("gc", "coastal", "running")] }),
    photo({ id: "d" }),
  ];
  it("creates only what is missing: never existing, running, waiting or uncertain results", () => {
    const tasks = missingTasks(photos, new Set(["a", "b", "c", "d"]), ["modern", "coastal"], new Set([taskKey({ photoId: "d", style: "coastal" })]));
    expect(tasks.map(taskKey).sort()).toEqual(["a:coastal", "b:coastal", "c:modern", "d:modern"]);
  });
  it("leaves out photos not included, without touching their results", () => {
    expect(missingTasks(photos, new Set(["d"]), ["modern"], new Set())).toEqual([{ photoId: "d", style: "modern" }]);
    // Taking a photo out of the batch does not hide its versions: they are on its card.
    expect(cardStyles(photos[0], [])).toEqual(["modern"]);
  });
  it("shows on the card the property's styles and any other style the photo already has", () => {
    expect(cardStyles(photos[2], ["modern"])).toEqual(["modern", "coastal"]);
  });
});

describe("Spaces", () => {
  const spaces = [
    { id: "s2", name: "Dormitorio 2", roomType: "bedroom", position: 1 },
    { id: "s1", name: "Dormitorio principal", roomType: "bedroom", position: 0 },
  ];
  it("keeps two bedrooms apart and old photos in Sin organizar", () => {
    const groups = groupBySpace(
      [photo({ id: "x", spaceId: "s1" }), photo({ id: "y", spaceId: "s2" }), photo({ id: "z" }), photo({ id: "w", spaceId: "gone" })],
      spaces,
    );
    expect(groups.map((g) => [g.space?.name ?? "Sin organizar", g.photos.map((p) => p.id)])).toEqual([
      ["Dormitorio principal", ["x"]],
      ["Dormitorio 2", ["y"]],
      ["Sin organizar", ["z", "w"]],
    ]);
  });
  it("points out a room that does not match the space, without changing it", () => {
    expect(roomConflict(photo({ room: "living" }), spaces[0])).toBe("bedroom");
    expect(roomConflict(photo({ room: "bedroom" }), spaces[0])).toBeNull();
    expect(roomConflict(photo({ room: "living" }), { id: "e", name: "Fachada", roomType: "exterior", position: 2 })).toBeNull();
  });
  it("counts the photos section from real states", () => {
    const s = photoSummary(
      [
        photo({ id: "a", spaceId: "s1", shown: { modern: "g" }, generations: [gen("g", "modern", "succeeded")] }),
        photo({ id: "b", generations: [gen("f", "modern", "failed"), gen("r", "coastal", "running")] }),
      ],
      spaces,
    );
    expect(s).toMatchObject({ photos: 2, spaces: 2, unassigned: 1, ready: 1, running: 1, issues: 1 });
  });
});

describe("Lists and links", () => {
  it("suggests the next useful action from the property's real state", () => {
    const base = { photos: 3, staged: 0, status: "draft" as const, versions: { ready: 0, active: 0, issues: 0 } };
    expect(nextAction({ ...base, photos: 0 }).label).toBe("Agregar fotos");
    expect(nextAction({ ...base, versions: { ready: 0, active: 1, issues: 0 } }).label).toBe("Ver progreso");
    expect(nextAction({ ...base, versions: { ready: 0, active: 0, issues: 1 } }).label).toBe("Revisar fallos");
    expect(nextAction(base).label).toBe("Crear versiones");
    expect(nextAction({ ...base, staged: 2, versions: { ready: 2, active: 0, issues: 0 } })).toEqual({ label: "Revisar y publicar", section: "publicacion" });
  });
  it("only returns to local panel or admin pages", () => {
    expect(safeReturn("/panel/propiedades?pagina=2&q=casa", "/x")).toBe("/panel/propiedades?pagina=2&q=casa");
    expect(safeReturn("/admin/inmobiliarias?abierta=1#a", "/x")).toBe("/admin/inmobiliarias?abierta=1");
    for (const bad of ["https://evil.test/panel", "//evil.test/panel", "/\\evil.test", "/otra", "javascript:alert(1)", null])
      expect(safeReturn(bad, "/x")).toBe("/x");
  });
  it("names downloads safely", () => {
    expect(downloadName("Depto en Güemes - Dormitorio 2 - Moderno")).toEqual({
      full: "Depto en Güemes - Dormitorio 2 - Moderno.jpg",
      ascii: "Depto-en-Guemes-Dormitorio-2-Moderno.jpg",
    });
    expect(downloadName('../../etc/passwd"\n')).toEqual({ full: "etc passwd.jpg", ascii: "etc-passwd.jpg" });
    expect(downloadName(null).full).toBe("habita.jpg");
  });
});

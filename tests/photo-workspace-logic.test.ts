import { describe, expect, it } from "vitest";
import {
  initialRoom,
  initialView,
  missingTasks,
  photoVersions,
  taskKey,
  versionFileName,
  versionNumber,
  viewLabel,
} from "../src/lib/demos/editor-logic";
import { downloadName, generationDownloadUrl, photoDownloadUrl, type EditorPhoto, type GenerationRow } from "../src/lib/demos/shared";
import { findDuplicates, nameKey, siteKey } from "../src/lib/agency/duplicates";
import { nextStep } from "../src/lib/agency/shared";
import { payerNote } from "../src/lib/agency/edit-scope";

const gen = (id: string, style: string, status: GenerationRow["status"], created: string): GenerationRow => ({
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
  ...over,
});

describe("What the large image shows", () => {
  it("names it without ambiguity", () => {
    expect(viewLabel("original", "Moderno")).toBe("Original");
    expect(viewLabel("version", "Moderno")).toBe("Moderno · versión creada");
    expect(viewLabel("version", "Moderno", 2, 2)).toBe("Moderno v2 · versión creada");
    expect(viewLabel("compare", "Costero")).toBe("Comparando original y Costero");
    expect(viewLabel("version", null)).toBe("Original");
  });

  it("opens the version the listing shows, and never decides which one is published", () => {
    const p = photo({ shown: { modern: "g2", coastal: "g3" } });
    expect(initialView(p, "coastal")).toBe("g3");
    expect(initialView(p, "nordic")).toBe("g2");
    expect(initialView(photo(), "modern")).toBeNull();
    // A pure read: the photo is not changed by opening it.
    expect(p.shown).toEqual({ modern: "g2", coastal: "g3" });
  });

  it("keeps the version shown on the listing apart from the one being looked at", () => {
    const p = photo({
      shown: { modern: "g1" },
      generations: [gen("g2", "modern", "succeeded", "2026-10-02"), gen("g1", "modern", "succeeded", "2026-10-01")],
    });
    const [modern] = photoVersions(p, ["modern"], new Set());
    // The shown one first, marked; the other is kept and selectable.
    expect(modern.versions.map((v) => [v.generation.id, v.shown, v.number])).toEqual([
      ["g1", true, 1],
      ["g2", false, 2],
    ]);
  });
});

describe("Versions and their states", () => {
  const p = photo({
    discarded: ["g0"],
    generations: [
      gen("g4", "coastal", "needs_review", "2026-10-04"),
      gen("g3", "nordic", "failed", "2026-10-03"),
      gen("g2", "modern", "running", "2026-10-02"),
      gen("g1", "modern", "succeeded", "2026-10-01"),
      gen("g0", "modern", "succeeded", "2026-09-30"),
    ],
    shown: { modern: "g1" },
  });

  it("numbers versions by style, discarded ones included, so names never repeat", () => {
    expect(versionNumber(p, "g0")).toBe(1);
    expect(versionNumber(p, "g1")).toBe(2);
    expect(versionNumber(p, "nope")).toBeNull();
  });

  it("tells created, generating, failed, uncertain, waiting and not created apart", () => {
    const waiting = new Set([taskKey({ photoId: "p1", style: "industrial" })]);
    const states = Object.fromEntries(photoVersions(p, ["modern", "nordic", "coastal", "industrial", "boho"], waiting).map((s) => [s.style, s.state.kind]));
    expect(states).toEqual({ modern: "ready", nordic: "failed", coastal: "uncertain", industrial: "waiting" });
    // The previous result stays while another one is being created.
    const modern = photoVersions(p, ["modern"], new Set())[0];
    expect(modern.state).toMatchObject({ kind: "ready", running: true });
    expect(modern.versions.map((v) => v.generation.id)).toEqual(["g1"]);
  });

  it("never sends an uncertain result again in a batch, nor what is running or created", () => {
    const tasks = missingTasks([p], new Set(["p1"]), ["modern", "nordic", "coastal", "boho"], new Set());
    expect(tasks).toEqual([
      { photoId: "p1", style: "nordic" },
      { photoId: "p1", style: "boho" },
    ]);
  });

  it("unticking a photo leaves it out of the batch without touching its results", () => {
    expect(missingTasks([p], new Set(), ["nordic"], new Set())).toEqual([]);
    expect(photoVersions(p, ["modern"], new Set())[0].versions).toHaveLength(1);
  });
});

describe("The room a new version starts with", () => {
  it("takes the space's kind and reports a photo that says otherwise, without changing it", () => {
    const space = { id: "s1", name: "Dormitorio 2", roomType: "bedroom", position: 0 };
    expect(initialRoom(photo({ room: "bedroom" }), space)).toEqual({ room: "bedroom", conflict: null });
    expect(initialRoom(photo({ room: "living" }), space)).toEqual({ room: "bedroom", conflict: "living" });
    // A space that cannot be staged (a bathroom) keeps the photo's own setting.
    expect(initialRoom(photo({ room: "living" }), { ...space, roomType: "bathroom" })).toEqual({ room: "living", conflict: null });
    expect(initialRoom(photo({ room: "living" }), null)).toEqual({ room: "living", conflict: null });
  });
});

describe("Downloading the active version", () => {
  it("names the file property-space-style-version", () => {
    const name = versionFileName("Depto Güemes", "Dormitorio 2", "Moderno", 2);
    expect(name).toBe("Depto Güemes - Dormitorio 2 - Moderno - v2");
    expect(downloadName(name).ascii).toBe("Depto-Guemes-Dormitorio-2-Moderno-v2.jpg");
    expect(versionFileName("Casa", "Living", "Moderno")).toBe("Casa - Living - Moderno");
  });

  it("asks the server for exactly that version by its id, or the original by its photo", () => {
    const v = new URL(generationDownloadUrl("g-123", "x"), "https://h.test");
    expect(Object.fromEntries(v.searchParams)).toMatchObject({ generacion: "g-123", w: "2048", descargar: "1" });
    const o = new URL(photoDownloadUrl("p-9", "x"), "https://h.test");
    expect(Object.fromEntries(o.searchParams)).toMatchObject({ foto: "p-9", w: "2048", descargar: "1" });
    expect(o.searchParams.has("generacion")).toBe(false);
  });
});

describe("Possible duplicate agencies", () => {
  it("compares names without generic words, sites by host and contact e-mails", () => {
    expect(nameKey("GM Servicios Inmobiliarios S.R.L.")).toBe("gm");
    expect(nameKey("Inmobiliaria Güemes & Asociados")).toBe("guemes asociados");
    expect(siteKey("https://www.Sur.com.ar/propiedades")).toBe("sur.com.ar");
    expect(siteKey("no es un sitio")).toBeNull();
    const agencies = [
      { id: "a", name: "GM Servicios Inmobiliarios", website: null },
      { id: "b", name: "Otra", website: "sur.com.ar", contact_email: "hola@sur.com.ar" },
      { id: "c", name: "Inmobiliaria", website: null },
    ];
    expect(findDuplicates({ name: "GM" }, agencies).map((m) => m.id)).toEqual(["a"]);
    expect(findDuplicates({ name: "Nueva", website: "https://www.sur.com.ar" }, agencies)).toEqual([expect.objectContaining({ id: "b", reasons: ["sitio"] })]);
    expect(findDuplicates({ name: "Nueva", contactEmail: "HOLA@sur.com.ar" }, agencies)).toEqual([expect.objectContaining({ id: "b", reasons: ["email"] })]);
    // Only generic words: nothing to compare, no false alarm.
    expect(findDuplicates({ name: "Inmobiliaria" }, agencies)).toEqual([]);
  });
});

describe("One next step per property", () => {
  const base = { photos: 4, staged: 1, status: "draft" as const, versions: { ready: 2, active: 0, issues: 0 } };
  it("is primary while something is missing and secondary once published", () => {
    expect(nextStep({ ...base, photos: 0, staged: 0, versions: { ready: 0, active: 0, issues: 0 } })).toMatchObject({ cta: "Agregar fotos", primary: true });
    expect(nextStep({ ...base, staged: 0, versions: { ready: 0, active: 0, issues: 0 } })).toMatchObject({ cta: "Continuar con las fotos", section: "fotos" });
    expect(nextStep({ ...base, versions: { ready: 2, active: 1, issues: 0 } })).toMatchObject({ cta: "Ver progreso" });
    expect(nextStep({ ...base, versions: { ready: 0, active: 0, issues: 1 }, staged: 0 })).toMatchObject({ cta: "Revisar versiones" });
    expect(nextStep(base)).toMatchObject({ cta: "Revisar y publicar", section: "publicacion", primary: true });
    expect(nextStep({ ...base, status: "published" })).toMatchObject({ cta: "Editar propiedad", primary: false });
  });
});

describe("Who pays, in the editor's words", () => {
  it("says the team cannot spend an agency's credits, and that a team demo uses none", () => {
    expect(payerNote({ payer: "agency", blocked: "x" })).toMatch(/no puede gastarlos/);
    expect(payerNote({ payer: "team", blocked: null })).toMatch(/no usan créditos/);
    expect(payerNote({ payer: "agency", blocked: null })).toMatch(/se revisa antes/);
  });
});

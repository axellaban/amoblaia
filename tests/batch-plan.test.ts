import { describe, expect, it } from "vitest";
import { combineQuotes, finished, knownRoom, planBatch, retryable, runSummary, type BatchGroup } from "@/lib/agency/batch-plan";
import type { EditorPhoto, GenerationRow } from "@/lib/demos/shared";

const gen = (style: string, status: GenerationRow["status"], room = "bedroom", id = `${style}-${status}`): GenerationRow => ({
  id,
  status,
  style,
  mode: "furnish",
  room,
  created_at: "2026-10-28T10:00:00Z",
  error_code: null,
});
const photo = (id: string, extra: Partial<EditorPhoto> = {}): EditorPhoto => ({
  id,
  spaceId: null,
  projectId: `pj-${id}`,
  position: 0,
  visible: true,
  room: "living",
  label: null,
  mode: "furnish",
  discarded: [],
  source: null,
  charged: false,
  shown: {},
  generations: [],
  retouches: [],
  ...extra,
});
const group = (id: string, photos: EditorPhoto[], extra: Partial<BatchGroup> = {}): BatchGroup => ({
  id,
  title: `Grupo ${id}`,
  propertyType: "residential",
  blocked: null,
  photos,
  ...extra,
});
const choice = { style: "modern", mode: "furnish" as const };

describe("knownRoom", () => {
  it("is the room of the newest version, and none for a photo never staged (the stored default is not a choice)", () => {
    expect(knownRoom(photo("a"))).toBeNull();
    expect(knownRoom(photo("a", { generations: [gen("modern", "succeeded", "dining"), gen("modern", "failed", "living")] }))).toBe("dining");
  });
});

describe("planBatch", () => {
  it("creates one version per chosen photo across groups, only for the photos chosen", () => {
    const plan = planBatch(
      [group("g1", [photo("a"), photo("b")]), group("g2", [photo("c")])],
      { g1: ["a"], g2: ["c"] },
      { a: "living", c: "bedroom" },
      choice,
    );
    expect(plan.tasks).toEqual([
      { demoId: "g1", photoId: "a", room: "living", mode: "furnish", style: "modern" },
      { demoId: "g2", photoId: "c", room: "bedroom", mode: "furnish", style: "modern" },
    ]);
    expect(plan).toMatchObject({ photos: 2, groups: 2 });
  });

  it("asks for the room of a photo without one instead of guessing it", () => {
    const plan = planBatch([group("g1", [photo("a"), photo("b")])], { g1: ["a", "b"] }, { a: "living", b: null }, choice);
    expect(plan.tasks.map((t) => t.photoId)).toEqual(["a"]);
    expect(plan.missingRoom).toEqual([{ demoId: "g1", photoId: "b" }]);
  });

  it("never sends again a version that exists, is running or needs a technical review", () => {
    const plan = planBatch(
      [
        group("g1", [
          photo("ready", { shown: { modern: "x" }, generations: [gen("modern", "succeeded")] }),
          photo("live", { generations: [gen("modern", "running")] }),
          photo("review", { generations: [gen("modern", "needs_review")] }),
          photo("failed", { generations: [gen("modern", "failed")] }),
        ]),
      ],
      { g1: ["ready", "live", "review", "failed"] },
      { ready: "living", live: "living", review: "living", failed: "living" },
      choice,
    );
    expect(plan.tasks.map((t) => t.photoId)).toEqual(["failed"]);
    expect(plan.skipped).toEqual({ exists: 1, running: 1, uncertain: 1 });
  });

  it("keeps a style that does not fit one group out of that group only", () => {
    const plan = planBatch(
      [group("home", [photo("a")]), group("office", [photo("b")], { propertyType: "office" })],
      { home: ["a"], office: ["b"] },
      { a: "living", b: "living" },
      choice,
    );
    expect(plan.tasks.map((t) => t.demoId)).toEqual(["home"]);
    expect(plan.incompatible).toEqual([expect.objectContaining({ demoId: "office" })]);
  });

  it("keeps out a group this account may not stage, saying why", () => {
    const plan = planBatch(
      [group("g1", [photo("a")], { blocked: "El equipo no puede usar los créditos de la inmobiliaria." })],
      { g1: ["a"] },
      { a: "living" },
      choice,
    );
    expect(plan.tasks).toEqual([]);
    expect(plan.blocked).toEqual([{ demoId: "g1", title: "Grupo g1", reason: "El equipo no puede usar los créditos de la inmobiliaria." }]);
  });
});

describe("combineQuotes", () => {
  const agency = (newPhotos: number, credits: number | null = 3) => ({ payer: "agency" as const, credits, newPhotos, blocked: null });

  it("checks the balance against the whole batch: groups that fit separately may not fit together", () => {
    const total = combineQuotes([
      { title: "A", quote: agency(2) },
      { title: "B", quote: agency(2) },
    ]);
    expect(total).toMatchObject({ payer: "agency", credits: 3, newPhotos: 4, after: -1 });
    expect(total.blocked).toBe("Hacen falta 4 créditos y la inmobiliaria tiene 3.");
  });

  it("reports the balance after generating when it fits", () => {
    expect(combineQuotes([{ title: "A", quote: agency(2, 24) }])).toEqual({ payer: "agency", credits: 24, newPhotos: 2, after: 22, blocked: null });
  });

  it("names the group whose own quote is blocked", () => {
    const total = combineQuotes([
      { title: "A", quote: agency(1) },
      { title: "B", quote: { ...agency(1), blocked: "La cobertura venció." } },
    ]);
    expect(total.blocked).toBe("B: La cobertura venció.");
  });

  it("never reads an unknown balance as zero or as enough", () => {
    expect(combineQuotes([{ title: "A", quote: agency(1, null) }]).blocked).toBe("No pudimos consultar el saldo. Probá de nuevo.");
  });

  it("costs nothing to the agency when the team pays", () => {
    expect(combineQuotes([{ title: "A", quote: { payer: "team", credits: null, newPhotos: 0, blocked: null } }])).toMatchObject({ payer: "team", newPhotos: 0, blocked: null });
  });
});

describe("a run", () => {
  it("reads the outcome from the newest attempt in that style", () => {
    expect(finished(photo("a", { generations: [gen("modern", "succeeded"), gen("modern", "failed")] }), "modern")).toBe("ready");
    expect(finished(photo("a", { generations: [gen("modern", "needs_review")] }), "modern")).toBe("review");
    expect(finished(null, "modern")).toBe("failed");
  });

  it("is never complete while something failed or is uncertain", () => {
    expect(runSummary(["ready", "failed"])).toMatchObject({ ready: 1, attention: 1, finished: true, allReady: false });
    expect(runSummary(["ready", "generating"])).toMatchObject({ pending: 1, finished: false, allReady: false });
    expect(runSummary(["ready", "ready"]).allReady).toBe(true);
  });

  it("offers a retry only for confirmed failures, unanswered requests and versions never sent", () => {
    expect((["failed", "uncertain", "unsent"] as const).every(retryable)).toBe(true);
    expect((["ready", "review", "lost", "generating"] as const).some(retryable)).toBe(false);
  });
});

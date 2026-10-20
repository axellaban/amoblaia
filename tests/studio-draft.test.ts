import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDraft,
  DRAFT_TTL,
  loadDraft,
  saveDraft,
  type StudioDraft,
} from "../src/lib/studio-draft";
const draft = (): StudioDraft => ({
  file: new Blob(["original photo bytes"], { type: "image/jpeg" }),
  filename: "mi-living.jpg",
  room: "living",
  style: "eclectic",
  mode: "redesign",
  notes: "Sofá azul",
  consent: true,
  projectId: null,
  savedAt: Date.now(),
});
afterEach(async () => {
  vi.restoreAllMocks();
  await clearDraft();
});
describe("Photo persistence across sign-in navigation", () => {
  it("restores the actual image and all choices after a fresh database read", async () => {
    const saved = draft();
    await saveDraft(saved);
    const restored = await loadDraft();
    expect(restored?.filename).toBe("mi-living.jpg");
    expect(await restored?.file.text()).toBe("original photo bytes");
    expect(restored).toMatchObject({
      room: "living",
      style: "eclectic",
      mode: "redesign",
      notes: "Sofá azul",
      consent: true,
    });
  });
  it("expires the draft after 24 hours and does not offer it again", async () => {
    await saveDraft(draft());
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + DRAFT_TTL + 1);
    expect(await loadDraft()).toBeNull();
    expect(await loadDraft()).toBeNull();
  });
  it("discards the photo when the user starts over or signs out", async () => {
    await saveDraft(draft());
    await clearDraft();
    expect(await loadDraft()).toBeNull();
  });
});

import { openDB } from "idb";
import {
  normalizeStyle,
  type RoomId,
  type StyleId,
  type ModeId,
} from "./catalog";

export type StudioDraft = {
  file: Blob;
  filename: string;
  room: RoomId;
  style: StyleId;
  mode: ModeId;
  notes: string;
  projectId: string | null;
  savedAt: number;
};
export const DRAFT_TTL = 24 * 60 * 60 * 1000;
async function database() {
  return openDB("amoblaia-drafts", 1, {
    upgrade(db) {
      db.createObjectStore("drafts");
    },
  });
}
export async function saveDraft(draft: StudioDraft) {
  const db = await database();
  await db.put("drafts", draft, "active");
}
export async function loadDraft(): Promise<StudioDraft | null> {
  const db = await database();
  const draft = (await db.get("drafts", "active")) as StudioDraft | undefined;
  if (!draft) return null;
  if (
    !draft.file?.size ||
    !Number.isFinite(draft.savedAt) ||
    Date.now() - draft.savedAt > DRAFT_TTL
  ) {
    await db.delete("drafts", "active");
    return null;
  }
  return { ...draft, style: normalizeStyle(draft.style) };
}
export async function clearDraft() {
  const db = await database();
  await db.delete("drafts", "active");
}

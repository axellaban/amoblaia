import { openDB } from "idb";
import type { ModeId, RoomId, StyleId } from "./catalog";
export type Project = {
  id: string;
  name: string;
  folderId?: string | null;
  trashedAt?: string | null;
  createdAt: number;
  original: string;
  result: string;
  room: RoomId;
  style: StyleId;
  mode: ModeId;
  demo: boolean;
  cloud?: boolean;
  pendingJobId?: string;
  projectId?: string;
  variants?: {
    id: string;
    free?: boolean;
    result: string;
    room: RoomId;
    style: StyleId;
    mode: ModeId;
    notes: string;
    createdAt: number;
  }[];
};
async function db() {
  return openDB("amoblaia-studio", 1, {
    upgrade(db) {
      db.createObjectStore("projects", { keyPath: "id" });
    },
  });
}
export async function listProjects(): Promise<Project[]> {
  const database = await db();
  return ((await database.getAll("projects")) as Project[]).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}
export async function saveProject(project: Project) {
  const database = await db();
  await database.put("projects", project);
  const all = await listProjects();
  for (const extra of all.slice(20))
    await database.delete("projects", extra.id);
}
export async function deleteProject(id: string) {
  const database = await db();
  await database.delete("projects", id);
}

import { requireUser, failure } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { signPath } from "@/lib/commerce/jobs";
import { adoptGuest } from "@/lib/commerce/guest";
import type { ModeId, RoomId, StyleId } from "@/lib/catalog";
type GenerationRow = {
  id: string;
  room: RoomId;
  style: StyleId;
  mode: ModeId;
  notes: string;
  status: string;
  result_path: string | null;
  created_at: string;
  is_free: boolean;
  reviewed_at?: string | null;
  discarded_at?: string | null;
};
type ProjectRow = {
  id: string;
  name: string;
  created_at: string;
  original_path: string;
  folder_id: string | null;
  trashed_at: string | null;
  generations: GenerationRow[];
};
export async function GET(request: Request) {
  try {
    const user = await requireUser(undefined, true);
    // Retries a trial hand-over that failed at sign-in, before listing.
    await adoptGuest(user);
    const db = adminClient();
    const base =
      "id,name,created_at,original_path,folder_id,trashed_at,generations(id,room,style,mode,notes,status,result_path,created_at,is_free";
    const list = (review: boolean) =>
      db
        .from("projects")
        .select(`${base}${review ? ",reviewed_at,discarded_at" : ""})`)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(150) as unknown as Promise<{
        data: ProjectRow[] | null;
        error: { code?: string; message: string } | null;
      }>;
    let { data: projects, error } = await list(true);
    // Before the showcase migration is applied the review columns do not
    // exist yet: the library keeps working as it did.
    if (
      error &&
      (error.code === "42703" || /reviewed_at|discarded_at/.test(error.message))
    )
      ({ data: projects, error } = await list(false));
    if (error) throw new Error("PROJECT_LIST_FAILED");
    // One file that cannot be signed (missing or deleted) must not turn the
    // whole library into an error: that item is left out instead.
    const sign = (path: string) =>
      signPath(path).catch(() => {
        console.error("image_sign_failed");
        return "";
      });
    const rows = await Promise.all(
      (projects || []).map(async (p) => {
        const done = p.generations
          // A discarded proposal is hidden everywhere; its file stays with the project.
          .filter(
            (g) => g.status === "succeeded" && g.result_path && !g.discarded_at,
          )
          .sort((a, b) => b.created_at.localeCompare(a.created_at));

        const variants = (
          await Promise.all(
            done.map(async (g) => ({
              id: g.id,
              free: g.is_free,
              reviewed: Boolean(g.reviewed_at),
              result: await sign(g.result_path!),
              room: g.room,
              style: g.style,
              mode: g.mode,
              notes: g.notes,
              createdAt: Date.parse(g.created_at),
            })),
          )
        ).filter((v) => v.result);
        const original = await sign(p.original_path);
        if (!original) return null;
        const pending = p.generations.find(
          (g) => g.status === "queued" || g.status === "running",
        );
        const latest = variants.at(0) || {
          createdAt: Date.parse(p.created_at),
          room: "living",
          style: "modern",
          mode: "furnish",
          result: "",
        };
        return {
          projectId: p.id,
          folderId: p.folder_id,
          trashedAt: p.trashed_at,
          name: p.name,
          original,
          ...latest,
          id: p.id,
          variants,
          demo: false,
          cloud: true,
          pendingJobId: pending?.id,
          pendingJobIds: p.generations
            .filter((g) => ["queued", "running"].includes(g.status))
            .map((g) => g.id),
        };
      }),
    );
    return Response.json(
      {
        projects: rows.filter(
          (p): p is NonNullable<typeof p> =>
            p !== null &&
            (new URL(request.url).searchParams.get("includeTrash") === "1" ||
              !p.trashedAt),
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

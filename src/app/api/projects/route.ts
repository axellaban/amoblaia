import { requireUser, failure } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { signPath } from "@/lib/commerce/jobs";
export async function GET(request: Request) {
  try {
    const user = await requireUser(undefined, true);
    const db = adminClient();
    const { data: projects, error } = await db
      .from("projects")
      .select(
        "id,name,created_at,original_path,folder_id,trashed_at,generations(id,room,style,mode,notes,status,result_path,created_at,is_free)",
      )
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(150);
    if (error) throw new Error("PROJECT_LIST_FAILED");
    const rows = await Promise.all(
      (projects || []).map(async (p) => {
        const done = p.generations
          .filter((g) => g.status === "succeeded" && g.result_path)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));

        const variants = await Promise.all(
          done.map(async (g) => ({
            id: g.id,
            free: g.is_free,
            result: await signPath(g.result_path!),
            room: g.room,
            style: g.style,
            mode: g.mode,
            notes: g.notes,
            createdAt: Date.parse(g.created_at),
          })),
        );
        const original = await signPath(p.original_path);
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
          (p) =>
            new URL(request.url).searchParams.get("includeTrash") === "1" ||
            !p.trashedAt,
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

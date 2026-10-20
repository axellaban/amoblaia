import { requireUser, failure, HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/commerce/jobs";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const db = adminClient();
    const { data: project, error } = await db
      .from("projects")
      .select("id,original_path,generations(status,result_path)")
      .eq("id", id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !project)
      throw new HttpError(404, "No encontramos el proyecto.");
    if (
      project.generations.some((g) =>
        ["queued", "running", "needs_review"].includes(g.status),
      )
    )
      throw new HttpError(
        409,
        "Esperá a que termine la generación o su revisión antes de borrar el proyecto.",
      );
    const paths = [
      project.original_path,
      ...project.generations.flatMap((g) =>
        g.result_path ? [g.result_path] : [],
      ),
    ];
    const removed = await db.storage.from(BUCKET).remove(paths);
    if (removed.error) throw new Error("IMAGE_DELETE_FAILED");
    const updated = await db
      .from("projects")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (updated.error) throw new Error("PROJECT_DELETE_FAILED");
    return Response.json({ deleted: true });
  } catch (e) {
    return failure(e);
  }
}

import { requireUser, failure, HttpError, rpc } from "@/lib/commerce/http";
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
      .select("id,original_path,trashed_at,generations(status,result_path)")
      .eq("id", id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !project)
      throw new HttpError(404, "No encontramos el proyecto.");
    if (!project.trashed_at)
      throw new HttpError(409, "Primero mové la foto a la papelera.");
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
    // Marked deleted first: if removing the files then fails, the worst case
    // is unused files, never a listed project whose images are gone.
    const updated = await db
      .from("projects")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (updated.error) throw new Error("PROJECT_DELETE_FAILED");
    const removed = await db.storage.from(BUCKET).remove(paths);
    if (removed.error) console.error("image_delete_deferred", id);
    return Response.json({ deleted: true });
  } catch (e) {
    return failure(e);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Trial users manage their own photos too (the studio offers trashing);
    // the RPC only touches projects owned by this id.
    const user = await requireUser(request, true);
    const { id } = await params;
    if (Number(request.headers.get("content-length") || 0) > 2048)
      throw new HttpError(413, "Solicitud inválida.");
    const { action, name, folderId } = await request.json();
    if (!["trash", "restore", "rename", "move"].includes(action))
      throw new HttpError(400, "Elegí una acción válida.");
    if (
      action === "rename" &&
      (typeof name !== "string" || !name.trim() || name.length > 100)
    )
      throw new HttpError(400, "Ingresá un nombre de hasta 100 caracteres.");
    if (
      folderId !== undefined &&
      folderId !== null &&
      (typeof folderId !== "string" || !/^[0-9a-f-]{36}$/i.test(folderId))
    )
      throw new HttpError(400, "Carpeta inválida.");
    await rpc("amobla_manage_project", {
      p_user: user.id,
      p_project: id,
      p_action: action,
      p_name: name ?? null,
      p_folder: folderId ?? null,
    });
    return Response.json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}

import { requireUser, failure, HttpError, rpc } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/commerce/jobs";
import { ownedShowcase, readShowcaseFields } from "@/lib/showcase-fields";
/** Edits the data, turns the public link on or off, or sets its rooms. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    if (Number(request.headers.get("content-length") || 0) > 16384)
      throw new HttpError(413, "Solicitud inválida.");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object")
      throw new HttpError(400, "Solicitud inválida.");
    await ownedShowcase(user.id, id);
    const fields = readShowcaseFields(body, true);
    if (body.rooms !== undefined) {
      if (
        !Array.isArray(body.rooms) ||
        body.rooms.some(
          (r: unknown) =>
            !r ||
            typeof r !== "object" ||
            typeof (r as { projectId?: unknown }).projectId !== "string" ||
            typeof (r as { label?: unknown }).label !== "string",
        )
      )
        throw new HttpError(400, "Ambientes inválidos.");
      await rpc("amobla_set_showcase_rooms", {
        p_user: user.id,
        p_showcase: id,
        p_rooms: body.rooms.map((r: { projectId: string; label: string }) => ({
          project_id: r.projectId,
          label: r.label,
        })),
      });
    }
    if (Object.keys(fields).length) {
      const { error } = await adminClient()
        .from("showcases")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw new Error("SHOWCASE_UPDATE_FAILED");
    }
    return Response.json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
/** Deleting turns the link off for good; the photos stay in the library. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const showcase = await ownedShowcase(user.id, id);
    const db = adminClient();
    const { error } = await db
      .from("showcases")
      .update({
        active: false,
        deleted_at: new Date().toISOString(),
        agency_logo_path: null,
      })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw new Error("SHOWCASE_DELETE_FAILED");
    if (showcase.agency_logo_path)
      await db.storage
        .from(BUCKET)
        .remove([showcase.agency_logo_path])
        .catch(() => null);
    return Response.json({ deleted: true });
  } catch (e) {
    return failure(e);
  }
}

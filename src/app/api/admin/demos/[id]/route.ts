import { requireAdmin, failure, HttpError, rpc } from "@/lib/commerce/http";
import {
  assertNoLiveJobs,
  demoDetail,
  demoRow,
  newToken,
  releaseProjects,
} from "@/lib/demos/server";
import { agencyInput, orderInput, propertyInput, readJson } from "@/lib/demos/input";
import { cleanText, isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";

const PRIVATE = { "Cache-Control": "private, no-store" };
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin(undefined, "demos");
    const { id } = await params;
    return Response.json(await demoDetail(id), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin(request, "demos");
    const { id } = await params;
    const demo = await demoRow(id);
    const body = await readJson(request);
    const db = adminClient();
    const saved = (r: { error: unknown }, code: string) => {
      if (r.error) throw new Error(code);
    };
    switch (body.action) {
      case "demo":
        saved(
          await db.from("demos").update({ title: cleanText(body.title, 160) }).eq("id", demo.id),
          "DEMO_UPDATE_FAILED",
        );
        break;
      case "agency":
        saved(
          await db.from("agencies").update(agencyInput(body.agency)).eq("id", demo.agency_id),
          "AGENCY_UPDATE_FAILED",
        );
        break;
      case "property":
        saved(
          await db
            .from("demo_properties")
            .update(propertyInput(body.property))
            .eq("id", demo.property_id),
          "PROPERTY_UPDATE_FAILED",
        );
        break;
      case "publish": {
        const { count, error } = await db
          .from("demo_photos")
          .select("id", { count: "exact", head: true })
          .eq("property_id", demo.property_id)
          .eq("visible", true);
        if (error) throw new Error("DEMO_PHOTOS_LOOKUP_FAILED");
        if (!count)
          throw new HttpError(409, "Agregá al menos una foto visible antes de publicar.");
        saved(
          await db
            .from("demos")
            .update({ status: "published", published_at: new Date().toISOString() })
            .eq("id", demo.id),
          "DEMO_PUBLISH_FAILED",
        );
        break;
      }
      case "unpublish":
        saved(
          await db.from("demos").update({ status: "draft" }).eq("id", demo.id),
          "DEMO_UNPUBLISH_FAILED",
        );
        break;
      case "token":
        // The old link stops working at once (for example, if it was sent to
        // the wrong person); the published state is kept.
        saved(
          await db.from("demos").update({ token: newToken() }).eq("id", demo.id),
          "DEMO_TOKEN_FAILED",
        );
        break;
      case "cover": {
        const photoId = body.photoId === null ? null : body.photoId;
        if (photoId !== null) {
          if (!isUuid(photoId)) throw new HttpError(400, "Foto inválida.");
          const { data, error } = await db
            .from("demo_photos")
            .select("id")
            .eq("id", photoId)
            .eq("property_id", demo.property_id)
            .maybeSingle();
          if (error || !data) throw new HttpError(404, "No encontramos la foto.");
        }
        saved(
          await db.from("demos").update({ cover_photo_id: photoId }).eq("id", demo.id),
          "DEMO_COVER_FAILED",
        );
        break;
      }
      case "order": {
        const { data, error } = await db
          .from("demo_photos")
          .select("id")
          .eq("property_id", demo.property_id);
        if (error) throw new Error("DEMO_PHOTOS_LOOKUP_FAILED");
        const ids = orderInput(
          body.ids,
          (data as { id: string }[]).map((p) => p.id),
        );
        const results = await Promise.all(
          ids.map((photoId, position) =>
            db.from("demo_photos").update({ position }).eq("id", photoId),
          ),
        );
        if (results.some((r) => r.error)) throw new Error("DEMO_ORDER_FAILED");
        break;
      }
      default:
        throw new HttpError(400, "Acción inválida.");
    }
    if (["publish", "unpublish", "token"].includes(String(body.action))) {
      await rpc("amobla_account", { p_user: actor.id, p_trial: false });
      await db.from("admin_audit").insert({
        actor_id: actor.id,
        action: `demo_${body.action}`,
        subject_id: demo.id,
        details: {},
      });
    }
    return Response.json(await demoDetail(demo.id), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** Deletes the demo, its property and photos, and the files no other demo uses. The agency stays. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin(request, "demos");
    const { id } = await params;
    const demo = await demoRow(id);
    const db = adminClient();
    const { data, error } = await db
      .from("demo_photos")
      .select("project_id")
      .eq("property_id", demo.property_id);
    if (error) throw new Error("DEMO_PHOTOS_LOOKUP_FAILED");
    const projects = (data as { project_id: string }[]).map((p) => p.project_id);
    await assertNoLiveJobs(projects);
    // Cascades to the demo and its photos (the link stops working at once).
    const removed = await db.from("demo_properties").delete().eq("id", demo.property_id);
    if (removed.error) throw new Error("DEMO_DELETE_FAILED");
    await releaseProjects(projects);
    await rpc("amobla_account", { p_user: actor.id, p_trial: false });
    await db.from("admin_audit").insert({
      actor_id: actor.id,
      action: "demo_delete",
      subject_id: demo.id,
      details: { agencyId: demo.agency_id, photos: projects.length },
    });
    return Response.json({ deleted: true }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

import { failure, HttpError, rpc } from "@/lib/commerce/http";
import { requireDemoAccess, stagingRule } from "@/lib/agency/server";
import { auditAgencyEdit } from "@/lib/agency/edit-context";
import {
  assertNoLiveJobs,
  brandingOf,
  demoDetail,
  newToken,
  releaseProjects,
  saveJson,
  settingsOf,
} from "@/lib/demos/server";
import {
  agencyInput,
  brandingInput,
  orderInput,
  propertyInput,
  readJson,
  settingsInput,
  validStyle,
} from "@/lib/demos/input";
import { cleanText, isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";

const PRIVATE = { "Cache-Control": "private, no-store" };
type Params = { params: Promise<{ id: string }> };

/** The team's notes and contact person about an agency are never shown to the agency. */
function viewOf(detail: Awaited<ReturnType<typeof demoDetail>>, admin: boolean) {
  return admin ? detail : { ...detail, agency: { ...detail.agency, notes: null, contact_name: null } };
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const access = await requireDemoAccess(undefined, id);
    return Response.json(
      { ...viewOf(await demoDetail(access.demo.id), access.admin), staging: stagingRule(access) },
      { headers: PRIVATE },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const access = await requireDemoAccess(request, id);
    const { actor, demo, admin, role } = access;
    const body = await readJson(request);
    const db = adminClient();
    // The team's notes and contact person are its own; the agency's identity
    // is edited by the team or the agency's owner.
    if (body.action === "agency" && !admin) throw new HttpError(403, "Acceso reservado al equipo.");
    if (body.action === "branding" && !admin && role !== "owner")
      throw new HttpError(403, "Solo el dueño de la inmobiliaria puede cambiar su marca.");
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
      case "branding":
        // The logo has its own route; this keeps it.
        await saveJson(
          "agencies",
          "branding",
          demo.agency_id,
          brandingInput(body.branding, await brandingOf(demo.agency_id)),
        );
        break;
      case "settings": {
        const next = settingsInput(body.settings, (await settingsOf(demo.id)).settings);
        if (next.openStyle !== null && !validStyle(next.openStyle))
          throw new HttpError(400, "Elegí un estilo válido.");
        await saveJson("demos", "settings", demo.id, next);
        break;
      }
      case "main-style":
        // Kept on every photo: the cover and the link preview use it.
        if (!validStyle(body.style)) throw new HttpError(400, "Elegí un estilo válido.");
        saved(
          await db.from("demo_photos").update({ style: body.style }).eq("property_id", demo.property_id),
          "DEMO_STYLE_FAILED",
        );
        break;
      case "hide-style": {
        // Takes a style out of the demo: its versions go to the discarded
        // ones of each photo, where they can still be recovered.
        if (!validStyle(body.style)) throw new HttpError(400, "Elegí un estilo válido.");
        const { data: rows, error } = await db
          .from("demo_photos")
          .select("id,project_id,approved_generation_id,discarded")
          .eq("property_id", demo.property_id);
        if (error) throw new Error("DEMO_PHOTOS_LOOKUP_FAILED");
        const photos = rows as {
          id: string;
          project_id: string;
          approved_generation_id: string | null;
          discarded: string[] | null;
        }[];
        if (!photos.length) break;
        const { data: gens, error: genError } = await db
          .from("generations")
          .select("id,project_id")
          .in("project_id", photos.map((p) => p.project_id))
          .eq("style", body.style)
          .eq("status", "succeeded");
        if (genError) throw new Error("DEMO_GENERATIONS_LOOKUP_FAILED");
        const results = await Promise.all(
          photos.map((p) => {
            const ids = (gens as { id: string; project_id: string }[])
              .filter((g) => g.project_id === p.project_id)
              .map((g) => g.id);
            if (!ids.length) return { error: null };
            return db
              .from("demo_photos")
              .update({
                discarded: [...new Set([...(p.discarded || []), ...ids])],
                ...(ids.includes(p.approved_generation_id ?? "") ? { approved_generation_id: null } : {}),
              })
              .eq("id", p.id);
          }),
        );
        if (results.some((r) => r.error)) throw new Error("DEMO_STYLE_FAILED");
        break;
      }
      default:
        throw new HttpError(400, "Acción inválida.");
    }
    await auditAgencyEdit(access, String(body.action), body.action === "settings" && body.settings && typeof body.settings === "object" ? { fields: Object.keys(body.settings) } : {});
    if (["publish", "unpublish", "token"].includes(String(body.action))) {
      await rpc("amobla_account", { p_user: actor.id, p_trial: false });
      await db.from("admin_audit").insert({
        actor_id: actor.id,
        action: `demo_${body.action}`,
        subject_id: demo.id,
        details: {},
      });
    }
    return Response.json({ ...viewOf(await demoDetail(demo.id), admin), staging: stagingRule(access) }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** Deletes the demo, its property and photos, and the files no other demo uses. The agency stays. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const access = await requireDemoAccess(request, id);
    const { actor, demo, admin, role } = access;
    if (!admin && role !== "owner") throw new HttpError(403, "Solo el dueño de la inmobiliaria puede eliminar propiedades.");
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
    await auditAgencyEdit(access, "delete", { photos: projects.length });
    return Response.json({ deleted: true }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

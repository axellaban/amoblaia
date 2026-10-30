import { failure, HttpError } from "@/lib/commerce/http";
import { requireDemoAccess } from "@/lib/agency/server";
import { auditAgencyEdit } from "@/lib/agency/edit-context";
import { demoDetail, photoOf, saveRetouch, type RetouchSource } from "@/lib/demos/server";
import { readJson } from "@/lib/demos/input";
import { parseAdjust } from "@/lib/demos/retouch";
import { isUuid } from "@/lib/demos/shared";
export const runtime = "nodejs";
export const maxDuration = 120;

const PRIVATE = { "Cache-Control": "private, no-store" };
type Params = { params: Promise<{ id: string; photoId: string }> };

/** The source of a retouch in the request: the original, one AI version, or another retouch. */
function sourceOf(value: unknown): RetouchSource {
  const v = value as { kind?: unknown; id?: unknown } | null;
  if (v?.kind === "original") return { kind: "original" };
  if ((v?.kind === "generation" || v?.kind === "retouch") && isUuid(v.id)) return { kind: v.kind, id: v.id as string };
  throw new HttpError(400, "Elegí qué versión retocar.");
}

/**
 * Saves the retouch of a photo as a new version: free, no AI and no credits.
 * The adjustments are checked here as well as in the editor.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id, photoId } = await params;
    const access = await requireDemoAccess(request, id);
    const photo = await photoOf(access.demo, photoId);
    const body = await readJson(request);
    const adjust = parseAdjust(body.adjust);
    if (!adjust) throw new HttpError(400, "Los ajustes no son válidos.");
    const retouchId = await saveRetouch({
      photoId: photo.id,
      projectId: photo.project_id,
      source: sourceOf(body.source),
      adjust,
      actorId: access.actor.id,
    });
    await auditAgencyEdit(access, "photo_retouch", { photo: photo.id, retouch: retouchId });
    const detail = await demoDetail(id);
    return Response.json({ retouch: retouchId, photo: detail.photos.find((p) => p.id === photo.id) ?? null }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

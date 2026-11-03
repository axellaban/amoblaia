import { HttpError, failure } from "@/lib/commerce/http";
import { invitationOf } from "@/lib/agency/invitation";
import { readJson, validStyle } from "@/lib/demos/input";
import { demoRow, photoOf, publishedDemo, saveRetouch, settingsOf, type RetouchSource } from "@/lib/demos/server";
import { parseAdjust } from "@/lib/demos/retouch";
import { isUuid } from "@/lib/demos/shared";
import { styleFits } from "@/lib/demos/styles";
import { cloudConfigured } from "@/lib/supabase/config";
export const runtime = "nodejs";
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * The agency edits a photo of its own demo from its invitation: a free
 * retouch, saved and shown in the listing. Only the invitation's agency can;
 * buyers never reach this (they see the photos, nothing to edit).
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!cloudConfigured()) throw new HttpError(503, "La edición todavía no está disponible.");
    const { token } = await params;
    const body = await readJson(request, 4096);
    const demo = await publishedDemo(token);
    if (!demo) throw new HttpError(404, "Esta demo no está disponible.");
    const invitation = typeof body.code === "string" ? await invitationOf(body.code) : null;
    if (!invitation || invitation.agencyId !== demo.agencyId) throw new HttpError(403, "Esta invitación no permite editar la demo.");
    if (!isUuid(body.photo)) throw new HttpError(400, "Foto inválida.");
    const adjust = parseAdjust(body.adjust);
    if (!adjust) throw new HttpError(400, "Los ajustes no son válidos.");
    const row = await demoRow(demo.id);
    const photo = await photoOf(row, body.photo);
    if (!photo.visible) throw new HttpError(404, "Esta foto no está disponible.");
    const { settings } = await settingsOf(demo.id);
    const from = body.source as { kind?: unknown; style?: unknown } | null;
    let source: RetouchSource;
    if (from?.kind === "original") source = { kind: "original" };
    else if (from?.kind === "style" && validStyle(from.style) && styleFits(from.style, settings.propertyType)) source = { kind: "style", style: from.style };
    else if (from?.kind === "retouch" && photo.shown_retouch_id) source = { kind: "retouch", id: photo.shown_retouch_id };
    else throw new HttpError(400, "Elegí qué versión retocar.");
    const retouch = await saveRetouch({
      photoId: photo.id,
      projectId: photo.project_id,
      source,
      adjust,
      actorId: null,
      show: true,
    });
    return Response.json({ retouch }, { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

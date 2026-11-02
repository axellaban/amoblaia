import { failure, HttpError } from "@/lib/commerce/http";
import { requireDemoAccess } from "@/lib/agency/server";
import { VIDEO_PLACEMENTS, type VideoPlacement } from "@/lib/demos/branding";
import { readJson } from "@/lib/demos/input";
import { saveJson, settingsOf } from "@/lib/demos/server";
import { isUuid } from "@/lib/demos/shared";
export const runtime = "nodejs";

/**
 * { demoId, placement }: where this property's video goes in its ficha and
 * its demo (first or second thumbnail, under the gallery, or hidden). Stored
 * with the property's own settings: it never changes another property.
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 1024);
    if (!isUuid(body.demoId)) throw new HttpError(400, "Propiedad inválida.");
    if (!VIDEO_PLACEMENTS.includes(body.placement as VideoPlacement)) throw new HttpError(400, "Elegí dónde mostrar el video.");
    const access = await requireDemoAccess(request, body.demoId);
    const { settings } = await settingsOf(access.demo.id);
    await saveJson("demos", "settings", access.demo.id, { ...settings, videoPlacement: body.placement });
    return Response.json({ placement: body.placement }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

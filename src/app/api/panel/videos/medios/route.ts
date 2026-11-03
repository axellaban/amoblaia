import { failure, HttpError } from "@/lib/commerce/http";
import { requireDemoAccess, requireDemoRead } from "@/lib/agency/server";
import { readJson } from "@/lib/demos/input";
import { isUuid } from "@/lib/demos/shared";
import { libraryTracks, mediaUploadTarget, mediaUrl } from "@/lib/video/media-server";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };

/**
 * ?demo=<id>: the music library (tracks already generated, with links that
 * expire in an hour). With &path=<file>: a short link to a song or logo
 * uploaded for this property. Viewers too.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const demoId = params.get("demo");
    if (!isUuid(demoId)) throw new HttpError(400, "Propiedad inválida.");
    const access = await requireDemoRead(demoId);
    if (params.has("path")) {
      const url = await mediaUrl({ agencyId: access.demo.agency_id, demoId: access.demo.id, path: params.get("path") });
      return Response.json({ url }, { headers: PRIVATE });
    }
    return Response.json({ library: await libraryTracks() }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** { demoId, kind: "music" | "watermark", type, size }: where the browser uploads the file. Editors only. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 1024);
    if (!isUuid(body.demoId)) throw new HttpError(400, "Propiedad inválida.");
    const access = await requireDemoAccess(request, body.demoId);
    const upload = await mediaUploadTarget({ agencyId: access.demo.agency_id, demoId: access.demo.id, kind: body.kind, type: body.type, size: body.size });
    return Response.json({ upload }, { status: 201, headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

import { failure, requireAdmin } from "@/lib/commerce/http";
import { readJson } from "@/lib/demos/input";
import { generateTrack, libraryStatus } from "@/lib/video/media-server";
export const runtime = "nodejs";
// One track per call: fal's music model answers in under a minute or two.
export const maxDuration = 120;

const PRIVATE = { "Cache-Control": "private, no-store" };

/** The music library for the team: each track of the catalog and whether it is already generated. */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await libraryStatus(), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** { id }: generates (or makes again) one track of the library with fal. */
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const body = await readJson(request, 512);
    return Response.json(await generateTrack(body.id), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

import { failure, HttpError } from "@/lib/commerce/http";
import { requireDemoAccess, requireDemoRead } from "@/lib/agency/server";
import { readJson } from "@/lib/demos/input";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { advanceAiVideos, aiUploadTarget, startAiVideo } from "@/lib/video/ai";
import { formatOf, isAiMode, videoFileName } from "@/lib/video/plan";
import { createVideo, finishVideo, listVideos, type VideoRow } from "@/lib/video/server";
export const runtime = "nodejs";
// Starting an AI video sends up to six photos to the provider; reading moves running ones forward.
export const maxDuration = 60;

const PRIVATE = { "Cache-Control": "private, no-store" };
async function titleOf(propertyId: string) {
  const { data } = await adminClient().from("demo_properties").select("title").eq("id", propertyId).maybeSingle();
  return (data as { title: string } | null)?.title ?? "propiedad";
}

/** ?demo=<id>: the property's videos, with links that expire in an hour. Running AI videos move forward first. Viewers too. */
export async function GET(request: Request) {
  try {
    const demoId = new URL(request.url).searchParams.get("demo");
    if (!isUuid(demoId)) throw new HttpError(400, "Propiedad inválida.");
    const access = await requireDemoRead(demoId);
    await advanceAiVideos({ demoId: access.demo.id }, Date.now() + 20_000).catch((e) => console.error("video_ai_advance", e instanceof Error ? e.message : e));
    const title = await titleOf(access.demo.property_id);
    const videos = await listVideos(access.demo.id, (r: VideoRow) => videoFileName(title, formatOf(r.format)));
    return Response.json({ videos }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/**
 * { demoId, key, mode, format, photoCount, options }: a new video. The
 * «Clásico» answers where its MP4 is uploaded; an AI mode charges its credits
 * (the agency's, or the team's own account for an agency without one) and
 * starts the animation. Editors only (requireDemoAccess on POST).
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 4096);
    if (!isUuid(body.demoId)) throw new HttpError(400, "Propiedad inválida.");
    const access = await requireDemoAccess(request, body.demoId);
    if (isAiMode(body.mode)) {
      // Like stagings (stagingRule): an agency with its own account pays from its panel, never from the
      // team's edit; a team member who owns the agency is in their own panel and pays from it.
      if (access.admin && access.billingUser && access.billingUser !== access.actor.id) throw new HttpError(403, "Esta inmobiliaria ya tiene su cuenta: los videos con IA se crean desde su panel, con sus créditos.");
      const started = await startAiVideo({
        agencyId: access.demo.agency_id,
        demoId: access.demo.id,
        actorId: access.actor.id,
        payerId: access.billingUser ?? access.actor.id,
        key: body.key,
        mode: body.mode,
        format: body.format,
        options: body.options,
      });
      return Response.json(started, { status: 201, headers: PRIVATE });
    }
    const created = await createVideo({
      agencyId: access.demo.agency_id,
      demoId: access.demo.id,
      actorId: access.actor.id,
      key: body.key,
      mode: body.mode,
      format: body.format,
      photoCount: body.photoCount,
      options: body.options,
    });
    return Response.json(created, { status: 201, headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** { demoId, id }: an AI video whose clips are ready, and where its joined MP4 is uploaded. Editors only. */
export async function PUT(request: Request) {
  try {
    const body = await readJson(request, 1024);
    if (!isUuid(body.demoId)) throw new HttpError(400, "Propiedad inválida.");
    const access = await requireDemoAccess(request, body.demoId);
    return Response.json(await aiUploadTarget(access.demo.id, body.id), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** { demoId, id, ok, durationMs, error }: the render ended. Completed only once the MP4 is really stored. */
export async function PATCH(request: Request) {
  try {
    const body = await readJson(request, 2048);
    if (!isUuid(body.demoId)) throw new HttpError(400, "Propiedad inválida.");
    const access = await requireDemoAccess(request, body.demoId);
    const row = await finishVideo({ demoId: access.demo.id, id: body.id, ok: body.ok, durationMs: body.durationMs, error: body.error });
    return Response.json({ id: row.id, status: row.status, error: row.error }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

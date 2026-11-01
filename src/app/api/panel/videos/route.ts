import { failure, HttpError } from "@/lib/commerce/http";
import { requireDemoAccess } from "@/lib/agency/server";
import { readJson } from "@/lib/demos/input";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { createVideo, finishVideo, listVideos, type VideoRow } from "@/lib/video/server";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60) || "propiedad";

async function titleOf(propertyId: string) {
  const { data } = await adminClient().from("demo_properties").select("title").eq("id", propertyId).maybeSingle();
  return (data as { title: string } | null)?.title ?? "propiedad";
}

/** ?demo=<id>: the property's videos, with links that expire in an hour. Viewers too. */
export async function GET(request: Request) {
  try {
    const demoId = new URL(request.url).searchParams.get("demo");
    if (!isUuid(demoId)) throw new HttpError(400, "Propiedad inválida.");
    const access = await requireDemoAccess(undefined, demoId);
    const title = slug(await titleOf(access.demo.property_id));
    const videos = await listVideos(access.demo.id, (r: VideoRow) => `${title}-${r.format === "9:16" ? "vertical" : "horizontal"}.mp4`);
    return Response.json({ videos }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** { demoId, key, mode, format, photoCount }: a new video and where its MP4 is uploaded. Editors only (requireDemoAccess on POST). */
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 2048);
    if (!isUuid(body.demoId)) throw new HttpError(400, "Propiedad inválida.");
    const access = await requireDemoAccess(request, body.demoId);
    const created = await createVideo({
      agencyId: access.demo.agency_id,
      demoId: access.demo.id,
      actorId: access.actor.id,
      key: body.key,
      mode: body.mode,
      format: body.format,
      photoCount: body.photoCount,
    });
    return Response.json(created, { status: 201, headers: PRIVATE });
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

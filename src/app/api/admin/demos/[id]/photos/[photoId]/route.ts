import { after } from "next/server";
import { failure, HttpError, rpc } from "@/lib/commerce/http";
import { requireDemoAccess } from "@/lib/agency/server";
import { onFreeTier } from "@/lib/commerce/jobs";
import { runJob } from "@/lib/commerce/jobs";
import { buildDemoPrompt } from "@/lib/demos/styles";
import {
  assertNoLiveJobs,
  demoDetail,
  photoOf,
  releaseProjects,
} from "@/lib/demos/server";
import {
  photoChanges,
  readJson,
  validMode,
  validRoom,
  validStyle,
} from "@/lib/demos/input";
import { cleanText, isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const maxDuration = 300;
/** High enough to never stop a demo; the reservation still counts the day's generations. */
const DEMO_DAILY_LIMIT = 1_000_000;

const PRIVATE = { "Cache-Control": "private, no-store" };
type Params = { params: Promise<{ id: string; photoId: string }> };

/**
 * A staging of an agency's photo through the regular reservation: one
 * credit the first time the photo is staged, further versions included
 * while the coverage lasts, refunded on a technical failure. Free (marked)
 * results cannot be published on a listing, so an account without credits
 * is asked to get them instead of producing one.
 */
async function stageWithCredits(
  owner: string,
  projectId: string,
  key: string,
  room: string,
  style: string,
  mode: string,
  notes: string,
) {
  const db = adminClient();
  const { data, error } = await db
    .from("projects")
    .select("user_id,grant_id,credit_grants(source_key)")
    .eq("id", projectId)
    .single();
  if (error) throw new Error("PROJECT_LOOKUP_FAILED");
  const project = data as unknown as { user_id: string; grant_id: string | null; credit_grants: { source_key: string } | null };
  if (project.user_id !== owner)
    throw new HttpError(409, "Esta foto es compartida con otra demo. Volvé a subirla para ambientarla.");
  const charged = Boolean(project.grant_id) && !/^(trial|demo):/.test(project.credit_grants?.source_key ?? "");
  await rpc("amobla_account", { p_user: owner, p_trial: false });
  if (!charged && (await onFreeTier(owner)))
    throw new HttpError(402, "No te quedan créditos. Sumá créditos para ambientar esta foto.");
  return rpc<string[]>("amobla_reserve_batch", {
    p_user: owner,
    p_project: projectId,
    p_key: key,
    p_room: room,
    p_style: style,
    p_mode: mode,
    p_notes: notes,
    p_prompts: [buildDemoPrompt(room, style, mode, notes)],
    p_daily_limit: Number(process.env.MAX_GENERATIONS_PER_DAY || 100),
  });
}

async function editorPhoto(demoId: string, photoId: string) {
  const detail = await demoDetail(demoId);
  return detail.photos.find((p) => p.id === photoId) ?? null;
}

/**
 * Progress of a photo's proposals. Like /api/jobs/[id], a queued job is
 * (re)dispatched here and a job whose worker died goes to review, so a
 * closed tab or a killed function never leaves the photo stuck.
 */
export async function GET(_request: Request, { params }: Params) {
  const deadline = Date.now() + maxDuration * 1000 - 5000;
  try {
    const { id, photoId } = await params;
    const { demo } = await requireDemoAccess(undefined, id);
    const photo = await photoOf(demo, photoId);
    const db = adminClient();
    const { data: jobs, error } = await db
      .from("generations")
      .select("id,user_id,status,started_at")
      .eq("project_id", photo.project_id)
      .in("status", ["queued", "running"]);
    if (error) throw new Error("DEMO_JOBS_LOOKUP_FAILED");
    const live = jobs as { id: string; user_id: string; status: string; started_at: string | null }[];
    const stale = live.find(
      (j) =>
        j.status === "running" &&
        j.started_at &&
        Date.now() - Date.parse(j.started_at) > 10 * 60 * 1000,
    );
    if (stale) await rpc("amobla_sweep_stale", { p_user: stale.user_id }).catch(() => null);
    const queued = live.filter((j) => j.status === "queued").map((j) => j.id);
    if (queued.length)
      after(async () => {
        await Promise.allSettled(queued.map((job) => runJob(job, deadline)));
      });
    return Response.json({ photo: await editorPhoto(demo.id, photo.id) }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** Edits a photo: room, label, mode, visibility, and which versions it discards or recovers. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, photoId } = await params;
    const { demo } = await requireDemoAccess(request, id);
    const photo = await photoOf(demo, photoId);
    const body = await readJson(request);
    const changes = photoChanges(body.changes);
    const db = adminClient();
    const discarded = new Set(photo.discarded || []);
    if ("approve" in body) {
      if (body.approve === null) changes.approved_generation_id = null;
      else {
        if (!isUuid(body.approve)) throw new HttpError(400, "Propuesta inválida.");
        const { data: g, error } = await db
          .from("generations")
          .select("id,status,result_path,is_free")
          .eq("id", body.approve)
          .eq("project_id", photo.project_id)
          .maybeSingle();
        if (error) throw new Error("DEMO_GENERATION_LOOKUP_FAILED");
        if (!g || g.status !== "succeeded" || !g.result_path || g.is_free)
          throw new HttpError(409, "Solo se puede aprobar una propuesta terminada.");
        changes.approved_generation_id = g.id;
        discarded.delete(g.id);
        changes.discarded = [...discarded];
      }
    }
    if ("discard" in body) {
      if (!isUuid(body.discard)) throw new HttpError(400, "Propuesta inválida.");
      discarded.add(body.discard);
      changes.discarded = [...discarded];
      if (photo.approved_generation_id === body.discard) changes.approved_generation_id = null;
    }
    if ("restore" in body) {
      if (!isUuid(body.restore)) throw new HttpError(400, "Propuesta inválida.");
      discarded.delete(body.restore);
      changes.discarded = [...discarded];
    }
    if (!Object.keys(changes).length) throw new HttpError(400, "No hay cambios para guardar.");
    const updated = await db.from("demo_photos").update(changes).eq("id", photo.id);
    if (updated.error) throw new Error("DEMO_PHOTO_UPDATE_FAILED");
    return Response.json({ photo: await editorPhoto(demo.id, photo.id) }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** Removes the photo from the demo; its files go too unless another demo uses them. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id, photoId } = await params;
    const { demo } = await requireDemoAccess(request, id);
    const photo = await photoOf(demo, photoId);
    await assertNoLiveJobs([photo.project_id]);
    const removed = await adminClient().from("demo_photos").delete().eq("id", photo.id);
    if (removed.error) throw new Error("DEMO_PHOTO_DELETE_FAILED");
    await releaseProjects([photo.project_id]);
    return Response.json({ deleted: true }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/**
 * "Ambientar con IA": one proposal through the regular engine (same prompt,
 * worker, daily capacity and storage budget). The demo RPC covers it with
 * the zero-balance demo grant, so no customer credit is spent.
 */
export async function POST(request: Request, { params }: Params) {
  const started = Date.now();
  try {
    const { id, photoId } = await params;
    const { actor, demo, admin, billingUser } = await requireDemoAccess(request, id);
    if (!process.env.OPENAI_API_KEY)
      throw new HttpError(503, "La generación todavía no está habilitada.");
    const photo = await photoOf(demo, photoId);
    const body = await readJson(request, 4096);
    const room = validRoom(body.room) ? body.room : photo.room;
    if (!validStyle(body.style)) throw new HttpError(400, "Elegí un estilo válido.");
    const style = body.style;
    const mode = validMode(body.mode) ? body.mode : photo.mode;
    const notes = cleanText(body.notes, 300) ?? "";
    if (!isUuid(body.key)) throw new HttpError(400, "Identificador de solicitud inválido.");
    if (billingUser) {
      // The agency's own account: its owner's credits pay, like any photo.
      if (admin && billingUser !== actor.id)
        throw new HttpError(409, "Esta inmobiliaria ya tiene su cuenta: las ambientaciones se crean desde su panel.");
      const ids = await stageWithCredits(billingUser, photo.project_id, body.key, room, style, mode, notes);
      await adminClient().from("demo_photos").update({ room, mode }).eq("id", photo.id);
      const deadline = started + maxDuration * 1000 - 5000;
      after(async () => {
        await Promise.allSettled(ids.map((job) => runJob(job, deadline)));
      });
      return Response.json({ ids }, { status: 202, headers: PRIVATE });
    }
    await rpc("amobla_account", { p_user: actor.id, p_trial: false });
    const ids = await rpc<string[]>("amobla_reserve_demo_generation", {
      p_actor: actor.id,
      p_photo: photo.id,
      p_key: body.key,
      p_room: room,
      p_style: style,
      p_mode: mode,
      p_notes: notes,
      p_prompt: buildDemoPrompt(room, style, mode, notes),
      // Demos are prepared by the team: no daily cap. The storage budget,
      // one live generation per account and the demo grant still apply.
      p_daily_limit: DEMO_DAILY_LIMIT,
    });
    // Remembers the room and operation for the next version of this photo.
    await adminClient().from("demo_photos").update({ room, mode }).eq("id", photo.id);
    const deadline = started + maxDuration * 1000 - 5000;
    after(async () => {
      await Promise.allSettled(ids.map((job) => runJob(job, deadline)));
    });
    return Response.json({ ids }, { status: 202, headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

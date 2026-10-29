import { after } from "next/server";
import { HttpError, failure } from "@/lib/commerce/http";
import { runJob } from "@/lib/commerce/jobs";
import { validVisitor } from "@/lib/demos/activity";
import { readJson, validStyle } from "@/lib/demos/input";
import { assertNoLiveJobs, demoRow, photoOf, publishedDemo, settingsOf } from "@/lib/demos/server";
import { isUuid } from "@/lib/demos/shared";
import { buildDemoPrompt, styleFits } from "@/lib/demos/styles";
import { cloudConfigured } from "@/lib/supabase/config";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const maxDuration = 300;

/** The team's staging limit for one request: the engine itself still counts the day's generations. */
const DEMO_DAILY_LIMIT = 1_000_000;
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/** The owner of the photo's project: the account the team's demo staging runs under. */
async function projectOwner(projectId: string) {
  const { data, error } = await adminClient().from("projects").select("user_id").eq("id", projectId).maybeSingle();
  if (error || !data) throw new Error("DEMO_PROJECT_LOOKUP_FAILED");
  return (data as { user_id: string }).user_id;
}

/** Maps the claim's refusals to what the visitor sees. Anything else stays generic. */
function claimError(message: string) {
  if (message.includes("NO_GIFT_CREDITS")) return new HttpError(409, "Esta demo ya usó sus créditos de regalo. Para generar más, mirá los precios.");
  if (message.includes("AGENCY_CLAIMED")) return new HttpError(409, "Esta inmobiliaria ya tiene su cuenta: generá desde su panel.");
  if (message.includes("DEMO_NOT_PUBLISHED")) return new HttpError(404, "Esta demo no está disponible.");
  return new Error("PUBLIC_STAGING_CLAIM_FAILED");
}

/**
 * A visitor of a published demo generates one style of one of its photos,
 * with the agency's gift credits. Everything is checked here: the demo must
 * be published and the photo visible; each try (its key) spends one credit once.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const started = Date.now();
  try {
    if (!cloudConfigured()) throw new HttpError(503, "La generación todavía no está disponible.");
    if (!process.env.OPENAI_API_KEY) throw new HttpError(503, "La generación todavía no está habilitada.");
    const { token } = await params;
    const body = await readJson(request, 2048);
    if (!validVisitor(body.visitor) || !isUuid(body.key) || !isUuid(body.photo)) throw new HttpError(400, "Recargá la página e intentá de nuevo.");
    if (!validStyle(body.style)) throw new HttpError(400, "Elegí un estilo válido.");
    const demo = await publishedDemo(token);
    if (!demo) throw new HttpError(404, "Esta demo no está disponible.");
    const { settings } = await settingsOf(demo.id);
    if (!styleFits(body.style, settings.propertyType)) throw new HttpError(400, "Ese estilo no corresponde a este inmueble.");
    const photo = await photoOf(await demoRow(demo.id), body.photo);
    if (!photo.visible) throw new HttpError(404, "Esta foto no está disponible.");
    await assertNoLiveJobs([photo.project_id]);

    const style = body.style;
    const key = body.key;
    const { data, error } = await adminClient().rpc("habita_public_staging_claim", {
      p_demo: demo.id,
      p_visitor: body.visitor,
      p_key: key,
      p_photo: photo.id,
      p_style: style,
    });
    if (error) throw claimError(error.message);
    const claim = data as { replay: boolean; remaining: number };
    // The same try sent again: its staging already runs, nothing is spent twice.
    if (claim.replay) return Response.json({ replay: true, remaining: claim.remaining }, { status: 200, headers: NO_STORE });

    try {
      const owner = await projectOwner(photo.project_id);
      await adminClient().rpc("amobla_account", { p_user: owner, p_trial: false });
      const { data: ids, error: reserveError } = await adminClient().rpc("amobla_reserve_demo_generation", {
        p_actor: owner,
        p_photo: photo.id,
        p_key: key,
        p_room: photo.room,
        p_style: style,
        p_mode: photo.mode,
        p_notes: "",
        p_prompt: buildDemoPrompt(photo.room, style, photo.mode, ""),
        p_daily_limit: DEMO_DAILY_LIMIT,
      });
      if (reserveError || !Array.isArray(ids)) throw new Error("PUBLIC_STAGING_RESERVE_FAILED");
      const deadline = started + maxDuration * 1000 - 5000;
      after(async () => {
        await Promise.allSettled((ids as string[]).map((job) => runJob(job, deadline)));
      });
      return Response.json({ ids, remaining: claim.remaining }, { status: 202, headers: NO_STORE });
    } catch (e) {
      // The staging did not start: the credit comes back.
      await adminClient().rpc("habita_public_staging_refund", { p_key: key });
      throw e;
    }
  } catch (e) {
    return failure(e);
  }
}

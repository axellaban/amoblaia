import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "@/lib/supabase/server";
import { HttpError, rpc } from "./http";
import { ProviderError, readPhoto, renderPhoto } from "./images";
import { freeAllows, buildPrompt } from "@/lib/catalog";
export const BUCKET = "property-images";
export type Job = {
  id: string;
  is_free: boolean;
  user_id: string;
  project_id: string;
  status: string;
  room: string;
  style: string;
  mode: string;
  notes: string;
  prompt: string;
  result_path: string | null;
  created_at: string;
  error_code: string | null;
};
/** Paid photos take priority; the lifetime free allowance is counted per result. */
export async function onFreeTier(userId: string) {
  const now = new Date().toISOString();
  const { data, error } = await adminClient()
    .from("credit_grants")
    .select("id")
    .eq("user_id", userId)
    .eq("revoked", false)
    .gt("remaining", 0)
    .not("source_key", "like", "trial:%")
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .limit(1);
  if (error) throw new Error("GRANT_LOOKUP_FAILED");
  return data.length === 0;
}
async function grantIsTrial(grantId: string | null) {
  if (!grantId) return false;
  const { data } = await adminClient()
    .from("credit_grants")
    .select("source_key")
    .eq("id", grantId)
    .maybeSingle();
  return Boolean(data?.source_key.startsWith("trial:"));
}
export async function enqueuePhoto(
  request: Request,
  userId: string,
  dailyLimit = Number(process.env.MAX_GENERATIONS_PER_DAY || 100),
) {
  if (!process.env.OPENAI_API_KEY)
    throw new HttpError(503, "La generación todavía no está habilitada.");
  const photo = await readPhoto(request);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      photo.requestKey,
    )
  )
    throw new HttpError(400, "Identificador de solicitud inválido.");
  const db = adminClient();
  const hash = createHash("sha256").update(photo.image).digest("hex");
  const path = `${userId}/${hash}/original.jpg`;
  let lookup = db
    .from("projects")
    .select("id,grant_id,trashed_at")
    .eq("user_id", userId)
    .is("deleted_at", null);
  lookup = photo.projectId
    ? lookup.eq("id", photo.projectId)
    : lookup.eq("original_hash", hash);
  let { data: project, error } = await lookup.maybeSingle();
  if (project?.trashed_at)
    throw new HttpError(
      409,
      "Esta foto está en la papelera. Restaurala desde Mis fotos para seguir creando.",
    );
  if (photo.projectId && !project)
    throw new HttpError(404, "No encontramos la foto original.");
  if (error) throw new Error("PROJECT_LOOKUP_FAILED");
  const free =
    project?.grant_id && !(await grantIsTrial(project.grant_id))
      ? false
      : await onFreeTier(userId);
  if (free && !freeAllows(photo.room, photo.mode))
    throw new HttpError(
      403,
      "Este ambiente y el retiro de muebles están incluidos en los planes pagos.",
    );
  if (!project?.grant_id) {
    const account = await rpc<{ credits: number }>("amobla_account", {
      p_user: userId,
      p_trial: false,
    });
    if (account.credits < 1 && !free)
      throw new HttpError(
        402,
        "No te quedan fotos disponibles. Elegí un plan.",
      );
  }
  // Set when this request stored the original, so a rejected batch can undo it.
  let created: { id: string; uploaded: boolean } | null = null;
  if (!project) {
    // Keep photos below the free bucket's 1 GB limit; the provider enforces a hard quota too.
    const { count: activeCount, error: capacityError } = await db
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("deleted_at", null);
    if (capacityError) throw new Error("PROJECT_CAPACITY_LOOKUP_FAILED");
    if ((activeCount || 0) >= Number(process.env.MAX_PROJECTS_PER_USER || 150))
      throw new HttpError(
        409,
        "Llegaste al límite de proyectos guardados. Borrá alguno para continuar.",
      );
    const upload = await db.storage
      .from(BUCKET)
      .upload(path, photo.image, { contentType: "image/jpeg", upsert: false });
    if (
      upload.error &&
      !["409", "Duplicate"].includes(String(upload.error.statusCode)) &&
      !/already exists/i.test(upload.error.message)
    )
      throw new HttpError(
        503,
        "No pudimos guardar la foto. Revisá el almacenamiento disponible.",
      );
    ({ data: project, error } = await db
      .from("projects")
      .insert({
        user_id: userId,
        original_hash: hash,
        original_path: path,
        original_bytes: photo.image.length,
        name: photo.name,
      })
      .select("id,grant_id,trashed_at")
      .single());
    if (!error && project)
      created = { id: project.id, uploaded: !upload.error };
    if (error?.code === "23505")
      ({ data: project, error } = await db
        .from("projects")
        .select("id,grant_id,trashed_at")
        .eq("user_id", userId)
        .eq("original_hash", hash)
        .is("deleted_at", null)
        .single());
    if (error || !project) throw new Error("PROJECT_CREATE_FAILED");
  }
  let ids: string[];
  try {
    ids = await rpc<string[]>("amobla_reserve_batch", {
      p_user: userId,
      p_project: project.id,
      p_key: photo.requestKey,
      p_room: photo.room,
      p_style: photo.style,
      p_mode: photo.mode,
      p_notes: photo.notes,
      p_prompts: Array.from({ length: photo.batchSize }, (_, i) =>
        photo.batchSize === 1
          ? photo.prompt
          : buildPrompt(
              photo.room,
              photo.style,
              photo.mode,
              photo.notes,
              i + 1,
            ),
      ),
      p_daily_limit: dailyLimit,
    });
  } catch (rejected) {
    // A batch refused for quota, capacity or an active batch must not leave an
    // empty project behind: it would count against the storage budget.
    if (created)
      await discardProject(created.id, created.uploaded ? path : null);
    throw rejected;
  }
  return { ids, projectId: project.id };
}
async function discardProject(id: string, path: string | null) {
  const db = adminClient();
  try {
    // Only an empty project is removed; a concurrent batch may have used it.
    const { count } = await db
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id);
    if (count !== 0) return;
    const { error } = await db.from("projects").delete().eq("id", id);
    if (!error && path) await db.storage.from(BUCKET).remove([path]);
  } catch {
    console.error("project_discard_failed", id);
  }
}
/** Time kept after the provider call to store, watermark and record a result. */
const FINISH_MARGIN_MS = 25000;
/**
 * Runs a queued job. `deadline` is when the hosting function will be killed:
 * the provider call is cut short to leave room to record the outcome, and a
 * job that cannot fit is left queued for the next poll instead of dying
 * mid-render (which would leave it 'running' with the provider maybe billed).
 */
export async function runJob(id: string, deadline?: number) {
  const providerBudget = deadline
    ? Math.min(240000, deadline - Date.now() - FINISH_MARGIN_MS)
    : 240000;
  if (providerBudget < 60000) return;
  const job = await rpc<Job | null>("amobla_claim_generation", { p_job: id });
  if (!job) return;
  const db = adminClient();
  let sent = false;
  try {
    const { data: project, error } = await db
      .from("projects")
      .select("original_path,grant_id")
      .eq("id", job.project_id)
      .single();
    if (error || !project) throw new Error("PROJECT_NOT_FOUND");
    const free = job.is_free;
    const file = await db.storage.from(BUCKET).download(project.original_path);
    if (file.error || !file.data) throw new Error("ORIGINAL_NOT_FOUND");
    sent = true;
    const rendered = await renderPhoto(
      Buffer.from(await file.data.arrayBuffer()),
      job.prompt,
      free,
      providerBudget,
    );
    await db
      .from("generations")
      .update({
        model: rendered.model,
        usage: rendered.usage,
        estimated_usd: rendered.cost,
        provider_request_id: rendered.requestId,
      })
      .eq("id", id);
    const resultPath = `${job.user_id}/${job.project_id}/${job.id}.jpg`;
    const stored = await db.storage
      .from(BUCKET)
      .upload(resultPath, rendered.result, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (stored.error) throw new ProviderError("RESULT_STORAGE_FAILED", true);
    await rpc("amobla_finish_generation", {
      p_job: id,
      p_status: "succeeded",
      p_result: resultPath,
      p_bytes: rendered.result.length,
      p_model: rendered.model,
      p_usage: rendered.usage,
      p_cost: rendered.cost,
      p_request: rendered.requestId,
    });
  } catch (error) {
    const uncertain = error instanceof ProviderError ? error.uncertain : sent;
    // A job left 'running' locks the account until swept: retry recording it.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await rpc("amobla_finish_generation", {
          p_job: id,
          p_status: uncertain ? "needs_review" : "failed",
          p_error:
            error instanceof ProviderError
              ? error.code
              : "INTERNAL_JOB_FAILURE",
        });
        return;
      } catch {
        if (attempt === 3) console.error("job_finish_failed", id);
        else await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }
}
export async function signPath(path: string) {
  const { data, error } = await adminClient()
    .storage.from(BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data) throw new Error("IMAGE_SIGNING_FAILED");
  return data.signedUrl;
}

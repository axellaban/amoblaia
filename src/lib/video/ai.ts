// The AI videos on the server (Fase 5C/5D): «Foto en movimiento» and
// «Recorrido cinematográfico». Starting one charges its credits, then sends
// each chosen photo to the provider; reading the property's videos moves
// them forward (each finished clip is copied to Habita's private storage).
// Once every clip is stored, the agency's browser joins them into the MP4,
// as it does with the «Clásico». A failed or stuck animation fails the
// video and gives the credits back, exactly once. Access is checked by the caller.
import "server-only";
import sharp from "sharp";
import { HttpError } from "@/lib/commerce/http";
import { validStyle } from "@/lib/demos/input";
import { adminImagePaths, previewDemo, renderImage } from "@/lib/demos/server";
import { adminClient } from "@/lib/supabase/server";
import { aiVideoLive, clipAspect, clipState, downloadClip, falEnabled, falModel, submitClip, type ClipAspect } from "./fal";
import { clipPrompt, isAiMode, isVideoFormat, MODE_INFO, photoCountProblem, VIDEO_CREDITS, VIDEO_SIZE, type AiMode, type VideoFormat } from "./plan";
import { readOptions, VIDEO_BUCKET, type VideoRow } from "./server";

/** An animation still unfinished after this long is failed and its credits given back (fal takes one or two minutes). */
export const AI_STALE_MS = 40 * 60 * 1000;
/** A photo the provider could not animate is sent once more before the video fails. */
export const MAX_ATTEMPTS = 2;
export const AI_PROVIDER = "fal";

export type ClipRow = {
  id: string;
  video_id: string;
  position: number;
  photo_id: string;
  staged: boolean;
  style: string | null;
  model: string;
  request_id: string | null;
  status_url: string | null;
  response_url: string | null;
  status: "pending" | "running" | "ready" | "failed";
  attempts: number;
  storage_path: string | null;
  duration_ms: number | null;
  error: string | null;
};

export const clipPath = (row: Pick<VideoRow, "agency_id" | "demo_id" | "id">, position: number) => `${row.agency_id}/${row.demo_id}/${row.id}/clip-${position}.mp4`;
const videoPath = (row: Pick<VideoRow, "agency_id" | "demo_id" | "id">) => `${row.agency_id}/${row.demo_id}/${row.id}.mp4`;
const now = () => new Date().toISOString();

/** The chosen photos as the studio shows them: each one of this property, with its first AI staging when stagings are used. */
export async function chosenPhotos(demoId: string, ids: string[], staged: boolean) {
  const demo = await previewDemo(demoId, { raw: true });
  const byId = new Map(demo.photos.map((p) => [p.id, p]));
  return ids.map((id) => {
    const photo = byId.get(id);
    if (!photo) throw new HttpError(409, "Una de las fotos elegidas ya no está en la propiedad. Revisá la selección.");
    const version = staged ? (photo.versions[0] ?? null) : null;
    return { id, staged: Boolean(version), style: version?.style ?? null };
  });
}

/** The photo the model animates: the same image the studio shows, as a JPEG in the clip's shape (16:9 or 9:16). */
async function sourceJpeg(clip: Pick<ClipRow, "photo_id" | "style">, aspect: ClipAspect) {
  const paths = await adminImagePaths({ photoId: clip.photo_id, style: validStyle(clip.style) ? clip.style : null });
  const image = paths ? await renderImage(paths.staged ?? paths.original, 1920) : null;
  if (!image) throw new Error("PHOTO_UNAVAILABLE");
  const [w, h] = aspect === "9:16" ? [1080, 1920] : [1920, 1080];
  return sharp(image).resize(w, h, { fit: "cover", position: "centre" }).jpeg({ quality: 86 }).toBuffer();
}

async function submit(clip: ClipRow, format: string) {
  const aspect = clipAspect(format);
  const req = await submitClip(await sourceJpeg(clip, aspect), clipPrompt(clip.position), clip.model, aspect);
  const { error } = await adminClient()
    .from("property_video_clips")
    .update({ status: "running", request_id: req.requestId, status_url: req.statusUrl, response_url: req.responseUrl, attempts: clip.attempts + 1, error: null, updated_at: now() })
    .eq("id", clip.id);
  if (error) throw new Error("VIDEO_CLIP_UPDATE_FAILED");
}

/** Fails a video that is still running and gives its credits back. True when this call failed it. */
export async function failAiVideo(row: Pick<VideoRow, "id">, reason: string) {
  const db = adminClient();
  const { data, error } = await db
    .from("property_videos")
    .update({ status: "failed", error: reason.slice(0, 300), updated_at: now() })
    .eq("id", row.id)
    .eq("status", "processing")
    .select("id");
  if (error) throw new Error("VIDEO_UPDATE_FAILED");
  await refund(row.id);
  return Boolean((data as unknown[] | null)?.length);
}

async function refund(videoId: string) {
  const { error } = await adminClient().rpc("habita_video_refund", { p_video: videoId });
  // Retried by the next read or the daily sweep: a failed video keeps credits_charged until it is refunded.
  if (error) console.error("video_refund_failed", videoId, error.message);
}

/** A new AI video: the row (idempotent by key), its credits charged, and each photo sent to be animated. */
export async function startAiVideo(input: {
  agencyId: string;
  demoId: string;
  actorId: string;
  payerId: string;
  key: unknown;
  mode: unknown;
  format: unknown;
  options: unknown;
}) {
  if (typeof input.key !== "string" || !/^[0-9a-f-]{36}$/i.test(input.key)) throw new HttpError(400, "Pedido inválido.");
  if (!isAiMode(input.mode)) throw new HttpError(400, "Modo de video desconocido.");
  if (!isVideoFormat(input.format)) throw new HttpError(400, "Formato desconocido.");
  const mode: AiMode = input.mode;
  const format: VideoFormat = input.format;
  const db = adminClient();
  const existing = await db.from("property_videos").select("*").eq("idempotency_key", input.key).maybeSingle();
  if (existing.error) throw new Error("VIDEO_LOOKUP_FAILED");
  const found = existing.data as VideoRow | null;
  if (found) {
    if (found.demo_id !== input.demoId || found.actor_id !== input.actorId) throw new HttpError(409, "Pedido inválido.");
    return { id: found.id, status: found.status, error: found.error, upload: null };
  }
  if (process.env.HABITA_VIDEO_AI?.trim() !== "1") throw new HttpError(409, "Ese modo de video todavía no está disponible.");
  if (!aiVideoLive()) throw new HttpError(503, "La animación con IA todavía no está habilitada.");
  const options = readOptions(input.options);
  if (!options) throw new HttpError(400, "Elegí las fotos del video.");
  const problem = photoCountProblem(mode, options.photos.length);
  if (problem) throw new HttpError(400, problem);
  const photos = await chosenPhotos(input.demoId, options.photos, options.staged);

  const created = await db
    .from("property_videos")
    .insert({
      agency_id: input.agencyId,
      demo_id: input.demoId,
      actor_id: input.actorId,
      idempotency_key: input.key,
      mode,
      format,
      status: "processing",
      photo_count: photos.length,
      animated_count: photos.length,
      provider: AI_PROVIDER,
      credits_charged: 0,
      width: VIDEO_SIZE[format].width,
      height: VIDEO_SIZE[format].height,
      options,
    })
    .select("*")
    .single();
  if (created.error) {
    if (/column|schema cache/i.test(created.error.message ?? "")) throw new HttpError(409, "Los videos con IA se habilitan al aplicar la migración 202611210001_video_ai.sql en Supabase.");
    throw new Error("VIDEO_CREATE_FAILED");
  }
  let row = created.data as VideoRow;
  const saved = await db.from("property_videos").update({ storage_path: videoPath(row) }).eq("id", row.id);
  if (saved.error) throw new Error("VIDEO_CREATE_FAILED");
  row = { ...row, storage_path: videoPath(row) };

  // The credits, before any provider cost. Without them, the video never existed.
  const credits = VIDEO_CREDITS[mode];
  const charged = await db.rpc("habita_video_charge", { p_payer: input.payerId, p_video: row.id, p_credits: credits });
  if (charged.error) {
    await db.from("property_videos").delete().eq("id", row.id);
    const text = charged.error.message ?? "";
    if (text.includes("NO_CREDITS")) throw new HttpError(402, `No te alcanzan los créditos: ${MODE_INFO[mode].name} usa ${credits}. Cargá más créditos para continuar.`);
    if (text.includes("ACCOUNT_BLOCKED")) throw new HttpError(403, "La cuenta que paga los créditos necesita una revisión. Contactá al equipo.");
    if (/function|does not exist/i.test(text)) throw new HttpError(409, "Los videos con IA se habilitan al aplicar la migración 202611210001_video_ai.sql en Supabase.");
    throw new Error("VIDEO_CHARGE_FAILED");
  }

  const model = falModel();
  const inserted = await db
    .from("property_video_clips")
    .insert(photos.map((p, position) => ({ video_id: row.id, position, photo_id: p.id, staged: p.staged, style: p.style, model, status: "pending" })))
    .select("*");
  if (inserted.error) {
    await failAiVideo(row, "No pudimos preparar la animación. Te devolvimos los créditos.");
    throw new Error("VIDEO_CLIPS_CREATE_FAILED");
  }
  const clips = ((inserted.data ?? []) as ClipRow[]).sort((a, b) => a.position - b.position);
  const sent = await Promise.allSettled(clips.map((c) => submit(c, format)));
  const firstFailure = sent.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (firstFailure) {
    console.error("video_ai_submit_failed", row.id, String(firstFailure.reason));
    const reason = "No pudimos empezar la animación con IA. Te devolvimos los créditos; probá de nuevo en unos minutos.";
    await failAiVideo(row, reason);
    return { id: row.id, status: "failed" as const, error: reason, upload: null };
  }
  return { id: row.id, status: "processing" as const, error: null, upload: null };
}

/**
 * Moves the running AI videos forward: asks the provider about each clip,
 * keeps the finished ones in storage, sends a failed photo once more, fails
 * (and refunds) what cannot finish, and gives back the credits of any failed
 * video that still holds them. Bounded by `deadline` so a page read stays quick.
 */
export async function advanceAiVideos(filter: { demoId?: string } = {}, deadline = Date.now() + 15_000) {
  const db = adminClient();
  let open = db.from("property_videos").select("*").eq("provider", AI_PROVIDER).eq("status", "processing").is("clips_ready_at", null);
  if (filter.demoId) open = open.eq("demo_id", filter.demoId);
  const { data, error } = await open.order("created_at").limit(10);
  if (error) {
    // Before 202611210001_video_ai.sql there are no AI videos to move.
    if (/column|schema cache|does not exist/i.test(error.message ?? "")) return;
    throw new Error("VIDEO_AI_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as (VideoRow & { clips_ready_at?: string | null })[]) {
    if (Date.now() > deadline) break;
    try {
      await advanceOne(row, deadline);
    } catch (e) {
      console.error("video_ai_advance_failed", row.id, e instanceof Error ? e.message : String(e));
    }
  }
  let held = db.from("property_videos").select("id").eq("provider", AI_PROVIDER).in("status", ["failed", "cancelled"]).gt("credits_charged", 0);
  if (filter.demoId) held = held.eq("demo_id", filter.demoId);
  const owed = await held.limit(10);
  for (const r of (owed.data ?? []) as { id: string }[]) await refund(r.id);
}

async function advanceOne(row: VideoRow, deadline: number) {
  const db = adminClient();
  if (Date.now() - new Date(row.created_at).getTime() > AI_STALE_MS) {
    await failAiVideo(row, "La animación con IA tardó demasiado. Te devolvimos los créditos.");
    return;
  }
  const { data, error } = await db.from("property_video_clips").select("*").eq("video_id", row.id).order("position");
  if (error) throw new Error("VIDEO_CLIPS_LOOKUP_FAILED");
  const clips = (data ?? []) as ClipRow[];
  if (!clips.length) {
    await failAiVideo(row, "No pudimos preparar la animación. Te devolvimos los créditos.");
    return;
  }
  if (!falEnabled()) return; // Without the key nothing can be asked; the stale rule above still applies.
  for (const clip of clips) {
    if (Date.now() > deadline) return;
    if (clip.status === "ready") continue;
    if (clip.status === "pending" || clip.status === "failed") {
      if (clip.attempts >= MAX_ATTEMPTS) {
        await failAiVideo(row, "No pudimos animar una de las fotos. Te devolvimos los créditos; probá con otra foto.");
        return;
      }
      await submit(clip, row.format);
      continue;
    }
    if (!clip.status_url || !clip.response_url) continue;
    const state = await clipState({ statusUrl: clip.status_url, responseUrl: clip.response_url });
    if (state.state === "pending") continue;
    if (state.state === "failed") {
      await db.from("property_video_clips").update({ status: "failed", error: state.reason.slice(0, 300), updated_at: now() }).eq("id", clip.id).eq("status", "running");
      clip.status = "failed";
      if (clip.attempts >= MAX_ATTEMPTS) {
        await failAiVideo(row, "No pudimos animar una de las fotos. Te devolvimos los créditos; probá con otra foto.");
        return;
      }
      await submit(clip, row.format);
      continue;
    }
    const bytes = await downloadClip(state.url);
    const path = clipPath(row, clip.position);
    const up = await db.storage.from(VIDEO_BUCKET).upload(path, bytes, { contentType: "video/mp4", upsert: true });
    if (up.error) throw new Error("VIDEO_CLIP_STORE_FAILED");
    const done = await db
      .from("property_video_clips")
      .update({ status: "ready", storage_path: path, duration_ms: state.durationMs, error: null, updated_at: now() })
      .eq("id", clip.id)
      .eq("status", "running");
    if (done.error) throw new Error("VIDEO_CLIP_UPDATE_FAILED");
    clip.status = "ready";
  }
  if (clips.every((c) => c.status === "ready")) {
    const ready = await db.from("property_videos").update({ clips_ready_at: now(), updated_at: now() }).eq("id", row.id).eq("status", "processing");
    if (ready.error) throw new Error("VIDEO_UPDATE_FAILED");
  }
}

/** Where the joined MP4 of an AI video goes, once its clips are stored. */
export async function aiUploadTarget(demoId: string, id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Video inválido.");
  const db = adminClient();
  const { data, error } = await db.from("property_videos").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("VIDEO_LOOKUP_FAILED");
  const row = data as (VideoRow & { clips_ready_at?: string | null }) | null;
  if (!row || row.demo_id !== demoId) throw new HttpError(404, "No encontramos el video.");
  if (row.provider !== AI_PROVIDER || row.status !== "processing") throw new HttpError(409, "Este video no espera ser armado.");
  if (!row.clips_ready_at) throw new HttpError(409, "La IA todavía está animando las fotos.");
  const path = row.storage_path ?? videoPath(row);
  const upload = await db.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (upload.error || !upload.data) throw new Error("VIDEO_UPLOAD_URL_FAILED");
  return { id: row.id, upload: { path: upload.data.path, token: upload.data.token, bucket: VIDEO_BUCKET } };
}

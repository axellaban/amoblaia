// fal.ai, the provider that animates a photo into a short clip (Fase 5C).
// Its queue is used over plain HTTPS: submit, ask for the status, read the
// result. Only fal's own addresses are ever called with the key or
// downloaded from. The model is chosen by configuration, so a better or
// cheaper one replaces it without touching the rest of Habita.
import "server-only";
import { CLIP_SECONDS } from "./plan";

/**
 * Kling 2.6 Pro: USD 0.07 per second without sound (5 s ≈ USD 0.35). Chosen
 * after the quality test of 03/11/2026 with real photos: it keeps the room as
 * it is, while LTX-2.3 Fast (USD 0.04/s) invented spaces and changed the light.
 * Its clip keeps the shape of the photo, which is cropped to the clip's first.
 */
export const DEFAULT_MODEL = "fal-ai/kling-video/v2.6/pro/image-to-video";
/** The clip's shape: vertical for the vertical formats, horizontal otherwise. */
export type ClipAspect = "16:9" | "9:16";
export const clipAspect = (format: string): ClipAspect => (format === "9:16" || format === "4:5" ? "9:16" : "16:9");
export const falModel = () => (process.env.FAL_VIDEO_MODEL || DEFAULT_MODEL).trim();
export const falEnabled = () => Boolean(process.env.FAL_KEY?.trim());
/**
 * Whether agencies can start AI videos: the key AND HABITA_VIDEO_AI=1. Until
 * then the AI modes show «Próximamente» and only the «Clásico» is used; the
 * key alone lets the team test fal without opening the modes to anyone.
 */
export const aiVideoLive = () => falEnabled() && process.env.HABITA_VIDEO_AI?.trim() === "1";
const QUEUE = "https://queue.fal.run/";
/** A clip is a few MB; anything far bigger is not one. */
export const MAX_CLIP_BYTES = 80 * 1024 * 1024;

export type FalRequest = { requestId: string; statusUrl: string; responseUrl: string };
export type FalState = { state: "pending" } | { state: "done"; url: string; durationMs: number | null } | { state: "failed"; reason: string };

export class FalError extends Error {}

const isQueueUrl = (u: unknown): u is string => typeof u === "string" && u.startsWith(QUEUE) && !u.includes("..");
/** Where fal serves its files (e.g. https://v3b.fal.media/files/…). Nothing else is downloaded. */
export function isFalMedia(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /(^|\.)fal\.(media|run|ai)$/.test(url.hostname);
  } catch {
    return false;
  }
}

function headers() {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new FalError("FAL_KEY_MISSING");
  return { Authorization: `Key ${key}`, "Content-Type": "application/json", Accept: "application/json" };
}

/** What the model receives: the photo (a JPEG as a data URI, never a public link) and the camera move. */
export function clipInput(model: string, jpeg: Buffer, prompt: string, aspect: ClipAspect = "16:9") {
  const image = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  // Kling takes the photo as start_image_url and keeps its shape (the photo is already cropped to the clip's).
  if (model.includes("kling-video"))
    return { start_image_url: image, prompt, duration: "5", negative_prompt: "blur, distort, low quality, new objects, people, text", generate_audio: false };
  const input: Record<string, unknown> = { image_url: image, prompt };
  if (model.includes("ltx-2.3")) Object.assign(input, { duration: CLIP_SECONDS, resolution: "1080p", aspect_ratio: aspect, fps: 25, generate_audio: false });
  else if (model.includes("ltx-2")) Object.assign(input, { duration: CLIP_SECONDS, resolution: "1080p", aspect_ratio: "16:9", fps: 25, generate_audio: false });
  // Other image-to-video models (Wan…) take a 5-second string.
  else Object.assign(input, { duration: "5" });
  return input;
}

/** Sends one photo to the queue. fal keeps neither the request's data nor, after a day, the clip. */
export async function submitClip(jpeg: Buffer, prompt: string, model = falModel(), aspect: ClipAspect = "16:9"): Promise<FalRequest> {
  if (!/^[a-z0-9-]+\/[a-z0-9./-]+$/i.test(model) || model.includes("..")) throw new FalError("FAL_MODEL_INVALID");
  const res = await fetch(`${QUEUE}${model}`, {
    method: "POST",
    headers: { ...headers(), "X-Fal-Store-IO": "0", "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: 86400 }) },
    body: JSON.stringify(clipInput(model, jpeg, prompt, aspect)),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) throw new FalError(`FAL_SUBMIT_${res.status}`);
  const { request_id, status_url, response_url } = body;
  if (typeof request_id !== "string" || !isQueueUrl(status_url) || !isQueueUrl(response_url)) throw new FalError("FAL_SUBMIT_INVALID");
  return { requestId: request_id, statusUrl: status_url, responseUrl: response_url };
}

/** The result's video, read leniently: fal's models answer { video: { url, duration } }. */
export function readResult(body: unknown): { url: string; durationMs: number | null } | null {
  const video = (body as { video?: { url?: unknown; duration?: unknown } } | null)?.video;
  if (!video || !isFalMedia(video.url)) return null;
  const seconds = Number(video.duration);
  return { url: video.url, durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null };
}

/** Where a request is: still in the queue or running, done (with its clip) or failed (with why). */
export async function clipState(req: Pick<FalRequest, "statusUrl" | "responseUrl">): Promise<FalState> {
  if (!isQueueUrl(req.statusUrl) || !isQueueUrl(req.responseUrl)) return { state: "failed", reason: "FAL_URL_INVALID" };
  const res = await fetch(req.statusUrl, { headers: headers(), signal: AbortSignal.timeout(15_000) });
  if (res.status >= 500 || res.status === 429) return { state: "pending" }; // fal is busy: asked again later.
  const status = (await res.json().catch(() => null)) as { status?: string; error?: unknown } | null;
  if (!res.ok || !status) return { state: "failed", reason: `FAL_STATUS_${res.status}` };
  if (status.status !== "COMPLETED") return { state: "pending" };
  if (status.error) return { state: "failed", reason: String(status.error).slice(0, 200) };
  const result = await fetch(req.responseUrl, { headers: headers(), signal: AbortSignal.timeout(15_000) });
  if (result.status >= 500) return { state: "pending" };
  const body = await result.json().catch(() => null);
  if (!result.ok) return { state: "failed", reason: `FAL_RESULT_${result.status}` };
  const video = readResult(body);
  return video ? { state: "done", ...video } : { state: "failed", reason: "FAL_RESULT_WITHOUT_VIDEO" };
}

/** The clip's MP4, from fal's storage, to keep it in Habita's (fal deletes its copy). */
export async function downloadClip(url: string): Promise<Buffer> {
  if (!isFalMedia(url)) throw new FalError("FAL_URL_INVALID");
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new FalError(`FAL_DOWNLOAD_${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_CLIP_BYTES) throw new FalError("FAL_CLIP_TOO_LARGE");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_CLIP_BYTES) throw new FalError("FAL_CLIP_INVALID");
  return bytes;
}

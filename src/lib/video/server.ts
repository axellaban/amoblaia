// The videos of a property, on the server: create one (with the address its
// MP4 is uploaded to), confirm it once the file is really in storage, list
// them with short-lived links. Access is checked by the caller
// (requireDemoAccess). Nothing stays "processing" forever.
import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { formatOf, INFO_FIELDS, isVideoFormat, MAX_VIDEO_PHOTOS, VIDEO_MODES, VIDEO_SIZE, type InfoField, type VideoFormat, type VideoMode } from "./plan";

export const VIDEO_BUCKET = "property-videos";
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** A video still rendering after this long was abandoned (tab closed, network lost): it is failed, not left hanging. */
export const STALE_MS = 30 * 60 * 1000;
/** Modes live today: the montage. AI modes are enabled with their provider (Fase 5C/5D). */
export const LIVE_MODES: VideoMode[] = ["classic"];

export type VideoRow = {
  id: string;
  agency_id: string;
  demo_id: string;
  actor_id: string;
  idempotency_key: string;
  mode: VideoMode;
  format: VideoFormat;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  photo_count: number;
  animated_count: number;
  provider: string;
  credits_charged: number;
  storage_path: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /** Added by 202611200001_video_formats.sql: the file's real size and how it was made. */
  width?: number | null;
  height?: number | null;
  options?: unknown;
  /** Added by 202611210001_video_ai.sql: who paid an AI video, and when all its clips were stored. */
  payer_id?: string | null;
  clips_ready_at?: string | null;
};

/**
 * How a video was made, so another format can be exported later from the same
 * photos without choosing them again: the photos in order, whether AI stagings
 * were used, and which information it carries. Ids and switches only.
 */
export type VideoOptions = { photos: string[]; staged: boolean; info: boolean; fields: InfoField[] };

export function readOptions(raw: unknown): VideoOptions | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const photos = Array.isArray(v.photos) ? v.photos.filter((p): p is string => typeof p === "string" && /^[0-9a-f-]{36}$/i.test(p)).slice(0, MAX_VIDEO_PHOTOS) : [];
  if (!photos.length) return null;
  const fields = Array.isArray(v.fields) ? [...new Set(v.fields)].filter((f): f is InfoField => INFO_FIELDS.includes(f as InfoField)) : [];
  return { photos, staged: v.staged !== false, info: v.info === true, fields };
}

export type PublicVideo = {
  id: string;
  mode: VideoMode;
  format: VideoFormat;
  status: VideoRow["status"];
  /** The exported file's real size. */
  width: number;
  height: number;
  options: VideoOptions | null;
  photoCount: number;
  durationMs: number | null;
  sizeBytes: number | null;
  createdAt: string;
  error: string | null;
  /** Short-lived links, only for completed videos. */
  url: string | null;
  downloadUrl: string | null;
  /** Credits it took (0 for the «Clásico», and once an AI video's credits were given back). */
  credits: number;
  /**
   * An AI video still being made: the provider animating its photos, or every
   * clip stored and waiting for a browser to join them (with short links to them).
   */
  ai: { stage: "animating" | "joining"; done: number; total: number; clips: { url: string; staged: boolean }[] | null } | null;
};

const pathOf = (row: Pick<VideoRow, "agency_id" | "demo_id" | "id">) => `${row.agency_id}/${row.demo_id}/${row.id}.mp4`;

/** A new video: the row (idempotent by key) and the signed address its MP4 goes to, straight from the browser. */
export async function createVideo(input: {
  agencyId: string;
  demoId: string;
  actorId: string;
  key: unknown;
  mode: unknown;
  format: unknown;
  photoCount: unknown;
  options?: unknown;
}) {
  if (typeof input.key !== "string" || !/^[0-9a-f-]{36}$/i.test(input.key)) throw new HttpError(400, "Pedido inválido.");
  if (!VIDEO_MODES.includes(input.mode as VideoMode)) throw new HttpError(400, "Modo de video desconocido.");
  if (!LIVE_MODES.includes(input.mode as VideoMode)) throw new HttpError(409, "Ese modo de video todavía no está disponible.");
  if (!isVideoFormat(input.format)) throw new HttpError(400, "Formato desconocido.");
  const count = Number(input.photoCount);
  if (!Number.isInteger(count) || count < 1 || count > 30) throw new HttpError(400, "Elegí entre 1 y 30 fotos.");
  const db = adminClient();
  const existing = await db.from("property_videos").select("*").eq("idempotency_key", input.key).maybeSingle();
  if (existing.error) throw new Error("VIDEO_LOOKUP_FAILED");
  let row = existing.data as VideoRow | null;
  if (row && (row.demo_id !== input.demoId || row.actor_id !== input.actorId)) throw new HttpError(409, "Pedido inválido.");
  if (!row) {
    const format = input.format as VideoFormat;
    const base = {
      agency_id: input.agencyId,
      demo_id: input.demoId,
      actor_id: input.actorId,
      idempotency_key: input.key,
      mode: input.mode,
      format,
      status: "processing",
      photo_count: count,
      provider: "browser",
      credits_charged: 0,
    };
    const options = readOptions(input.options);
    let created = await db
      .from("property_videos")
      .insert({ ...base, width: VIDEO_SIZE[format].width, height: VIDEO_SIZE[format].height, options: options ?? {} })
      .select("*")
      .single();
    // Before 202611200001_video_formats.sql: the original two formats still work, without the extra columns.
    if (created.error && (format === "9:16" || format === "16:9") && /column|schema cache/i.test(created.error.message ?? ""))
      created = await db.from("property_videos").insert(base).select("*").single();
    if (created.error) {
      if (/check|constraint/i.test(created.error.message ?? "") || created.error.code === "23514" || /column/i.test(created.error.message ?? ""))
        throw new HttpError(409, "Los formatos 4:5 y 1:1 se habilitan al aplicar la migración 202611200001_video_formats.sql en Supabase.");
      throw new Error("VIDEO_CREATE_FAILED");
    }
    row = created.data as VideoRow;
    const path = pathOf(row);
    const saved = await db.from("property_videos").update({ storage_path: path }).eq("id", row.id);
    if (saved.error) throw new Error("VIDEO_CREATE_FAILED");
    row = { ...row, storage_path: path };
  }
  if (row.status !== "processing") return { id: row.id, status: row.status, upload: null };
  const upload = await db.storage.from(VIDEO_BUCKET).createSignedUploadUrl(row.storage_path ?? pathOf(row), { upsert: true });
  if (upload.error || !upload.data) throw new Error("VIDEO_UPLOAD_URL_FAILED");
  return { id: row.id, status: row.status, upload: { path: upload.data.path, token: upload.data.token, bucket: VIDEO_BUCKET } };
}

async function rowOf(id: unknown, demoId: string) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Video inválido.");
  const { data, error } = await adminClient().from("property_videos").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("VIDEO_LOOKUP_FAILED");
  const row = data as VideoRow | null;
  if (!row || row.demo_id !== demoId) throw new HttpError(404, "No encontramos el video.");
  return row;
}

/** The browser finished: completed only if the MP4 is really in storage and within the limit; otherwise failed with the reason. */
export async function finishVideo(input: { demoId: string; id: unknown; ok: unknown; durationMs: unknown; error: unknown }) {
  const row = await rowOf(input.id, input.demoId);
  if (row.status !== "processing") return row;
  const db = adminClient();
  const now = new Date().toISOString();
  if (row.provider !== "browser") {
    // An AI video: its clips are paid and stored, so a failed join is only noted and can be retried.
    if (!row.clips_ready_at) {
      if (input.ok === true) throw new HttpError(409, "La IA todavía está animando las fotos.");
      return row;
    }
    if (input.ok !== true) {
      const reason = typeof input.error === "string" ? input.error.slice(0, 300) : "No se pudo armar el video.";
      const { data, error } = await db.from("property_videos").update({ error: reason, updated_at: now }).eq("id", row.id).eq("status", "processing").select("*").maybeSingle();
      if (error) throw new Error("VIDEO_UPDATE_FAILED");
      return (data as VideoRow | null) ?? row;
    }
  }
  if (input.ok !== true) {
    const reason = typeof input.error === "string" ? input.error.slice(0, 300) : "No se pudo crear el video.";
    const { data, error } = await db.from("property_videos").update({ status: "failed", error: reason, updated_at: now }).eq("id", row.id).eq("status", "processing").select("*").maybeSingle();
    if (error) throw new Error("VIDEO_UPDATE_FAILED");
    return (data as VideoRow | null) ?? row;
  }
  const path = row.storage_path ?? pathOf(row);
  const folder = path.split("/").slice(0, -1).join("/");
  const name = path.split("/").pop()!;
  const listed = await db.storage.from(VIDEO_BUCKET).list(folder, { search: name, limit: 5 });
  const file = (listed.data ?? []).find((f) => f.name === name) as { metadata?: { size?: number; mimetype?: string } } | undefined;
  const size = Number(file?.metadata?.size ?? 0);
  if (listed.error || !file || !size) throw new HttpError(409, "El video todavía no terminó de subirse. Probá de nuevo.");
  if (size > MAX_VIDEO_BYTES) throw new HttpError(413, "El video es demasiado grande.");
  const duration = Number(input.durationMs);
  const { data, error } = await db
    .from("property_videos")
    .update({ status: "completed", size_bytes: size, duration_ms: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null, updated_at: now, completed_at: now, error: null })
    .eq("id", row.id)
    .eq("status", "processing")
    .select("*")
    .maybeSingle();
  if (error) throw new Error("VIDEO_UPDATE_FAILED");
  return (data as VideoRow | null) ?? row;
}

/** The property's videos, newest first, with links that expire in an hour. Abandoned renders are failed here. */
export async function listVideos(demoId: string, fileName: (row: VideoRow) => string): Promise<PublicVideo[]> {
  const db = adminClient();
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  // Only browser renders are abandoned this way; AI videos have their own rules (ai.ts).
  await db
    .from("property_videos")
    .update({ status: "failed", error: "El video no terminó de crearse (se cerró la página o se cortó la conexión).", updated_at: new Date().toISOString() })
    .eq("demo_id", demoId)
    .eq("provider", "browser")
    .in("status", ["queued", "processing"])
    .lt("updated_at", stale);
  const { data, error } = await db.from("property_videos").select("*").eq("demo_id", demoId).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error("VIDEO_LIST_FAILED");
  const rows = (data ?? []) as VideoRow[];
  return Promise.all(
    rows.map(async (r) => {
      const ai = r.provider !== "browser" && r.status === "processing" ? await aiProgress(r) : null;
      let url: string | null = null;
      let downloadUrl: string | null = null;
      if (r.status === "completed" && r.storage_path) {
        const [view, download] = await Promise.all([
          db.storage.from(VIDEO_BUCKET).createSignedUrl(r.storage_path, 3600),
          db.storage.from(VIDEO_BUCKET).createSignedUrl(r.storage_path, 3600, { download: fileName(r) }),
        ]);
        url = view.data?.signedUrl ?? null;
        downloadUrl = download.data?.signedUrl ?? null;
      }
      const format = formatOf(r.format);
      return {
        id: r.id,
        mode: r.mode,
        format,
        status: r.status,
        width: r.width ?? VIDEO_SIZE[format].width,
        height: r.height ?? VIDEO_SIZE[format].height,
        options: readOptions(r.options),
        photoCount: r.photo_count,
        durationMs: r.duration_ms,
        sizeBytes: r.size_bytes,
        createdAt: r.created_at,
        error: r.error,
        url,
        downloadUrl,
        credits: r.credits_charged ?? 0,
        ai,
      };
    }),
  );
}

/** How far an AI video is: clips animated so far and, once all are stored, links to them for the browser that joins them. */
async function aiProgress(r: VideoRow): Promise<PublicVideo["ai"]> {
  const db = adminClient();
  const { data, error } = await db.from("property_video_clips").select("position,status,staged,storage_path").eq("video_id", r.id).order("position");
  if (error) return { stage: "animating", done: 0, total: r.photo_count, clips: null };
  const clips = (data ?? []) as { position: number; status: string; staged: boolean; storage_path: string | null }[];
  const done = clips.filter((c) => c.status === "ready").length;
  if (!r.clips_ready_at || done !== clips.length || !clips.length) return { stage: "animating", done, total: clips.length || r.photo_count, clips: null };
  const links = await Promise.all(clips.map((c) => (c.storage_path ? db.storage.from(VIDEO_BUCKET).createSignedUrl(c.storage_path, 3600) : null)));
  const urls = links.map((l) => l?.data?.signedUrl ?? null);
  if (urls.some((u) => !u)) return { stage: "animating", done, total: clips.length, clips: null };
  return { stage: "joining", done, total: clips.length, clips: clips.map((c, i) => ({ url: urls[i]!, staged: c.staged })) };
}


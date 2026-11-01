// The videos of a property, on the server: create one (with the address its
// MP4 is uploaded to), confirm it once the file is really in storage, list
// them with short-lived links. Access is checked by the caller
// (requireDemoAccess). Nothing stays "processing" forever.
import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { VIDEO_FORMATS, VIDEO_MODES, type VideoFormat, type VideoMode } from "./plan";

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
};

export type PublicVideo = {
  id: string;
  mode: VideoMode;
  format: VideoFormat;
  status: VideoRow["status"];
  photoCount: number;
  durationMs: number | null;
  sizeBytes: number | null;
  createdAt: string;
  error: string | null;
  /** Short-lived links, only for completed videos. */
  url: string | null;
  downloadUrl: string | null;
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
}) {
  if (typeof input.key !== "string" || !/^[0-9a-f-]{36}$/i.test(input.key)) throw new HttpError(400, "Pedido inválido.");
  if (!VIDEO_MODES.includes(input.mode as VideoMode)) throw new HttpError(400, "Modo de video desconocido.");
  if (!LIVE_MODES.includes(input.mode as VideoMode)) throw new HttpError(409, "Ese modo de video todavía no está disponible.");
  if (!VIDEO_FORMATS.includes(input.format as VideoFormat)) throw new HttpError(400, "Formato desconocido.");
  const count = Number(input.photoCount);
  if (!Number.isInteger(count) || count < 1 || count > 30) throw new HttpError(400, "Elegí entre 1 y 30 fotos.");
  const db = adminClient();
  const existing = await db.from("property_videos").select("*").eq("idempotency_key", input.key).maybeSingle();
  if (existing.error) throw new Error("VIDEO_LOOKUP_FAILED");
  let row = existing.data as VideoRow | null;
  if (row && (row.demo_id !== input.demoId || row.actor_id !== input.actorId)) throw new HttpError(409, "Pedido inválido.");
  if (!row) {
    const created = await db
      .from("property_videos")
      .insert({
        agency_id: input.agencyId,
        demo_id: input.demoId,
        actor_id: input.actorId,
        idempotency_key: input.key,
        mode: input.mode,
        format: input.format,
        status: "processing",
        photo_count: count,
        provider: "browser",
        credits_charged: 0,
      })
      .select("*")
      .single();
    if (created.error) throw new Error("VIDEO_CREATE_FAILED");
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
  await db
    .from("property_videos")
    .update({ status: "failed", error: "El video no terminó de crearse (se cerró la página o se cortó la conexión).", updated_at: new Date().toISOString() })
    .eq("demo_id", demoId)
    .in("status", ["queued", "processing"])
    .lt("updated_at", stale);
  const { data, error } = await db.from("property_videos").select("*").eq("demo_id", demoId).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error("VIDEO_LIST_FAILED");
  const rows = (data ?? []) as VideoRow[];
  return Promise.all(
    rows.map(async (r) => {
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
      return {
        id: r.id,
        mode: r.mode,
        format: r.format,
        status: r.status,
        photoCount: r.photo_count,
        durationMs: r.duration_ms,
        sizeBytes: r.size_bytes,
        createdAt: r.created_at,
        error: r.error,
        url,
        downloadUrl,
      };
    }),
  );
}

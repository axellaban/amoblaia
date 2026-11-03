// The videos' music library and the files agencies upload for their videos
// (songs and logos), on the server. The library is generated once by the
// team with fal's music model and kept in Habita's private storage; every
// link handed out is short-lived. Access is checked by the caller.
import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { FalError, falEnabled, isFalMedia } from "./fal";
import {
  isMediaPath,
  LIBRARY_FOLDER,
  LOGO_TYPES,
  MAX_LOGO_BYTES,
  MAX_MUSIC_BYTES,
  MEDIA_BUCKET,
  MUSIC_TRACKS,
  MUSIC_TYPES,
  trackOf,
  type LibraryTrack,
} from "./media";

/** Google's Lyria 2 on fal: 30 s of instrumental music at 48 kHz (WAV), a few cents each. Replaceable by configuration. */
export const DEFAULT_MUSIC_MODEL = "fal-ai/lyria2";
export const musicModel = () => (process.env.FAL_MUSIC_MODEL || DEFAULT_MUSIC_MODEL).trim();
const RUN = "https://fal.run/";
const MISSING_BUCKET = "Falta aplicar la migración 202611220001_video_media.sql en Supabase.";

const extOf = (type: string) => MUSIC_TYPES[type] ?? (type.includes("mpeg") ? "mp3" : "wav");
const typeOfExt = (ext: string) => ({ mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav" })[ext] ?? "audio/wav";

/** The library's files in storage: track id → file name (library/<id>.<ext>). */
async function libraryFiles() {
  const { data, error } = await adminClient().storage.from(MEDIA_BUCKET).list(LIBRARY_FOLDER, { limit: 200 });
  if (error) return new Map<string, string>();
  const files = new Map<string, string>();
  for (const f of data ?? []) {
    const id = f.name.replace(/\.[a-z0-9]+$/i, "");
    if (trackOf(id) && Number((f.metadata as { size?: number } | null)?.size ?? 1) > 0) files.set(id, f.name);
  }
  return files;
}

/** The tracks already generated, in the catalog's order, each with a link that expires in an hour. */
export async function libraryTracks(): Promise<LibraryTrack[]> {
  const files = await libraryFiles();
  const ready = MUSIC_TRACKS.filter((t) => files.has(t.id));
  if (!ready.length) return [];
  const { data, error } = await adminClient()
    .storage.from(MEDIA_BUCKET)
    .createSignedUrls(
      ready.map((t) => `${LIBRARY_FOLDER}/${files.get(t.id)}`),
      3600,
    );
  if (error || !data) return [];
  return ready.flatMap((t, i) => (data[i]?.signedUrl ? [{ ...t, url: data[i].signedUrl }] : []));
}

/** The catalog for the team: which tracks exist, and whether fal can make the rest. */
export async function libraryStatus() {
  const files = await libraryFiles();
  return { model: musicModel(), enabled: falEnabled(), tracks: MUSIC_TRACKS.map((t) => ({ id: t.id, genre: t.genre, name: t.name, ready: files.has(t.id) })) };
}

/** The audio of fal's answer, read leniently: { audio: { url, content_type } } (or audio_file). */
export function readAudio(body: unknown): { url: string; type: string } | null {
  const b = body as { audio?: { url?: unknown; content_type?: unknown }; audio_file?: { url?: unknown; content_type?: unknown } } | null;
  const audio = b?.audio ?? b?.audio_file;
  if (!audio || !isFalMedia(audio.url)) return null;
  return { url: audio.url, type: typeof audio.content_type === "string" ? audio.content_type : "audio/wav" };
}

/** Generates one track of the library with fal (a synchronous call of up to two minutes) and keeps it in storage. */
export async function generateTrack(id: unknown) {
  const track = trackOf(id);
  if (!track) throw new HttpError(400, "Pista desconocida.");
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new HttpError(409, "Falta cargar FAL_KEY en Vercel.");
  const model = musicModel();
  if (!/^[a-z0-9-]+\/[a-z0-9./-]+$/i.test(model) || model.includes("..")) throw new FalError("FAL_MODEL_INVALID");
  const res = await fetch(`${RUN}${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json", Accept: "application/json", "X-Fal-Store-IO": "0" },
    body: JSON.stringify({ prompt: track.prompt, negative_prompt: "vocals, singing, lyrics, speech, harsh noise, distortion, low quality" }),
    signal: AbortSignal.timeout(110_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(502, `fal respondió ${res.status} al generar «${track.name}».`);
  const audio = readAudio(body);
  if (!audio) throw new HttpError(502, `fal no devolvió audio para «${track.name}».`);
  const file = await fetch(audio.url, { signal: AbortSignal.timeout(60_000) });
  if (!file.ok) throw new HttpError(502, "No pudimos descargar la pista de fal.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_MUSIC_BYTES) throw new HttpError(502, "La pista generada no es válida.");
  const ext = extOf(audio.type);
  const up = await adminClient()
    .storage.from(MEDIA_BUCKET)
    .upload(`${LIBRARY_FOLDER}/${track.id}.${ext}`, bytes, { contentType: typeOfExt(ext), upsert: true });
  if (up.error) throw new HttpError(500, /bucket/i.test(up.error.message ?? "") ? MISSING_BUCKET : "No pudimos guardar la pista.");
  return { id: track.id, ready: true };
}

/** Where the agency's browser uploads a song or a logo for this property's videos: <agency>/<demo>/<uuid>.<ext>. */
export async function mediaUploadTarget(input: { agencyId: string; demoId: string; kind: unknown; type: unknown; size: unknown }) {
  const types = input.kind === "music" ? MUSIC_TYPES : input.kind === "watermark" ? LOGO_TYPES : null;
  if (!types) throw new HttpError(400, "Archivo inválido.");
  const ext = typeof input.type === "string" ? types[input.type] : undefined;
  if (!ext) throw new HttpError(415, input.kind === "music" ? "Subí la canción en MP3, M4A o WAV." : "Subí el logo en PNG, JPG o WebP.");
  const size = Number(input.size);
  const max = input.kind === "music" ? MAX_MUSIC_BYTES : MAX_LOGO_BYTES;
  if (!Number.isFinite(size) || size <= 0 || size > max) throw new HttpError(413, input.kind === "music" ? "La canción puede pesar hasta 15 MB." : "El logo puede pesar hasta 3 MB.");
  const path = `${input.agencyId}/${input.demoId}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await adminClient().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new HttpError(500, /bucket/i.test(error?.message ?? "") ? MISSING_BUCKET : "No pudimos preparar la subida.");
  return { path: data.path, token: data.token, bucket: MEDIA_BUCKET };
}

/** A short link to one of this property's uploaded files (never another agency's or property's). */
export async function mediaUrl(input: { agencyId: string; demoId: string; path: unknown }) {
  if (!isMediaPath(input.path) || !input.path.startsWith(`${input.agencyId}/${input.demoId}/`)) throw new HttpError(404, "No encontramos el archivo.");
  const { data, error } = await adminClient().storage.from(MEDIA_BUCKET).createSignedUrl(input.path, 3600);
  if (error || !data?.signedUrl) throw new HttpError(404, "No encontramos el archivo. Volvé a subirlo.");
  return data.signedUrl;
}

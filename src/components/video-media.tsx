"use client";
// «Música de fondo» and «Marca de agua» in «Crear video»: the same shape as
// «Texto del video» (a switch, then its options). The music comes from
// Habita's library (generated once with fal) or a song the agency uploads;
// the watermark is the profile's logo or an uploaded one, in a corner.
// Uploaded files go to Habita's private storage, so an AI video joined later
// (or another format exported from it) keeps them.
import { useEffect, useRef, useState } from "react";
import { Loader2, Music, Pause, Play, Shuffle, Upload, X } from "lucide-react";
import { ApiError, api } from "./admin-demos";
import { browserClient } from "@/lib/supabase/client";
import {
  CORNER_LABEL,
  CORNERS,
  GENRE_LABEL,
  LOGO_TYPES,
  MUSIC_GENRES,
  MUSIC_TYPES,
  trackOf,
  type LibraryTrack,
  type MusicGenre,
  type VideoMusic,
  type VideoWatermark,
  type WatermarkCorner,
} from "@/lib/video/media";

/** An uploaded file: where it is kept, its name and a link to show or play it (null until asked for). */
export type MediaFile = { path: string; name: string; url: string | null };
export type MusicChoice = { on: boolean; source: "library" | "upload"; genre: MusicGenre; track: string | null; upload: MediaFile | null; volume: number };
export type WatermarkChoice = { on: boolean; source: "profile" | "upload"; upload: MediaFile | null; corner: WatermarkCorner };

export const DEFAULT_MUSIC: MusicChoice = { on: true, source: "library", genre: "chill", track: null, upload: null, volume: 70 };
export const DEFAULT_WATERMARK: WatermarkChoice = { on: false, source: "profile", upload: null, corner: "br" };

/** What the video records (VideoOptions): null when it has no music. */
export function musicOption(c: MusicChoice): VideoMusic | null {
  if (!c.on) return null;
  if (c.source === "upload") return c.upload ? { kind: "upload", path: c.upload.path, name: c.upload.name, volume: c.volume } : null;
  return c.track ? { kind: "library", track: c.track, volume: c.volume } : null;
}
export function watermarkOption(c: WatermarkChoice, profileLogo: string | null): VideoWatermark | null {
  if (!c.on) return null;
  if (c.source === "upload") return c.upload ? { kind: "upload", path: c.upload.path, name: c.upload.name, corner: c.corner } : null;
  return profileLogo ? { kind: "profile", corner: c.corner } : null;
}
/** A recorded choice back into the editor (an uploaded file's link is asked for again when needed). */
export function musicChoiceOf(m: VideoMusic | null | undefined, fallback: MusicChoice): MusicChoice {
  if (m === undefined) return fallback;
  if (!m) return { ...fallback, on: false };
  if (m.kind === "upload") return { ...fallback, on: true, source: "upload", upload: { path: m.path, name: m.name, url: null }, volume: m.volume };
  return { ...fallback, on: true, source: "library", genre: trackOf(m.track)?.genre ?? fallback.genre, track: m.track, volume: m.volume };
}
export function watermarkChoiceOf(w: VideoWatermark | null | undefined, fallback: WatermarkChoice): WatermarkChoice {
  if (w === undefined) return fallback;
  if (!w) return { ...fallback, on: false };
  if (w.kind === "upload") return { on: true, source: "upload", upload: { path: w.path, name: w.name, url: null }, corner: w.corner };
  return { ...fallback, on: true, source: "profile", corner: w.corner };
}

/** A short link to a song or logo uploaded for this property. */
export async function mediaLink(demoId: string, path: string) {
  return (await api<{ url: string }>(`/api/panel/videos/medios?demo=${demoId}&path=${encodeURIComponent(path)}`)).url;
}

async function uploadMedia(demoId: string, kind: "music" | "watermark", file: File): Promise<MediaFile> {
  const { upload } = await api<{ upload: { path: string; token: string; bucket: string } }>("/api/panel/videos/medios", {
    method: "POST",
    body: JSON.stringify({ demoId, kind, type: file.type, size: file.size }),
  });
  const client = browserClient();
  if (!client) throw new Error("No pudimos subir el archivo.");
  const up = await client.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type, upsert: true });
  if (up.error) throw new Error("No pudimos subir el archivo. Revisá tu conexión e intentá de nuevo.");
  return { path: upload.path, name: file.name, url: URL.createObjectURL(file) };
}
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message || fallback : fallback);

/** «Música de fondo»: a library track (by style, each one can be heard) or an uploaded song, and its volume. */
export function MusicCard({
  demoId,
  canEdit,
  choice,
  onChange,
  library,
  libraryError,
}: {
  demoId: string;
  canEdit: boolean;
  choice: MusicChoice;
  onChange: (c: MusicChoice) => void;
  library: LibraryTrack[] | null;
  libraryError: boolean;
}) {
  const [listening, setListening] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const player = useRef<HTMLAudioElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<MusicChoice>) => onChange({ ...choice, ...patch });

  useEffect(() => () => player.current?.pause(), []);
  // Turned off, or another source: nothing keeps playing.
  useEffect(() => {
    if (!choice.on || choice.source !== "library") {
      player.current?.pause();
      setListening(null);
    }
  }, [choice.on, choice.source]);

  const listen = (t: LibraryTrack) => {
    if (!player.current) {
      player.current = new Audio();
      player.current.addEventListener("ended", () => setListening(null));
    }
    const p = player.current;
    if (listening === t.id) {
      p.pause();
      setListening(null);
      return;
    }
    p.src = t.url;
    p.volume = choice.volume / 100;
    void p.play().catch(() => setListening(null));
    setListening(t.id);
  };

  const genres = MUSIC_GENRES.filter((g) => (library ?? []).some((t) => t.genre === g));
  const tracks = (library ?? []).filter((t) => t.genre === choice.genre);
  const current = choice.source === "library" ? (library ?? []).find((t) => t.id === choice.track) : null;
  const summary = !choice.on
    ? "El video sale sin música."
    : choice.source === "upload"
      ? choice.upload
        ? `${choice.upload.name} · suena durante todo el video.`
        : "Subí una canción para usarla de fondo."
      : current
        ? `${GENRE_LABEL[current.genre]} · ${current.name} · suena durante todo el video.`
        : "Elegí una pista de la biblioteca.";

  return (
    <section className="vs-card vs-media" aria-labelledby="vs-music">
      <h2 id="vs-music">Música de fondo</h2>
      <label className="vs-switch">
        <input type="checkbox" role="switch" checked={choice.on} disabled={!canEdit} onChange={(e) => set({ on: e.target.checked })} />
        <span>
          <strong>Agregar música de fondo</strong>
          <small>{summary}</small>
        </span>
      </label>
      {choice.on && (
        <>
          <div className="vs-seg" role="tablist" aria-label="De dónde sale la música">
            {(["library", "upload"] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={choice.source === s} className={choice.source === s ? "is-on" : ""} disabled={!canEdit} onClick={() => set({ source: s })}>
                {s === "library" ? "Biblioteca" : "Subir canción"}
              </button>
            ))}
          </div>
          {choice.source === "library" ? (
            library === null ? (
              <p className="vs-hint">{libraryError ? "No pudimos cargar la biblioteca. Probá de nuevo en un rato o subí tu canción." : "Cargando la biblioteca…"}</p>
            ) : !library.length ? (
              <p className="vs-hint">La biblioteca de música todavía se está preparando. Mientras tanto podés subir tu canción.</p>
            ) : (
              <>
                <div className="vs-chips" role="radiogroup" aria-label="Estilo de música">
                  {genres.map((g) => (
                    <button
                      key={g}
                      type="button"
                      role="radio"
                      aria-checked={choice.genre === g}
                      className={`vs-chip ${choice.genre === g ? "is-on" : ""}`}
                      disabled={!canEdit}
                      onClick={() => set({ genre: g, track: library.find((t) => t.genre === g)?.id ?? null })}
                    >
                      {GENRE_LABEL[g]}
                    </button>
                  ))}
                </div>
                <div className="vs-tracks-head">
                  <span>Pistas ({tracks.length})</span>
                  <button
                    type="button"
                    className="text-link"
                    disabled={!canEdit}
                    onClick={() => {
                      const pick = library[Math.floor(Math.random() * library.length)];
                      set({ genre: pick.genre, track: pick.id });
                    }}
                  >
                    <Shuffle size={14} aria-hidden="true" /> Aleatoria
                  </button>
                </div>
                <ul className="vs-tracks" role="radiogroup" aria-label="Pistas">
                  {tracks.map((t) => (
                    <li key={t.id} className={choice.track === t.id ? "is-on" : ""}>
                      <button type="button" className="vs-track-play" aria-label={listening === t.id ? `Pausar ${t.name}` : `Escuchar ${t.name}`} onClick={() => listen(t)}>
                        {listening === t.id ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                      </button>
                      <button type="button" role="radio" aria-checked={choice.track === t.id} className="vs-track-name" disabled={!canEdit} onClick={() => set({ track: t.id })}>
                        {t.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : (
            <div className="vs-upload">
              {choice.upload ? (
                <div className="vs-file">
                  <Music size={18} aria-hidden="true" />
                  <span>{choice.upload.name}</span>
                  <button type="button" className="text-link" disabled={!canEdit} onClick={() => set({ upload: null })}>
                    <X size={14} aria-hidden="true" /> Quitar
                  </button>
                </div>
              ) : null}
              <input
                ref={input}
                type="file"
                accept={Object.keys(MUSIC_TYPES).join(",")}
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setError("");
                  setUploading(true);
                  try {
                    set({ upload: await uploadMedia(demoId, "music", file) });
                  } catch (err) {
                    setError(errorText(err, "No pudimos subir la canción."));
                  } finally {
                    setUploading(false);
                  }
                }}
              />
              <button type="button" className="button button-small button-outline" disabled={!canEdit || uploading} onClick={() => input.current?.click()}>
                {uploading ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />} {choice.upload ? "Cambiar canción" : "Subir canción"}
              </button>
              <p className="vs-hint">MP3, M4A o WAV, hasta 15 MB. Usá solo música que tengas derecho a publicar.</p>
              {error && <p className="inline-error">{error}</p>}
            </div>
          )}
          <label className="vs-range">
            <span>Volumen</span>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={choice.volume}
              disabled={!canEdit}
              onChange={(e) => {
                set({ volume: Number(e.target.value) });
                if (player.current) player.current.volume = Number(e.target.value) / 100;
              }}
            />
            <span>{choice.volume} %</span>
          </label>
        </>
      )}
    </section>
  );
}

/** «Marca de agua»: the profile's logo or an uploaded one, in the chosen corner, over every photo. */
export function WatermarkCard({
  demoId,
  canEdit,
  choice,
  onChange,
  profileLogo,
}: {
  demoId: string;
  canEdit: boolean;
  choice: WatermarkChoice;
  onChange: (c: WatermarkChoice) => void;
  profileLogo: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<WatermarkChoice>) => onChange({ ...choice, ...patch });
  const file = choice.source === "upload" ? choice.upload : null;
  const has = choice.source === "upload" ? Boolean(file) : Boolean(profileLogo);
  const summary = !choice.on
    ? "El video sale sin logo encima."
    : has
      ? `${choice.source === "upload" ? "Tu marca de agua" : "El logo de tu perfil"}, ${CORNER_LABEL[choice.corner].toLowerCase()}, durante todo el video.`
      : "Subí tu marca de agua.";

  return (
    <section className="vs-card vs-media" aria-labelledby="vs-watermark">
      <h2 id="vs-watermark">Marca de agua</h2>
      <label className="vs-switch">
        <input
          type="checkbox"
          role="switch"
          checked={choice.on}
          disabled={!canEdit}
          onChange={(e) => set({ on: e.target.checked, source: e.target.checked && !profileLogo && !choice.upload ? "upload" : choice.source })}
        />
        <span>
          <strong>Agregar marca de agua</strong>
          <small>{summary}</small>
        </span>
      </label>
      {choice.on && (
        <>
          {has && (
            <div className="vs-file">
              {choice.source === "upload" ? (
                file?.url ? <img src={file.url} alt="" /> : <span className="vs-file-thumb" aria-hidden="true" />
              ) : (
                <img src={profileLogo!} alt="" />
              )}
              <span>
                <strong>{choice.source === "upload" ? file!.name : "Logo de tu perfil"}</strong>
                {choice.source === "profile" && <small>El que cargaste en tu inmobiliaria.</small>}
              </span>
              <button
                type="button"
                className="text-link"
                disabled={!canEdit}
                onClick={() => (choice.source === "upload" ? set({ upload: null, source: profileLogo ? "profile" : "upload", on: Boolean(profileLogo) }) : set({ on: false }))}
              >
                <X size={14} aria-hidden="true" /> Quitar
              </button>
            </div>
          )}
          <input
            ref={input}
            type="file"
            accept={Object.keys(LOGO_TYPES).join(",")}
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setError("");
              setUploading(true);
              try {
                set({ source: "upload", upload: await uploadMedia(demoId, "watermark", f) });
              } catch (err) {
                setError(errorText(err, "No pudimos subir la marca de agua."));
              } finally {
                setUploading(false);
              }
            }}
          />
          <button type="button" className="button button-small button-outline vs-media-up" disabled={!canEdit || uploading} onClick={() => input.current?.click()}>
            {uploading ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />} {file ? "Cambiar marca de agua" : "Subir marca de agua"}
          </button>
          {error && <p className="inline-error">{error}</p>}
          {has && (
            <div className="vs-corner-pick">
              <span id="vs-corner">Posición</span>
              <div className="vs-corners" role="radiogroup" aria-labelledby="vs-corner">
                {CORNERS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={choice.corner === c} aria-label={CORNER_LABEL[c]} title={CORNER_LABEL[c]} className={choice.corner === c ? "is-on" : ""} disabled={!canEdit} onClick={() => set({ corner: c })} />
                ))}
              </div>
              <small className="vs-hint">PNG con fondo transparente se ve mejor.</small>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// The video's sound and branding, shared by the studio and the server:
// background music (a track of Habita's library, generated once with fal, or
// a song the agency uploads) and a watermark (the agency's profile logo or an
// uploaded one) in a corner during the whole video. Ids, paths and switches
// only: the files live in the private «video-media» bucket.

/** Private bucket for the library's tracks and the songs and logos agencies upload (202611220001_video_media.sql). */
export const MEDIA_BUCKET = "video-media";
/** Where the library's tracks are kept inside the bucket: library/<track id>.<ext>. */
export const LIBRARY_FOLDER = "library";
export const MAX_MUSIC_BYTES = 15 * 1024 * 1024;
export const MAX_LOGO_BYTES = 3 * 1024 * 1024;
export const MUSIC_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};
export const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export const MUSIC_GENRES = ["acoustic", "chill", "cinema", "electronic", "upbeat"] as const;
export type MusicGenre = (typeof MUSIC_GENRES)[number];
export const GENRE_LABEL: Record<MusicGenre, string> = {
  acoustic: "Acústico",
  chill: "Chill",
  cinema: "Cine",
  electronic: "Electrónica",
  upbeat: "Animado",
};

export type MusicTrack = { id: string; genre: MusicGenre; name: string; prompt: string };
const SAFE = "instrumental only, no vocals, no lyrics, clean mix, seamless loop, suitable as background music for a real estate property tour video";
/** Habita's library: generated once by the team (Administración → Música para videos), then served from storage. */
export const MUSIC_TRACKS: MusicTrack[] = [
  { id: "acoustic-morning", genre: "acoustic", name: "Patio de mañana", prompt: `warm acoustic guitar fingerpicking, soft shaker, bright and calm, 92 bpm, ${SAFE}` },
  { id: "acoustic-wood", genre: "acoustic", name: "Madera clara", prompt: `gentle acoustic guitar and light piano, airy, hopeful, 84 bpm, ${SAFE}` },
  { id: "acoustic-sunday", genre: "acoustic", name: "Domingo", prompt: `folk acoustic guitar strumming with soft claps and ukulele, relaxed and friendly, 100 bpm, ${SAFE}` },
  { id: "chill-golden", genre: "chill", name: "Golden Hour", prompt: `lo-fi chill hop, mellow electric piano, soft vinyl texture, laid-back drums, 80 bpm, ${SAFE}` },
  { id: "chill-loft", genre: "chill", name: "Loft Breeze", prompt: `chill house, warm pads, gentle plucks, smooth bass, elegant and modern, 104 bpm, ${SAFE}` },
  { id: "chill-terrace", genre: "chill", name: "Terrace", prompt: `downtempo chillout, rhodes chords, soft guitar licks, relaxed groove, sunset mood, 90 bpm, ${SAFE}` },
  { id: "cinema-entrance", genre: "cinema", name: "Gran entrada", prompt: `cinematic orchestral build, warm strings, soft piano, inspiring and elegant, 70 bpm, ${SAFE}` },
  { id: "cinema-window", genre: "cinema", name: "Ventanal", prompt: `emotional cinematic piano with light strings, spacious and luminous, 76 bpm, ${SAFE}` },
  { id: "cinema-horizon", genre: "cinema", name: "Horizonte", prompt: `modern cinematic ambient, pulsing synths and strings, wide and premium, 88 bpm, ${SAFE}` },
  { id: "electronic-urban", genre: "electronic", name: "Pulso urbano", prompt: `deep house, clean four on the floor beat, warm bass, minimal synth stabs, stylish, 118 bpm, ${SAFE}` },
  { id: "electronic-neon", genre: "electronic", name: "Neón suave", prompt: `smooth synthwave, soft arpeggios, gentle drums, modern and polished, 100 bpm, ${SAFE}` },
  { id: "electronic-glass", genre: "electronic", name: "Cristal", prompt: `minimal electronic, glassy plucks, light percussion, sleek luxury feel, 110 bpm, ${SAFE}` },
  { id: "upbeat-keys", genre: "upbeat", name: "Llaves nuevas", prompt: `upbeat pop, bright piano, claps, positive and energetic, 120 bpm, ${SAFE}` },
  { id: "upbeat-move", genre: "upbeat", name: "Mudanza feliz", prompt: `happy indie pop, whistling-like synth lead, acoustic guitar, bouncy drums, 116 bpm, ${SAFE}` },
  { id: "upbeat-city", genre: "upbeat", name: "Ciudad viva", prompt: `funky upbeat groove, slap bass, brass stabs, lively and fun, 112 bpm, ${SAFE}` },
];
export const trackOf = (id: unknown) => MUSIC_TRACKS.find((t) => t.id === id) ?? null;

export type WatermarkCorner = "tl" | "tr" | "bl" | "br";
export const CORNERS: WatermarkCorner[] = ["tl", "tr", "bl", "br"];
export const CORNER_LABEL: Record<WatermarkCorner, string> = {
  tl: "Arriba a la izquierda",
  tr: "Arriba a la derecha",
  bl: "Abajo a la izquierda",
  br: "Abajo a la derecha",
};

/** The video's music: a library track or an uploaded song (its path in the bucket), at a volume of 10–100 %. */
export type VideoMusic = { kind: "library"; track: string; volume: number } | { kind: "upload"; path: string; name: string; volume: number };
/** The watermark: the profile's logo or an uploaded one, in a corner. */
export type VideoWatermark = { kind: "profile"; corner: WatermarkCorner } | { kind: "upload"; path: string; name: string; corner: WatermarkCorner };

/** An agency's own file in the bucket: <agency>/<demo>/<uuid>.<ext>. Its owner is checked again where it is read. */
export const isMediaPath = (p: unknown): p is string => typeof p === "string" && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp3|m4a|aac|wav|png|jpg|webp)$/i.test(p);
const cleanName = (n: unknown) => (typeof n === "string" ? [...n].filter((ch) => ch >= " " && ch !== "<" && ch !== ">").join("").trim().slice(0, 80) : "") || "Archivo";
const volumeOf = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(100, Math.max(10, n)) : 70;
};

export function readMusic(raw: unknown): VideoMusic | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (v.kind === "library" && trackOf(v.track)) return { kind: "library", track: v.track as string, volume: volumeOf(v.volume) };
  if (v.kind === "upload" && isMediaPath(v.path)) return { kind: "upload", path: v.path, name: cleanName(v.name), volume: volumeOf(v.volume) };
  return null;
}

export function readWatermark(raw: unknown): VideoWatermark | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const corner = CORNERS.includes(v.corner as WatermarkCorner) ? (v.corner as WatermarkCorner) : "br";
  if (v.kind === "profile") return { kind: "profile", corner };
  if (v.kind === "upload" && isMediaPath(v.path)) return { kind: "upload", path: v.path, name: cleanName(v.name), corner };
  return null;
}

/** The library as the studio receives it: the tracks already generated, with a short link to each. */
export type LibraryTrack = MusicTrack & { url: string };

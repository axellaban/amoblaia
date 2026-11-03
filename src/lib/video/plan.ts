// The "Clásico" video, planned: an optional opening card with the property's
// real data, one scene per photo with a slow camera move (Ken Burns),
// crossfades, and an optional closing card with the agency's contact. Pure
// and deterministic, so the preview, the render and the tests agree. No AI
// and nothing invented: without information, the video is only the photos.

export const VIDEO_MODES = ["classic", "balanced", "cinematic", "clip"] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];
/** The four export formats: each one is its own MP4, rendered at its real size (never a CSS crop of another). */
export const VIDEO_FORMATS = ["9:16", "16:9", "4:5", "1:1"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];
export const DEFAULT_FORMAT: VideoFormat = "9:16";
export const VIDEO_SIZE: Record<VideoFormat, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
};
/** How each format is named and where it is meant to be published. */
export const FORMAT_INFO: Record<VideoFormat, { name: string; short: string; uses: string; file: string }> = {
  "9:16": { name: "Vertical (9:16)", short: "Vertical 9:16", uses: "Reels, Stories, TikTok, YouTube Shorts y estados de WhatsApp", file: "vertical" },
  "16:9": { name: "Horizontal (16:9)", short: "Horizontal 16:9", uses: "YouTube, portales inmobiliarios, sitios web y presentaciones", file: "horizontal" },
  "4:5": { name: "Vertical (4:5)", short: "Vertical 4:5", uses: "Feed de Instagram y de Facebook", file: "vertical-4x5" },
  "1:1": { name: "Cuadrado (1:1)", short: "Cuadrado 1:1", uses: "Publicaciones cuadradas en Instagram, Facebook y otras redes", file: "cuadrado" },
};
export const isVideoFormat = (v: unknown): v is VideoFormat => VIDEO_FORMATS.includes(v as VideoFormat);
/** A stored format, read leniently: an unknown value is the vertical default. */
export const formatOf = (v: unknown): VideoFormat => (isVideoFormat(v) ? v : DEFAULT_FORMAT);
/** Width over height of the real file. */
export const formatRatio = (f: VideoFormat) => VIDEO_SIZE[f].width / VIDEO_SIZE[f].height;
export const resolutionOf = (f: VideoFormat) => `${VIDEO_SIZE[f].width} × ${VIDEO_SIZE[f].height}`;

/** The download's name: the property and the format, e.g. «duplex-en-pompeya-vertical-4x5.mp4». */
export function videoFileName(title: string, format: VideoFormat) {
  const slug =
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 60) || "propiedad";
  return `${slug}-${FORMAT_INFO[formatOf(format)].file}.mp4`;
}
export const FPS = 30;
export const MAX_VIDEO_PHOTOS = 12;

export const MODE_INFO: Record<VideoMode, { name: string; text: string }> = {
  classic: { name: "Clásico", text: "Tus fotos con movimiento suave, transiciones y los datos de la propiedad. Sin IA." },
  balanced: { name: "Equilibrado", text: "Anima con IA las 2 mejores fotos y las combina con el resto." },
  cinematic: { name: "Cinematográfico", text: "Anima con IA todas las fotos elegidas." },
  clip: { name: "Video IA de una foto", text: "Unos segundos de movimiento a partir de una foto." },
};

export type Timing = { intro: number; photo: number; outro: number; fade: number };
export const DEFAULT_TIMING: Timing = { intro: 2400, photo: 3200, outro: 3000, fade: 700 };

export type Scene =
  | { kind: "intro"; start: number; duration: number }
  | { kind: "outro"; start: number; duration: number }
  | { kind: "photo"; start: number; duration: number; photo: number; zoomFrom: number; zoomTo: number; panX: number; panY: number };

export type VideoPlan = { format: VideoFormat; width: number; height: number; fps: number; durationMs: number; frames: number; fade: number; scenes: Scene[] };

/**
 * Scenes back to back; each one fades into the next during its last `fade` ms.
 * `intro`/`outro`: the opening and closing cards, only when the video carries
 * the property's or the agency's information (both by default).
 */
export function planVideo(
  photoCount: number,
  format: VideoFormat,
  opts: { timing?: Timing; intro?: boolean; outro?: boolean } = {},
): VideoPlan {
  if (!Number.isInteger(photoCount) || photoCount < 1 || photoCount > MAX_VIDEO_PHOTOS) throw new Error("PHOTO_COUNT");
  if (!isVideoFormat(format)) throw new Error("FORMAT");
  const timing = opts.timing ?? DEFAULT_TIMING;
  const scenes: Scene[] = [];
  let t = 0;
  if (opts.intro !== false) {
    scenes.push({ kind: "intro", start: t, duration: timing.intro });
    t += timing.intro - timing.fade;
  }
  for (let i = 0; i < photoCount; i++) {
    // Alternating gentle moves: in and out, left and right; never more than 10% zoom.
    const zoomIn = i % 2 === 0;
    scenes.push({
      kind: "photo",
      start: t,
      duration: timing.photo,
      photo: i,
      zoomFrom: zoomIn ? 1 : 1.1,
      zoomTo: zoomIn ? 1.1 : 1,
      panX: [0.6, -0.6, 0.3, -0.3][i % 4],
      panY: [0.2, -0.2, -0.1, 0.1][i % 4],
    });
    t += timing.photo - timing.fade;
  }
  let durationMs: number;
  if (opts.outro !== false) {
    scenes.push({ kind: "outro", start: t, duration: timing.outro });
    durationMs = t + timing.outro;
  } else durationMs = t + timing.fade; // The last photo plays its full length.
  const { width, height } = VIDEO_SIZE[format];
  return { format, width, height, fps: FPS, durationMs, frames: Math.ceil((durationMs / 1000) * FPS), fade: timing.fade, scenes };
}

/** What is on screen at `ms`: the scene, how far into it (0..1), and the next one fading in (0..1). */
export function sceneAt(plan: VideoPlan, ms: number) {
  const t = Math.min(Math.max(ms, 0), plan.durationMs - 1);
  let index = plan.scenes.findIndex((s) => t >= s.start && t < s.start + s.duration);
  if (index < 0) index = plan.scenes.length - 1;
  const scene = plan.scenes[index];
  const next = plan.scenes[index + 1] ?? null;
  // Overlap: the next scene already started; the current one is the earlier.
  const progress = (t - scene.start) / scene.duration;
  const fadeStart = scene.start + scene.duration - plan.fade;
  const mix = next && t >= fadeStart ? Math.min(1, (t - fadeStart) / plan.fade) : 0;
  return { scene, next: mix > 0 ? next : null, progress: Math.min(1, Math.max(0, progress)), mix };
}

/** Linear between from and to; eased so the camera starts and ends softly. */
export function cameraAt(scene: Extract<Scene, { kind: "photo" }>, progress: number) {
  const e = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  return { zoom: scene.zoomFrom + (scene.zoomTo - scene.zoomFrom) * e, panX: scene.panX * e, panY: scene.panY * e };
}

/**
 * "Cover" crop of a photo into the frame at a given zoom and pan (−1..1 of
 * the free margin): the source rectangle to draw. Never stretches.
 */
export function coverCrop(img: { width: number; height: number }, frame: { width: number; height: number }, zoom: number, panX: number, panY: number) {
  const scale = Math.max(frame.width / img.width, frame.height / img.height) * zoom;
  const sw = frame.width / scale;
  const sh = frame.height / scale;
  const freeX = img.width - sw;
  const freeY = img.height - sh;
  return { sx: (freeX / 2) * (1 + panX), sy: (freeY / 2) * (1 + panY), sw, sh };
}

/** Where each photo scene starts: the preview's thumbnails jump there. */
export const photoStarts = (plan: VideoPlan) => plan.scenes.filter((s) => s.kind === "photo").map((s) => s.start);

/** The information the agency may add to its video: each item opt-in, each one from saved data. */
export const INFO_FIELDS = ["title", "location", "price", "facts", "agencyName", "logo", "contact"] as const;
export type InfoField = (typeof INFO_FIELDS)[number];
export type InfoChoice = Record<InfoField, boolean>;
export const INFO_LABEL: Record<InfoField, string> = {
  title: "Título",
  location: "Ubicación",
  price: "Precio",
  facts: "Características",
  agencyName: "Nombre de la inmobiliaria",
  logo: "Logo de la inmobiliaria",
  contact: "Contacto",
};
/** What the property really has, already filtered by what the agency hides on its ficha. Null: not available. */
export type InfoSource = {
  title: string | null;
  location: string | null;
  /** The confirmed price as published, or null («Consultar precio» is used then). */
  price: string | null;
  priceFallback: string;
  operation: string | null;
  facts: string[];
  agencyName: string | null;
  logo: boolean;
  contact: string | null;
};
/** Whether a field can be offered: only real data (the price always, as «Consultar precio» when missing). */
export function infoAvailable(src: InfoSource, field: InfoField): boolean {
  switch (field) {
    case "title":
      return Boolean(src.title);
    case "location":
      return Boolean(src.location);
    case "price":
      return Boolean(src.title); // A property (not a bare photo group): its price or «Consultar precio».
    case "facts":
      return src.facts.length > 0;
    case "agencyName":
      return Boolean(src.agencyName);
    case "logo":
      return src.logo;
    case "contact":
      return Boolean(src.contact);
  }
}
/** The texts of the cards, only the chosen and available fields. */
export type VideoCards = {
  intro: { operation: string | null; title: string | null; location: string | null; price: string | null; facts: string[] } | null;
  outro: { agencyName: string | null; logo: boolean; contact: string | null } | null;
};
export function videoCards(src: InfoSource, include: boolean, choice: InfoChoice): VideoCards {
  if (!include) return { intro: null, outro: null };
  const on = (f: InfoField) => choice[f] && infoAvailable(src, f);
  const intro = {
    operation: on("title") || on("price") ? src.operation : null,
    title: on("title") ? src.title : null,
    location: on("location") ? src.location : null,
    price: on("price") ? (src.price ?? src.priceFallback) : null,
    facts: on("facts") ? src.facts.slice(0, 4) : [],
  };
  const outro = { agencyName: on("agencyName") ? src.agencyName : null, logo: on("logo"), contact: on("contact") ? src.contact : null };
  return {
    intro: intro.title || intro.location || intro.price || intro.facts.length ? intro : null,
    outro: outro.agencyName || outro.logo || outro.contact ? outro : null,
  };
}

/** The photos offered first: those with an AI staging, then the rest, in the listing's order; at most 8. */
export function suggestPhotos<T extends { id: string; staged: boolean }>(photos: T[], max = 8): T[] {
  const staged = photos.filter((p) => p.staged);
  const plain = photos.filter((p) => !p.staged);
  return [...staged, ...plain].slice(0, Math.min(max, MAX_VIDEO_PHOTOS));
}

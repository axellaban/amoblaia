// The "Clásico" video, planned: an opening card with the property's real
// data, one scene per photo with a slow camera move (Ken Burns), crossfades,
// and a closing card with the agency's contact. Pure and deterministic, so
// the preview, the render and the tests agree. No AI and nothing invented.

export const VIDEO_MODES = ["classic", "balanced", "cinematic", "clip"] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];
export const VIDEO_FORMATS = ["9:16", "16:9"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];
export const VIDEO_SIZE: Record<VideoFormat, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
};
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

/** Scenes back to back; each one fades into the next during its last `fade` ms. */
export function planVideo(photoCount: number, format: VideoFormat, timing: Timing = DEFAULT_TIMING): VideoPlan {
  if (!Number.isInteger(photoCount) || photoCount < 1 || photoCount > MAX_VIDEO_PHOTOS) throw new Error("PHOTO_COUNT");
  const scenes: Scene[] = [];
  let t = 0;
  scenes.push({ kind: "intro", start: t, duration: timing.intro });
  t += timing.intro - timing.fade;
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
  scenes.push({ kind: "outro", start: t, duration: timing.outro });
  const durationMs = t + timing.outro;
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

/** The photos offered first: those with an AI staging, then the rest, in the listing's order; at most 8. */
export function suggestPhotos<T extends { id: string; staged: boolean }>(photos: T[], max = 8): T[] {
  const staged = photos.filter((p) => p.staged);
  const plain = photos.filter((p) => !p.staged);
  return [...staged, ...plain].slice(0, Math.min(max, MAX_VIDEO_PHOTOS));
}

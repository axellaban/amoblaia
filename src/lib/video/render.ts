// Renders the video in the browser: canvas frames → WebCodecs H.264 → MP4
// (mp4-muxer). The «Clásico» draws the photos; the AI modes draw each
// photo's animated clip (made by the provider, kept in Habita's storage).
// No server time; the MP4 is uploaded straight to Habita's storage. Browser only.
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { cameraAt, coverCrop, sceneAt, type VideoCards, type VideoPlan } from "./plan";

/** What the cards say: only the information the agency chose (spec: optional). */
export type VideoInfo = VideoCards;

/**
 * One photo of the video: a still (the «Clásico», and every preview) or,
 * in the AI modes, the photo's animated clip, drawn at the scene's moment.
 */
export type VideoAsset = { image: ImageBitmap; staged: boolean; clip?: undefined } | { clip: HTMLVideoElement; staged: boolean; image?: undefined };

const CODEC = "avc1.640028"; // H.264 High 4.0: up to 1920×1080 / 1080×1920 at 30 fps, plays on iPhone and WhatsApp.

/** Whether this browser can make the MP4 (WebCodecs with H.264). */
export async function canRender(plan: Pick<VideoPlan, "width" | "height" | "fps">) {
  if (typeof window === "undefined" || !("VideoEncoder" in window)) return false;
  try {
    const r = await VideoEncoder.isConfigSupported({ codec: CODEC, width: plan.width, height: plan.height, bitrate: 6_000_000, framerate: plan.fps });
    return Boolean(r.supported);
  } catch {
    return false;
  }
}

export async function loadAsset(url: string, staged: boolean): Promise<VideoAsset> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("PHOTO_LOAD_FAILED");
  return { image: await createImageBitmap(await res.blob()), staged };
}

/** An animated clip, ready to be drawn frame by frame (muted, never played: each frame is sought). */
export async function loadClip(url: string, staged: boolean): Promise<VideoAsset> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous"; // Signed storage links: the canvas stays readable for the encoder.
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CLIP_LOAD_FAILED")), 30_000);
    video.addEventListener("loadeddata", () => (clearTimeout(timer), resolve()), { once: true });
    video.addEventListener("error", () => (clearTimeout(timer), reject(new Error("CLIP_LOAD_FAILED"))), { once: true });
    video.src = url;
    video.load();
  });
  return { clip: video, staged };
}

function seek(video: HTMLVideoElement, t: number) {
  if (Math.abs(video.currentTime - t) < 0.002 && video.readyState >= 2) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => (cleanup(), reject(new Error("CLIP_SEEK_FAILED"))), 10_000);
    const done = () => (cleanup(), resolve());
    const fail = () => (cleanup(), reject(new Error("CLIP_SEEK_FAILED")));
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", fail);
    video.currentTime = t;
  });
}

/** Where a clip is at `ms` of its scene: from its start, never past its last frame. */
export function clipTime(scene: { start: number }, ms: number, clipSeconds: number) {
  return Math.min(Math.max(0, (ms - scene.start) / 1000), Math.max(0, clipSeconds - 0.05));
}

/** Puts the clips on screen at `ms` (the scene and the one fading in) at their exact frame. */
export async function seekClips(plan: VideoPlan, assets: VideoAsset[], ms: number) {
  const { scene, next } = sceneAt(plan, ms);
  await Promise.all(
    [scene, next].map((s) => {
      if (!s || s.kind !== "photo") return null;
      const clip = assets[s.photo]?.clip;
      return clip ? seek(clip, clipTime(s, ms, clip.duration || 0)) : null;
    }),
  );
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = next;
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines;
}

const GREEN = "#24382e";
const CREAM = "#f8f5ef";

type Line = { text: string; font: string; gap: number };

/**
 * An opening or closing card, centered in the frame whatever its shape: the
 * lines are measured first and scaled down if they would not fit inside the
 * safe area (8% margins), so no text is ever cut in 1:1 or 16:9.
 */
function card(ctx: CanvasRenderingContext2D, plan: VideoPlan, info: VideoInfo, kind: "intro" | "outro", logo: ImageBitmap | null) {
  const { width: W, height: H } = plan;
  ctx.fillStyle = kind === "intro" ? GREEN : CREAM;
  ctx.fillRect(0, 0, W, H);
  const safeW = W * 0.84;
  const safeH = H * 0.84;
  const layout = (s: number) => {
    const lines: Line[] = [];
    const add = (text: string, weight: number, size: number, gap: number, maxLines: number) => {
      ctx.font = `${weight} ${size * s}px Arial, sans-serif`;
      for (const l of wrap(ctx, text, safeW, maxLines)) lines.push({ text: l, font: ctx.font, gap: size * s * 1.18 + gap * s });
    };
    let logoBox: { w: number; h: number } | null = null;
    if (kind === "intro" && info.intro) {
      const i = info.intro;
      if (i.operation) add(i.operation.toUpperCase(), 700, 34, 30, 1);
      if (i.title) add(i.title, 800, 72, 6, 3);
      if (i.location) add(i.location, 500, 40, 10, 2);
      if (i.price) add(i.price, 800, 60, 26, 1);
      if (i.facts.length) add(i.facts.join("  ·  "), 500, 36, 0, 2);
    } else if (kind === "outro" && info.outro) {
      const o = info.outro;
      if (o.logo && logo) {
        const lh = 160 * s;
        const lw = Math.min(safeW * 0.6, logo.width * (lh / logo.height));
        logoBox = { w: lw, h: (logo.height / logo.width) * lw };
      }
      if (o.agencyName) add(o.agencyName, 800, 60, 8, 2);
      if (o.contact) add(o.contact, 600, 44, 20, 1);
      if (o.contact) add("Consultanos por esta propiedad", 500, 34, 0, 2);
    }
    const height = lines.reduce((h, l) => h + l.gap, 0) + (logoBox ? logoBox.h + 40 * s : 0);
    return { lines, logoBox, height };
  };
  let s = Math.min(W, H) / 1080;
  let l = layout(s);
  for (let i = 0; i < 6 && l.height > safeH; i++) {
    s *= 0.85;
    l = layout(s);
  }
  let y = (H - l.height) / 2;
  if (l.logoBox && logo) {
    ctx.drawImage(logo, (W - l.logoBox.w) / 2, y, l.logoBox.w, l.logoBox.h);
    y += l.logoBox.h + 40 * s;
  }
  ctx.fillStyle = kind === "intro" ? "#fff" : GREEN;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const line of l.lines) {
    ctx.font = line.font;
    ctx.fillText(line.text, W / 2, y);
    y += line.gap;
  }
}

/** The label of an AI-made scene, or null for an untouched photo. */
export function aiLabel(asset: { staged: boolean; clip?: unknown }) {
  if (asset.clip) return asset.staged ? "Ambientación y movimiento con IA" : "Movimiento generado con IA";
  return asset.staged ? "Ambientación virtual con IA" : null;
}

function photoScene(ctx: CanvasRenderingContext2D, plan: VideoPlan, asset: VideoAsset, scene: Extract<VideoPlan["scenes"][number], { kind: "photo" }>, progress: number) {
  const { width: W, height: H } = plan;
  if (asset.clip) {
    // The clip already moves: drawn whole («cover»), at the frame seekClips put on screen.
    const v = asset.clip;
    const c = coverCrop({ width: v.videoWidth || W, height: v.videoHeight || H }, { width: W, height: H }, 1, 0, 0);
    ctx.drawImage(v, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H);
  } else if (asset.image) {
    const cam = cameraAt(scene, progress);
    const c = coverCrop(asset.image, { width: W, height: H }, cam.zoom, cam.panX, cam.panY);
    ctx.drawImage(asset.image, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H);
  }
  const label = aiLabel(asset);
  if (label) {
    // AI images and AI motion are labelled as such (spec §6.2).
    const s = Math.min(W, H) / 1080;
    const text = label;
    ctx.font = `600 ${26 * s}px Arial, sans-serif`;
    const tw = ctx.measureText(text).width;
    const pad = 16 * s;
    ctx.fillStyle = "rgba(20,30,24,0.62)";
    ctx.fillRect(W - tw - pad * 3, H - 64 * s - pad, tw + pad * 2, 48 * s);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, W - tw - pad * 2, H - 64 * s - pad + 33 * s);
  }
}

function drawScene(ctx: CanvasRenderingContext2D, plan: VideoPlan, info: VideoInfo, assets: VideoAsset[], logo: ImageBitmap | null, scene: VideoPlan["scenes"][number], ms: number) {
  const progress = Math.min(1, Math.max(0, (ms - scene.start) / scene.duration));
  if (scene.kind === "photo") photoScene(ctx, plan, assets[scene.photo], scene, progress);
  else card(ctx, plan, info, scene.kind, logo);
}

/** One frame at `ms`, with the crossfade into the next scene. */
export function drawFrame(ctx: CanvasRenderingContext2D, plan: VideoPlan, info: VideoInfo, assets: VideoAsset[], logo: ImageBitmap | null, ms: number) {
  const { scene, next, mix } = sceneAt(plan, ms);
  ctx.globalAlpha = 1;
  drawScene(ctx, plan, info, assets, logo, scene, ms);
  if (next && mix > 0) {
    ctx.globalAlpha = mix;
    drawScene(ctx, plan, info, assets, logo, next, ms);
    ctx.globalAlpha = 1;
  }
}

/** The MP4, frame by frame. `onProgress` gets 0..1; `signal` cancels. */
export async function renderMp4(plan: VideoPlan, info: VideoInfo, assets: VideoAsset[], logo: ImageBitmap | null, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  const canvas = new OffscreenCanvas(plan.width, plan.height);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: plan.width, height: plan.height, frameRate: plan.fps }, fastStart: "in-memory" });
  let failure: unknown = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
  encoder.configure({ codec: CODEC, width: plan.width, height: plan.height, bitrate: 6_000_000, framerate: plan.fps });
  const frameUs = 1_000_000 / plan.fps;
  for (let i = 0; i < plan.frames; i++) {
    if (signal?.aborted) {
      encoder.close();
      throw new DOMException("Cancelado", "AbortError");
    }
    if (failure) throw failure;
    const ms = (i * 1000) / plan.fps;
    if (assets.some((a) => a.clip)) await seekClips(plan, assets, ms);
    drawFrame(ctx, plan, info, assets, logo, ms);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
    encoder.encode(frame, { keyFrame: i % (plan.fps * 2) === 0 });
    frame.close();
    // Back-pressure: never queue more than a few frames.
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
    if (i % 10 === 0) {
      onProgress(i / plan.frames);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  muxer.finalize();
  onProgress(1);
  return new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: "video/mp4" });
}

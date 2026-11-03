// Renders the video in the browser: canvas frames → WebCodecs H.264 → MP4
// (mp4-muxer). The «Clásico» draws the photos; the AI modes draw each
// photo's animated clip (made by the provider, kept in Habita's storage).
// No server time; the MP4 is uploaded straight to Habita's storage. Browser only.
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { WatermarkCorner } from "./media";
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

/** The agency's logo over the photos, in a corner, during the whole video (not over the cards, which carry their own). */
export type Watermark = { image: ImageBitmap; corner: WatermarkCorner };

/** Where the watermark goes: a margin from the corner, above the AI label when both share the bottom right. */
export function watermarkBox(plan: Pick<VideoPlan, "width" | "height">, image: { width: number; height: number }, corner: WatermarkCorner, labelled: boolean) {
  const { width: W, height: H } = plan;
  const s = Math.min(W, H) / 1080;
  const maxH = 110 * s;
  const maxW = Math.min(W * 0.32, 340 * s);
  const k = Math.min(maxH / image.height, maxW / image.width);
  const w = image.width * k;
  const h = image.height * k;
  const m = 44 * s;
  const x = corner === "tl" || corner === "bl" ? m : W - m - w;
  // The AI label sits at the bottom right (64 px + its 48 px plate): the logo goes above it.
  const bottom = corner === "br" && labelled ? 64 * s + 16 * s + 48 * s + 20 * s : m;
  const y = corner === "tl" || corner === "tr" ? m : H - bottom - h;
  return { x, y, w, h };
}

function drawWatermark(ctx: CanvasRenderingContext2D, plan: VideoPlan, assets: VideoAsset[], wm: Watermark, ms: number) {
  const { scene, next, mix } = sceneAt(plan, ms);
  const weight = (scene.kind === "photo" ? 1 - (next ? mix : 0) : 0) + (next && next.kind === "photo" ? mix : 0);
  if (weight <= 0.01) return;
  const labelled = [scene, next].some((x) => x && x.kind === "photo" && assets[x.photo] && aiLabel(assets[x.photo]));
  const box = watermarkBox(plan, wm.image, wm.corner, labelled);
  ctx.globalAlpha = 0.92 * Math.min(1, weight);
  ctx.drawImage(wm.image, box.x, box.y, box.w, box.h);
  ctx.globalAlpha = 1;
}

/** One frame at `ms`, with the crossfade into the next scene. */
export function drawFrame(ctx: CanvasRenderingContext2D, plan: VideoPlan, info: VideoInfo, assets: VideoAsset[], logo: ImageBitmap | null, ms: number, watermark: Watermark | null = null) {
  const { scene, next, mix } = sceneAt(plan, ms);
  ctx.globalAlpha = 1;
  drawScene(ctx, plan, info, assets, logo, scene, ms);
  if (next && mix > 0) {
    ctx.globalAlpha = mix;
    drawScene(ctx, plan, info, assets, logo, next, ms);
    ctx.globalAlpha = 1;
  }
  if (watermark) drawWatermark(ctx, plan, assets, watermark, ms);
}

const SAMPLE_RATE = 48_000;
/** The audio codec this browser can write into the MP4: AAC (plays everywhere) or, failing that, Opus. Null: none. */
export async function audioCodec(): Promise<{ codec: string; mux: "aac" | "opus" } | null> {
  if (typeof window === "undefined" || !("AudioEncoder" in window)) return null;
  for (const c of [
    { codec: "mp4a.40.2", mux: "aac" as const },
    { codec: "opus", mux: "opus" as const },
  ]) {
    try {
      const r = await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160_000 });
      if (r.supported) return c;
    } catch {
      // Next codec.
    }
  }
  return null;
}

/** A song (library or uploaded), decoded and resampled to 48 kHz. */
export async function loadMusic(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("MUSIC_LOAD_FAILED");
  const bytes = await res.arrayBuffer();
  return new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(bytes);
}

/** The music for the whole video: looped to its length, at its volume, fading in and out. */
export async function mixMusic(song: AudioBuffer, durationMs: number, volume: number): Promise<AudioBuffer> {
  const seconds = durationMs / 1000;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * SAMPLE_RATE)), SAMPLE_RATE);
  const source = ctx.createBufferSource();
  source.buffer = song;
  source.loop = true;
  const gain = ctx.createGain();
  const level = Math.min(1, Math.max(0, volume / 100));
  const fadeIn = Math.min(0.4, seconds / 6);
  const fadeOut = Math.min(1.8, seconds / 3);
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(level, fadeIn);
  gain.gain.setValueAtTime(level, Math.max(fadeIn, seconds - fadeOut));
  gain.gain.linearRampToValueAtTime(0, seconds);
  source.connect(gain).connect(ctx.destination);
  source.start(0);
  return ctx.startRendering();
}

async function encodeAudio(muxer: Muxer<ArrayBufferTarget>, mixed: AudioBuffer, codec: string) {
  let failure: unknown = null;
  const encoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failure = e) });
  encoder.configure({ codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160_000 });
  const left = mixed.getChannelData(0);
  const right = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : left;
  const block = 4096;
  for (let i = 0; i < mixed.length; i += block) {
    if (failure) throw failure;
    const n = Math.min(block, mixed.length - i);
    const data = new Float32Array(n * 2);
    data.set(left.subarray(i, i + n), 0);
    data.set(right.subarray(i, i + n), n);
    const frame = new AudioData({ format: "f32-planar", sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / SAMPLE_RATE) * 1_000_000), data });
    encoder.encode(frame);
    frame.close();
    while (encoder.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 2));
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
}

/** What goes over and under the frames: the watermark and the background music (already decoded). */
export type RenderExtras = { watermark?: Watermark | null; music?: { song: AudioBuffer; volume: number; codec: { codec: string; mux: "aac" | "opus" } } | null };

/** The MP4, frame by frame. `onProgress` gets 0..1; `signal` cancels. */
export async function renderMp4(
  plan: VideoPlan,
  info: VideoInfo,
  assets: VideoAsset[],
  logo: ImageBitmap | null,
  onProgress: (p: number) => void,
  signal?: AbortSignal,
  extras: RenderExtras = {},
): Promise<Blob> {
  const canvas = new OffscreenCanvas(plan.width, plan.height);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  const music = extras.music ?? null;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: plan.width, height: plan.height, frameRate: plan.fps },
    ...(music ? { audio: { codec: music.codec.mux, numberOfChannels: 2, sampleRate: SAMPLE_RATE } } : {}),
    fastStart: "in-memory",
  });
  // The music first (a few seconds of work): the frames then fill the rest of the progress.
  if (music) await encodeAudio(muxer, await mixMusic(music.song, plan.durationMs, music.volume), music.codec.codec);
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
    drawFrame(ctx, plan, info, assets, logo, ms, extras.watermark ?? null);
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

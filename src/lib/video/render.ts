// Renders the "Clásico" video in the browser: canvas frames → WebCodecs H.264
// → MP4 (mp4-muxer). No server time and no provider cost; the MP4 is then
// uploaded straight to Habita's storage. Browser only.
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { cameraAt, coverCrop, sceneAt, type VideoPlan } from "./plan";

export type VideoInfo = {
  title: string;
  location: string | null;
  /** As published, or "Consultar precio": never an invented amount. */
  price: string;
  operation: string | null;
  facts: string[];
  agencyName: string;
  contact: string | null;
};
export type VideoAsset = { image: ImageBitmap; staged: boolean };

const CODEC = "avc1.640028"; // H.264 High 4.0: 1080×1920 at 30 fps, plays on iPhone and WhatsApp.

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

function card(ctx: CanvasRenderingContext2D, plan: VideoPlan, info: VideoInfo, kind: "intro" | "outro", logo: ImageBitmap | null) {
  const { width: W, height: H } = plan;
  const s = Math.min(W, H) / 1080;
  ctx.fillStyle = kind === "intro" ? GREEN : CREAM;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = kind === "intro" ? "#fff" : GREEN;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let y = H * (kind === "intro" ? 0.36 : 0.34);
  if (kind === "intro") {
    if (info.operation) {
      ctx.font = `700 ${34 * s}px Arial, sans-serif`;
      ctx.fillText(info.operation.toUpperCase(), W / 2, y);
      y += 70 * s;
    }
    ctx.font = `800 ${72 * s}px Arial, sans-serif`;
    for (const l of wrap(ctx, info.title, W * 0.84, 3)) {
      ctx.fillText(l, W / 2, y);
      y += 84 * s;
    }
    if (info.location) {
      ctx.font = `500 ${40 * s}px Arial, sans-serif`;
      y += 10 * s;
      for (const l of wrap(ctx, info.location, W * 0.84, 2)) {
        ctx.fillText(l, W / 2, y);
        y += 52 * s;
      }
    }
    ctx.font = `800 ${60 * s}px Arial, sans-serif`;
    y += 40 * s;
    ctx.fillText(info.price, W / 2, y);
    if (info.facts.length) {
      ctx.font = `500 ${36 * s}px Arial, sans-serif`;
      y += 70 * s;
      ctx.fillText(info.facts.slice(0, 4).join("  ·  "), W / 2, y);
    }
  } else {
    if (logo) {
      const lw = Math.min(W * 0.5, logo.width * ((160 * s) / logo.height));
      const lh = (logo.height / logo.width) * lw;
      ctx.drawImage(logo, (W - lw) / 2, y - lh - 30 * s, lw, lh);
    }
    ctx.font = `800 ${60 * s}px Arial, sans-serif`;
    for (const l of wrap(ctx, info.agencyName, W * 0.84, 2)) {
      ctx.fillText(l, W / 2, y);
      y += 72 * s;
    }
    if (info.contact) {
      ctx.font = `600 ${44 * s}px Arial, sans-serif`;
      y += 20 * s;
      ctx.fillText(info.contact, W / 2, y);
    }
    ctx.font = `500 ${34 * s}px Arial, sans-serif`;
    y += 90 * s;
    ctx.fillText("Consultanos por esta propiedad", W / 2, y);
  }
}

function photoScene(ctx: CanvasRenderingContext2D, plan: VideoPlan, asset: VideoAsset, scene: Extract<VideoPlan["scenes"][number], { kind: "photo" }>, progress: number) {
  const { width: W, height: H } = plan;
  const cam = cameraAt(scene, progress);
  const c = coverCrop(asset.image, { width: W, height: H }, cam.zoom, cam.panX, cam.panY);
  ctx.drawImage(asset.image, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H);
  if (asset.staged) {
    // AI images are labelled as such (spec §6.2).
    const s = Math.min(W, H) / 1080;
    const text = "Ambientación virtual con IA";
    ctx.font = `600 ${26 * s}px Arial, sans-serif`;
    const tw = ctx.measureText(text).width;
    const pad = 16 * s;
    ctx.fillStyle = "rgba(20,30,24,0.62)";
    ctx.fillRect(W - tw - pad * 3, H - 64 * s - pad, tw + pad * 2, 48 * s);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
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
    drawFrame(ctx, plan, info, assets, logo, (i * 1000) / plan.fps);
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

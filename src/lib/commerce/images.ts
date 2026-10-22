import "server-only";
import sharp from "sharp";
import { buildPrompt } from "@/lib/catalog";
import { HttpError } from "./http";
import { WATERMARK_PNG } from "./watermark";
export const MAX_BYTES = 3 * 1024 * 1024;
export async function readPhoto(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES + 16384)
    throw new HttpError(413, "La foto es demasiado grande.");
  const data = await request.formData();
  const file = data.get("image");
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > MAX_BYTES ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
  )
    throw new HttpError(400, "Subí una imagen JPG, PNG o WebP de hasta 3 MB.");
  let prompt: string;
  const room = String(data.get("room")),
    style = String(data.get("style")),
    mode = String(data.get("mode")),
    notes = String(data.get("notes") || ""),
    variant = Math.min(3, Math.max(0, Number(data.get("variant")) || 0));
  try {
    prompt = buildPrompt(room, style, mode, notes, variant);
  } catch {
    throw new HttpError(400, "Elegí un ambiente, estilo y operación válidos.");
  }
  let image: Buffer;
  try {
    image = await sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 40_000_000,
      animated: false,
    })
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 94 })
      .toBuffer();
  } catch {
    throw new HttpError(400, "No pudimos leer la imagen. Probá con otra foto.");
  }
  return {
    image,
    prompt,
    room,
    style,
    mode,
    notes,
    name: file.name.replace(/\.[^.]+$/, "").slice(0, 100) || "Mi espacio",
    requestKey: String(data.get("requestKey") || ""),
    projectId: String(data.get("projectId") || ""),
    batchSize: Math.min(
      3,
      Math.max(1, Math.trunc(Number(data.get("batchSize")) || 1)),
    ),
  };
}
export class ProviderError extends Error {
  constructor(
    public code: string,
    public uncertain = false,
  ) {
    super(code);
  }
}
// Free-tier results: smaller and marked, so the full version is clearly worth paying for.
async function watermark(image: Buffer) {
  const { width = 1280 } = await sharp(image).metadata();
  const mark = await sharp(WATERMARK_PNG)
    .resize({ width: Math.round(width * 0.5) })
    .toBuffer();
  return sharp(image)
    .composite([{ input: mark, gravity: "center", blend: "over" }])
    .jpeg({ quality: 88 })
    .toBuffer();
}
export async function renderPhoto(
  image: Buffer,
  prompt: string,
  free = false,
  timeoutMs = 240000,
) {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
  const body = new FormData();
  body.set("model", model);
  body.set(
    "image",
    new Blob([new Uint8Array(image)], { type: "image/jpeg" }),
    "room.jpg",
  );
  body.set("prompt", prompt);
  body.set("n", "1");
  // Paid proposals cost about 3x more in "high". PAID_IMAGE_QUALITY=medium
  // lowers that once a visual test with real listings approves it.
  body.set(
    "quality",
    free || process.env.PAID_IMAGE_QUALITY === "medium" ? "medium" : "high",
  );
  body.set("size", "auto");
  body.set("output_format", "jpeg");
  body.set("output_compression", "94");
  if (["gpt-image-1", "gpt-image-1.5"].includes(model))
    body.set("input_fidelity", "high");
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ProviderError("PROVIDER_CONNECTION_UNKNOWN", true);
  }
  if (!response.ok)
    throw new ProviderError(
      `PROVIDER_${response.status}`,
      response.status >= 500,
    );
  const payload = (await response.json()) as {
    data?: { b64_json?: string }[];
    usage?: Record<string, unknown>;
  };
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64 || b64.length > 24000000)
    throw new ProviderError("INVALID_PROVIDER_RESULT", true);
  const resized = await sharp(Buffer.from(b64, "base64"), {
    limitInputPixels: 40000000,
  })
    .resize({
      width: free ? 1280 : 2048,
      height: free ? 1280 : 2048,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 94 })
    .toBuffer();
  const result = free ? await watermark(resized) : resized;
  // Keep raw usage. A cost is only estimated with explicitly configured per-token rates.
  const usage = payload.usage || null;
  const inputRate = Number(process.env.IMAGE_INPUT_USD_PER_MILLION),
    outputRate = Number(process.env.IMAGE_OUTPUT_USD_PER_MILLION);
  const cost =
    usage &&
    inputRate > 0 &&
    outputRate > 0 &&
    typeof usage.input_tokens === "number" &&
    typeof usage.output_tokens === "number"
      ? (usage.input_tokens * inputRate + usage.output_tokens * outputRate) /
        1e6
      : null;
  return {
    result,
    model,
    usage,
    cost,
    requestId: response.headers.get("x-request-id"),
  };
}

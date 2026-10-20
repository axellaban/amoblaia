import { cookies } from "next/headers";
import sharp from "sharp";
import { buildPrompt } from "@/lib/catalog";
import {
  COOKIE_NAME,
  configured,
  validOrigin,
  verifySession,
} from "@/lib/session";
export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_BYTES = 3 * 1024 * 1024;
export async function POST(request: Request) {
  if (!validOrigin(request))
    return Response.json({ error: "Origen inválido." }, { status: 403 });
  if (!configured())
    return Response.json(
      {
        error:
          "La generación con IA todavía no está configurada. Podés explorar los ejemplos demo.",
      },
      { status: 503 },
    );
  if (
    !verifySession(
      (await cookies()).get(COOKIE_NAME)?.value,
      process.env.STUDIO_ACCESS_PASSWORD,
    )
  )
    return Response.json(
      { error: "Ingresá la clave de acceso al piloto para generar con IA." },
      { status: 401 },
    );
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 16384)
    return Response.json(
      {
        error:
          "La foto es demasiado grande. Volvé a cargarla para optimizarla.",
      },
      { status: 413 },
    );
  try {
    const data = await request.formData();
    const file = data.get("image");
    if (!(file instanceof File) || !file.size || file.size > MAX_BYTES)
      return Response.json(
        { error: "Subí una imagen JPG, PNG o WebP de hasta 3 MB." },
        { status: 400 },
      );
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return Response.json(
        { error: "Formato no compatible. Usá JPG, PNG o WebP." },
        { status: 400 },
      );
    let prompt: string;
    try {
      prompt = buildPrompt(
        String(data.get("room")),
        String(data.get("style")),
        String(data.get("mode")),
        String(data.get("notes") ?? ""),
      );
    } catch {
      return Response.json(
        { error: "Elegí un ambiente, un estilo y una operación válidos." },
        { status: 400 },
      );
    }
    let normalized: Buffer;
    try {
      normalized = await sharp(Buffer.from(await file.arrayBuffer()), {
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
      return Response.json(
        {
          error: "No pudimos leer esta imagen. Probá con otra foto JPG o PNG.",
        },
        { status: 400 },
      );
    }
    const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
    const body = new FormData();
    body.set("model", model);
    body.set(
      "image",
      new Blob([new Uint8Array(normalized)], { type: "image/jpeg" }),
      "room.jpg",
    );
    body.set("prompt", prompt);
    body.set("n", "1");
    body.set("quality", "high");
    body.set("size", "auto");
    body.set("output_format", "jpeg");
    body.set("output_compression", "94");
    if (["gpt-image-1", "gpt-image-1.5"].includes(model))
      body.set("input_fidelity", "high");
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body,
      signal: AbortSignal.timeout(270000),
    });
    if (!response.ok) {
      // No exponemos respuestas crudas del proveedor ni claves en logs o al cliente.
      const status = response.status;
      const message =
        status === 429
          ? "El proveedor está al límite de capacidad o de saldo. Esperá un momento y revisá el saldo de tu API."
          : status === 401 || status === 403
            ? "La API no tiene acceso al modelo. Revisá la clave, la facturación y la verificación de la cuenta."
            : status === 400
              ? "El proveedor no pudo procesar esta foto o configuración. Probá con otra imagen y verificá el modelo configurado."
              : "El proveedor de imágenes no está disponible. Intentá de nuevo en unos minutos.";
      return Response.json(
        { error: message },
        { status: status === 429 ? 429 : 502 },
      );
    }
    const payload = (await response.json()) as {
      data?: { b64_json?: string }[];
    };
    const b64 = payload.data?.[0]?.b64_json;
    if (!b64 || b64.length > 24_000_000)
      return Response.json(
        { error: "La IA no devolvió una imagen válida. Intentá de nuevo." },
        { status: 502 },
      );
    const output = await sharp(Buffer.from(b64, "base64"), {
      limitInputPixels: 40_000_000,
    })
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 94 })
      .toBuffer();
    return new Response(new Uint8Array(output), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-Image-Model": model,
        "Content-Disposition": 'inline; filename="amoblaia.jpg"',
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      return Response.json(
        {
          error:
            "La generación tardó más de lo esperado. Revisá el consumo en tu API antes de reintentar.",
        },
        { status: 504 },
      );
    return Response.json(
      {
        error:
          "No pudimos completar la solicitud. Revisá la conexión e intentá de nuevo.",
      },
      { status: 500 },
    );
  }
}

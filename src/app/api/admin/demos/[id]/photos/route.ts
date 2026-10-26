import sharp from "sharp";
import { requireAdmin, failure, HttpError, rpc } from "@/lib/commerce/http";
import { MAX_BYTES } from "@/lib/commerce/images";
import { addPhoto, demoRow } from "@/lib/demos/server";
import { readJson } from "@/lib/demos/input";
import { fetchPublic } from "@/lib/demos/listing";
import { cleanUrl } from "@/lib/demos/shared";
export const runtime = "nodejs";

/** Smaller pictures on a listing are thumbnails or site graphics, not photos worth staging. */
const MIN_SIDE = 600;

/** A photo downloaded from the listing: { url } in JSON. */
async function fromUrl(request: Request) {
  const body = await readJson(request);
  const address = cleanUrl(body.url);
  if (!address) throw new HttpError(400, "Dirección de foto inválida.");
  const image = await fetchPublic(address, "image");
  if (image.type && !/^image\//i.test(image.type))
    throw new HttpError(422, "No es una foto.");
  const meta = await sharp(image.body, { limitInputPixels: 40_000_000 })
    .metadata()
    .catch(() => null);
  if (!meta?.width || !meta.height || !["jpeg", "png", "webp", "avif"].includes(meta.format ?? ""))
    throw new HttpError(422, "No es una foto.");
  if (Math.max(meta.width, meta.height) < MIN_SIDE)
    throw new HttpError(422, "La foto es demasiado chica.");
  const file = new URL(image.url).pathname.split("/").pop() || "";
  let name = file;
  try {
    name = decodeURIComponent(file);
  } catch {
    // A malformed escape keeps the raw file name.
  }
  return { bytes: image.body, name: name.replace(/\.[^.]+$/, "") };
}

/** An uploaded file: "image" in multipart form data. */
async function fromUpload(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES + 16384)
    throw new HttpError(413, "La foto es demasiado grande.");
  const data = await request.formData().catch(() => null);
  const file = data?.get("image");
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > MAX_BYTES ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
  )
    throw new HttpError(400, "Subí una imagen JPG, PNG o WebP de hasta 3 MB.");
  return { bytes: Buffer.from(await file.arrayBuffer()), name: file.name.replace(/\.[^.]+$/, "") };
}

/** One photo per request (the panel uploads or imports several in sequence, with progress). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    const demo = await demoRow(id);
    const photo = /json/i.test(request.headers.get("content-type") || "")
      ? await fromUrl(request)
      : await fromUpload(request);
    await rpc("amobla_account", { p_user: actor.id, p_trial: false });
    const row = await addPhoto(demo, actor.id, photo.bytes, photo.name);
    return Response.json(
      { id: row.id },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

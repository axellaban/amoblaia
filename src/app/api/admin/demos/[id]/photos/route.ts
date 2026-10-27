import sharp from "sharp";
import { failure, HttpError, rpc } from "@/lib/commerce/http";
import { requireDemoAccess } from "@/lib/agency/server";
import { MAX_BYTES } from "@/lib/commerce/images";
import { addPhoto } from "@/lib/demos/server";
import { assignPhotos } from "@/lib/demos/spaces";
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
  return { bytes: image.body, name: name.replace(/\.[^.]+$/, ""), reuse: body.reuse === true, space: null as string | null };
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
  const space = data?.get("space");
  return {
    bytes: Buffer.from(await file.arrayBuffer()),
    name: file.name.replace(/\.[^.]+$/, ""),
    reuse: false,
    space: typeof space === "string" && space ? space : null,
  };
}

/** One photo per request (the panel uploads or imports several in sequence, with progress). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { actor, demo, billingUser } = await requireDemoAccess(request, id);
    const photo = /json/i.test(request.headers.get("content-type") || "")
      ? await fromUrl(request)
      : await fromUpload(request);
    // An agency's photos belong to its owner (whose credits stage them) and
    // never reuse another account's copy; the team's demos share theirs.
    const owner = billingUser ?? actor.id;
    await rpc("amobla_account", { p_user: owner, p_trial: false });
    const row = await addPhoto(demo, owner, photo.bytes, photo.name, {
      reuse: photo.reuse,
      ownOnly: Boolean(billingUser),
    });
    // Uploaded straight into a space: the photo is saved either way; a failed grouping is said, not hidden.
    let spaceError: string | null = null;
    if (photo.space)
      await assignPhotos(demo.property_id, [row.id], photo.space).catch((e) => {
        spaceError = e instanceof HttpError ? e.message : "No pudimos ubicarla en el espacio.";
      });
    return Response.json(
      { id: row.id, reused: row.reused, spaceError },
      { status: row.reused ? 200 : 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

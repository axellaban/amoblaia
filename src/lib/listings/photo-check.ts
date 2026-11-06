// Whether a file downloaded from a listing is a photo worth staging, and if
// not, why — in words the panel shows next to that photo.
//
// The format is read from the bytes, not from the Content-Type the site sends:
// several Argentine sites (the .asp ones of Paradiso and Gordin) serve WebP
// as "application/webp", which a check on "image/*" took for "not a photo".
import sharp from "sharp";
import { HttpError } from "@/lib/commerce/http";

/** Smaller pictures on a listing are thumbnails or site graphics, not photos worth staging. */
export const MIN_SIDE = 600;
const FORMATS = ["jpeg", "png", "webp", "avif"];

export async function checkPhoto(bytes: Buffer, contentType: string) {
  const meta = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .metadata()
    .catch(() => null);
  if (!meta?.width || !meta.height) {
    // A page where a photo was expected: an error or login page served with status 200.
    if (/html|text\//i.test(contentType)) throw new HttpError(422, "El sitio devolvió una página en lugar de la foto.");
    throw new HttpError(422, "El archivo no es una imagen que podamos leer.");
  }
  if (!FORMATS.includes(meta.format ?? ""))
    throw new HttpError(422, `La imagen está en formato ${String(meta.format ?? "desconocido").toUpperCase()}: usamos JPG, PNG, WebP o AVIF.`);
  if (Math.max(meta.width, meta.height) < MIN_SIDE)
    throw new HttpError(422, `La foto es demasiado chica (${meta.width}×${meta.height} px; mínimo ${MIN_SIDE} px de lado).`);
  return { width: meta.width, height: meta.height, format: meta.format as string };
}

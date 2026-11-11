import { failure, HttpError } from "@/lib/commerce/http";
import { requireAgency } from "@/lib/agency/server";
import { uploadSiteImage } from "@/lib/site/server";
export const runtime = "nodejs";

const MAX_UPLOAD = 12 * 1024 * 1024;

/** An image for the site (portada, equipo, galería…): returns its public URL. Owner and admins. */
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") || 0) > MAX_UPLOAD + 16384) throw new HttpError(413, "La imagen es demasiado grande (máximo 12 MB).");
    const { agency } = await requireAgency(request, "manage");
    const form = await request.formData().catch(() => null);
    const file = form?.get("image");
    if (!(file instanceof File) || !file.size || file.size > MAX_UPLOAD || !["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw new HttpError(400, "Subí una imagen JPG, PNG o WebP de hasta 12 MB.");
    const url = await uploadSiteImage(agency.id, Buffer.from(await file.arrayBuffer()), form?.get("purpose") === "logo" ? "logo" : "photo");
    return Response.json({ url }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

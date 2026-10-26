import { requireAdmin, failure, HttpError } from "@/lib/commerce/http";
import { adminImagePath, renderImage } from "@/lib/demos/server";
import { imageWidth } from "@/lib/demos/shared";
export const runtime = "nodejs";

/** Web-sized copies of demo photos and proposals for the panel and the preview. Admins only. */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const q = new URL(request.url).searchParams;
    const path = await adminImagePath({
      photoId: q.get("foto"),
      variant: q.get("v"),
      generationId: q.get("generacion"),
    });
    const image = path ? await renderImage(path, imageWidth(q.get("w"))) : null;
    if (!image) throw new HttpError(404, "No encontramos la imagen.");
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/jpeg",
        // Each URL names one immutable file (versions change the URL).
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return failure(e);
  }
}

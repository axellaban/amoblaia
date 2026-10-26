import { requireAdmin, failure, HttpError } from "@/lib/commerce/http";
import { adminImagePaths, renderImage, renderPreview } from "@/lib/demos/server";
import { validStyle } from "@/lib/demos/input";
import { imageWidth } from "@/lib/demos/shared";
export const runtime = "nodejs";

/** Web-sized copies of demo photos and proposals for the panel and the preview. Admins only. */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const q = new URL(request.url).searchParams;
    const style = q.get("estilo");
    const paths = await adminImagePaths({
      photoId: q.get("foto"),
      style: validStyle(style) ? style : null,
      generationId: q.get("generacion"),
    });
    const image = !paths
      ? null
      : q.get("og") === "1"
        ? await renderPreview(paths)
        : await renderImage(paths.staged ?? paths.original, imageWidth(q.get("w")));
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

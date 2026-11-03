import { publicImagePaths, publicRetouchPaths, renderImage, renderPreview } from "@/lib/demos/server";
import { imageWidth } from "@/lib/demos/shared";
import { validStyle } from "@/lib/demos/input";
import { cloudConfigured } from "@/lib/supabase/config";
export const runtime = "nodejs";

const notFound = () =>
  new Response("No encontrado", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });

/**
 * Images of a published demo. The bucket stays private: each request checks
 * that the demo is published and the photo visible, then serves a web-sized
 * copy, so no storage path, signed URL or account id reaches the page.
 * `e` names a style (its staged version); `og=1` is the link preview card.
 * Edge caching is short so unpublishing takes effect within minutes.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; photoId: string }> },
) {
  try {
    if (!cloudConfigured()) return notFound();
    const { token, photoId } = await params;
    const q = new URL(request.url).searchParams;
    const style = q.get("e");
    // "t": a retouch the listing shows; "e": a style's version.
    const retouch = q.get("t");
    const paths = retouch
      ? await publicRetouchPaths(token, photoId, retouch)
      : await publicImagePaths(token, photoId, validStyle(style) ? style : null);
    if (!paths) return notFound();
    const image =
      q.get("og") === "1"
        ? await renderPreview(paths)
        : await renderImage(paths.staged ?? paths.original, imageWidth(q.get("w")));
    if (!image) return notFound();
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=600, s-maxage=600",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch {
    console.error("demo_image_failed");
    return new Response("Error", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

import { publicImagePath, renderImage } from "@/lib/demos/server";
import { imageWidth } from "@/lib/demos/shared";
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
    const variant = q.get("v") === "staged" ? "staged" : "original";
    const path = await publicImagePath(token, photoId, variant);
    if (!path) return notFound();
    const og = q.get("og") === "1";
    const image = await renderImage(path, imageWidth(q.get("w")), og);
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

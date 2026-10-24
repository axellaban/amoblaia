import { adminClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/commerce/jobs";
import { publicAssetPath, stampDisclosure } from "@/lib/showcase";
import { parseImageRef } from "@/lib/showcase-shared";
export const runtime = "nodejs";
const missing = () =>
  new Response("No disponible", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
/**
 * Images of a public showcase. Each request checks that the link is still
 * active and that the image belongs to it, so turning the link off also cuts
 * the images (browsers may keep a copy for up to a minute). Proposals carry
 * the disclosure burned in, so a saved copy keeps it too.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; ref: string }> },
) {
  const { token, ref } = await params;
  const parsed = parseImageRef(ref);
  if (!parsed) return missing();
  try {
    const path = await publicAssetPath(token, parsed);
    if (!path) return missing();
    const file = await adminClient().storage.from(BUCKET).download(path);
    if (file.error || !file.data) return missing();
    let body = Buffer.from(await file.data.arrayBuffer());
    if (parsed.kind === "proposal") body = await stampDisclosure(body);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=60",
        "X-Robots-Tag": "noindex",
        // Only pages of this site (the showcase and its embed) show them.
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch {
    console.error("showcase_image_failed");
    return new Response("No disponible", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

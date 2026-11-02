import { publicVideoLink } from "@/lib/demos/server";
import { cloudConfigured } from "@/lib/supabase/config";
export const runtime = "nodejs";

/**
 * The video of a published demo, without signing up. The bucket stays
 * private: each request checks that the demo is published and still shows
 * this video, then redirects to a link that expires in an hour. The page
 * keeps this stable address, so a shared ficha never carries an expired link.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; videoId: string }> }) {
  try {
    if (!cloudConfigured()) return new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });
    const { token, videoId } = await params;
    const url = await publicVideoLink(token, videoId);
    if (!url) return new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, max-age=300", "X-Robots-Tag": "noindex" },
    });
  } catch {
    console.error("demo_video_failed");
    return new Response("Error", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

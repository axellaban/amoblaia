import { adminClient } from "@/lib/supabase/server";
import { logoOf } from "@/lib/demos/server";
import { TOKEN_PATTERN } from "@/lib/demos/shared";
import { cloudConfigured } from "@/lib/supabase/config";
export const runtime = "nodejs";

const notFound = () =>
  new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });

/** The agency's logo on a published demo (the URL carries its version, so it caches). */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!cloudConfigured()) return notFound();
    const { token } = await params;
    if (!TOKEN_PATTERN.test(token)) return notFound();
    const { data } = await adminClient()
      .from("demos")
      .select("agency_id")
      .eq("token", token)
      .eq("status", "published")
      .maybeSingle();
    const logo = data ? await logoOf((data as { agency_id: string }).agency_id) : null;
    if (!logo) return notFound();
    return new Response(new Uint8Array(logo.bytes), {
      headers: {
        "Content-Type": logo.type,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch {
    console.error("demo_logo_failed");
    return new Response("Error", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

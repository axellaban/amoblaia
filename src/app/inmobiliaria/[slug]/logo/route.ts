import { logoOf } from "@/lib/demos/server";
import { validSlug } from "@/lib/agency/shared";
import { adminClient } from "@/lib/supabase/server";
import { cloudConfigured } from "@/lib/supabase/config";
export const runtime = "nodejs";

const notFound = () => new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });

/** The agency's logo on its published site (the URL carries its version, so it caches). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    if (!cloudConfigured()) return notFound();
    const { slug } = await params;
    if (!validSlug(slug)) return notFound();
    const { data } = await adminClient().from("agencies").select("id").eq("slug", slug).eq("site_published", true).maybeSingle();
    const logo = data ? await logoOf((data as { id: string }).id) : null;
    if (!logo) return notFound();
    return new Response(new Uint8Array(logo.bytes), {
      headers: { "Content-Type": logo.type, "Cache-Control": "public, max-age=86400, s-maxage=86400" },
    });
  } catch {
    console.error("site_logo_failed");
    return new Response("Error", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

import { HttpError, failure } from "@/lib/commerce/http";
import { INVITE_CODE } from "@/lib/agency/demo-invite";
import { liveInvitation } from "@/lib/agency/visit";
import { readJson } from "@/lib/demos/input";
import { publishedDemo } from "@/lib/demos/server";
import { internalRequest } from "@/lib/internal/server";
import { cloudConfigured } from "@/lib/supabase/config";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * «Quiero esto para mi inmobiliaria», from the property assistant of the
 * agency's own demo, before it has an account. The invitation in the request
 * must be live and belong to this demo's agency (a buyer's link cannot ask in
 * its name). One request per agency: a repeat answers `already`. The team's
 * own visits (internal traffic) are answered but never saved. No free text,
 * no personal data: the agency and the demo are all it stores.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!cloudConfigured()) throw new HttpError(503, "No pudimos registrar tu solicitud. Probá de nuevo en unos minutos.");
    const { token } = await params;
    const body = await readJson(request, 512);
    const code = typeof body.code === "string" && INVITE_CODE.test(body.code) ? body.code : null;
    const demo = await publishedDemo(token);
    if (!demo) throw new HttpError(404, "Esta demo no está disponible.");
    const invitation = code ? await liveInvitation(code).catch(() => null) : null;
    if (!invitation || invitation.agency.id !== demo.agencyId)
      throw new HttpError(403, "Abrí la demo desde el enlace de tu inmobiliaria para pedir acceso.");
    const internal = await internalRequest().catch(() => ({ internal: false, reason: null }));
    if (internal.internal) return Response.json({ registered: false, internal: true }, { headers: NO_STORE });

    const { error } = await adminClient().from("commercial_product_interest").insert({
      agency_id: demo.agencyId,
      user_id: null,
      product_key: "asistente_propiedad",
      source_surface: "demo_owner",
      demo_id: demo.id,
    });
    // The unique index (one per agency from the demo): already asked.
    if (error?.code === "23505") return Response.json({ registered: true, already: true }, { headers: NO_STORE });
    if (error) throw new Error("BUYER_AGENT_INTEREST_SAVE_FAILED");
    return Response.json({ registered: true, already: false }, { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

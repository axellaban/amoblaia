import { failure, HttpError } from "@/lib/commerce/http";
import { validSlug } from "@/lib/agency/shared";
import { readJson } from "@/lib/demos/input";
import { addInquiry, type InquiryKind } from "@/lib/site/server";
import { adminClient } from "@/lib/supabase/server";
import { cloudConfigured } from "@/lib/supabase/config";
export const runtime = "nodejs";

const KINDS: InquiryKind[] = ["contacto", "tasacion", "propiedad", "newsletter"];
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) || null : null);

/**
 * A form of an agency's published site (contacto, tasación, newsletter):
 * stored for the agency, who reads it in Sitio web → Consultas. Public; a
 * hidden field and a minimum time keep most bots out.
 */
export async function POST(request: Request) {
  try {
    if (!cloudConfigured()) throw new HttpError(503, "No disponible.");
    const body = await readJson(request, 12000);
    // Bots fill every field and send at once; people do neither.
    const started = typeof body.t === "number" ? body.t : 0;
    if (text(body.empresa, 200) || !started || Date.now() - started < 2500) return Response.json({ sent: true });
    const slug = body.slug;
    if (!validSlug(slug)) throw new HttpError(404, "Sitio no encontrado.");
    const { data } = await adminClient().from("agencies").select("id").eq("slug", slug).eq("site_published", true).maybeSingle();
    if (!data) throw new HttpError(404, "Sitio no encontrado.");
    const kind = KINDS.includes(body.kind as InquiryKind) ? (body.kind as InquiryKind) : "contacto";
    const email = text(body.email, 160);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Revisá el email.");
    const phone = text(body.phone, 40);
    if (!email && !phone) throw new HttpError(400, kind === "newsletter" ? "Ingresá tu email." : "Dejanos un email o un teléfono para responderte.");
    const details: Record<string, string> = {};
    if (body.details && typeof body.details === "object")
      for (const [k, v] of Object.entries(body.details as Record<string, unknown>).slice(0, 12)) {
        const value = text(v, 200);
        if (value && /^[a-zA-Z]{1,24}$/.test(k)) details[k] = value;
      }
    await addInquiry((data as { id: string }).id, {
      kind,
      name: text(body.name, 120),
      email,
      phone,
      message: text(body.message, 3000),
      property_token: typeof body.token === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(body.token) ? body.token : null,
      page: text(body.page, 60),
      details,
    });
    return Response.json({ sent: true });
  } catch (e) {
    return failure(e);
  }
}

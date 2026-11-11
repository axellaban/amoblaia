import { failure, HttpError, requireUser } from "@/lib/commerce/http";
import { membershipFor } from "@/lib/agency/server";
import { readJson } from "@/lib/demos/input";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
const PRODUCTS = ["consultas_ia", "crm_inteligente"] as const;
const VOLUMES = ["1-10", "11-30", "31-100", "100+"] as const;
const PAINS = ["responder_fuera_de_horario", "calificar_leads", "agendar_visitas", "seguimiento", "priorizar_oportunidades", "medir_conversion"] as const;
const READINESS = ["esta_semana", "este_mes", "mas_adelante"] as const;
const includes = (values: readonly string[], value: unknown): value is string => typeof value === "string" && values.includes(value);

/** Single idempotent, authenticated interest signal; never accepts free text, PII or a client-supplied agency ID. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const membership = await membershipFor(user);
    if (!membership) throw new HttpError(404, "Todavía no tenés una inmobiliaria en Habita.");
    if (membership.support) throw new HttpError(403, "No se puede registrar interés desde la vista de soporte.");
    const body = await readJson(request, 1024);
    if (!includes(PRODUCTS, body.product) || !includes(VOLUMES, body.volumeBand) ||
        !includes(PAINS, body.primaryPain) || !includes(READINESS, body.readiness)) {
      throw new HttpError(400, "Completá las opciones para solicitar acceso.");
    }
    const { error } = await adminClient().from("commercial_product_interest").upsert({
      agency_id: membership.agency.id,
      user_id: user.id,
      product_key: body.product,
      volume_band: body.volumeBand,
      primary_pain: body.primaryPain,
      readiness: body.readiness,
      source_surface: "commercial_workspace",
      updated_at: new Date().toISOString(),
    }, { onConflict: "agency_id,user_id,product_key" });
    if (error) throw new Error("COMMERCIAL_INTEREST_SAVE_FAILED");
    return Response.json({ registered: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return failure(e); }
}

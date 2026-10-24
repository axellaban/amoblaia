import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { normalizeWhatsapp } from "./showcase-shared";
/** Validates the editable fields of a showcase; partial for updates. */
export function readShowcaseFields(body: Record<string, unknown>, partial: boolean) {
  const fields: Record<string, unknown> = {};
  if (!partial || body.title !== undefined) {
    if (
      typeof body.title !== "string" ||
      !body.title.trim() ||
      body.title.trim().length > 120
    )
      throw new HttpError(400, "Ingresá un título de hasta 120 caracteres.");
    fields.title = body.title.trim();
  }
  if (!partial || body.agencyName !== undefined) {
    const name = typeof body.agencyName === "string" ? body.agencyName.trim() : "";
    if (name.length > 80)
      throw new HttpError(400, "El nombre de la inmobiliaria admite hasta 80 caracteres.");
    fields.agency_name = name || null;
  }
  if (!partial || body.whatsapp !== undefined) {
    const phone = normalizeWhatsapp(body.whatsapp);
    if (!phone)
      throw new HttpError(
        400,
        "Ingresá el WhatsApp con código de país y área, solo números. Ej.: 5492235551234.",
      );
    fields.whatsapp = phone;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") throw new HttpError(400, "Estado inválido.");
    fields.active = body.active;
  }
  return fields;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The showcase if it belongs to this user and was not deleted; 404 otherwise. */
export async function ownedShowcase(userId: string, id: string) {
  if (!UUID.test(id)) throw new HttpError(404, "No encontramos esa ficha.");
  const { data, error } = await adminClient()
    .from("showcases")
    .select("id,agency_logo_path")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error("SHOWCASE_LOOKUP_FAILED");
  if (!data) throw new HttpError(404, "No encontramos esa ficha.");
  return data as { id: string; agency_logo_path: string | null };
}

import { HttpError, requireAdmin } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { EMAIL_RE, normalizeWhatsapp } from "@/lib/prospecting/import";
import { body, NO_STORE, prospectFailure, prospectRpc, text } from "@/lib/prospecting/server";
export const runtime = "nodejs";

const CHANNELS = new Set(["whatsapp", "email", "phone", "instagram", "web", "other"]);

/**
 * Adds ({contactId: null}) or edits a private commercial contact: verify it,
 * mark it invalid, make it primary. These contacts are never the public
 * contact that buyers see on a demo or the agency's site.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la cuenta.");
    const b = await body(request);
    if (b.contactId != null && !isUuid(b.contactId)) throw new HttpError(400, "Contacto inválido.");
    const fields: Record<string, unknown> = {};
    if (b.channel != null) {
      if (typeof b.channel !== "string" || !CHANNELS.has(b.channel)) throw new HttpError(400, "Canal no válido.");
      fields.channel = b.channel;
    }
    if ("address" in b) {
      const raw = text(b.address, 300);
      const channel = (fields.channel as string | undefined) ?? (typeof b.currentChannel === "string" ? b.currentChannel : null);
      let address = raw;
      if (raw && channel === "whatsapp") {
        // A WhatsApp number typed by hand must already be complete (+549…): nothing is guessed here.
        const n = normalizeWhatsapp("", raw);
        if (!n.address || n.review) throw new HttpError(400, "Escribí el número completo con 549 y la característica, por ejemplo +54 9 223 123 4567.");
        address = n.address;
      }
      if (raw && channel === "email") {
        address = raw.toLowerCase();
        if (!EMAIL_RE.test(address)) throw new HttpError(400, "Email inválido.");
      }
      fields.address = address;
      if (!b.contactId) fields.address_original = raw;
    }
    for (const [k, max] of [["person_name", 160], ["role", 120], ["confidence", 60], ["source", 200], ["source_url", 500], ["invalid_reason", 300]] as const)
      if (k in b) fields[k] = text(b[k], max);
    for (const k of ["is_decision_maker", "is_primary", "verified", "invalid"] as const) {
      if (k in b) {
        if (typeof b[k] !== "boolean") throw new HttpError(400, "Valor inválido.");
        fields[k] = b[k];
      }
    }
    if (!b.contactId && !fields.channel) throw new HttpError(400, "Elegí el canal.");
    const contact = await prospectRpc("habita_prospect_contact", { p_actor: actor.id, p_account: id, p_contact: b.contactId ?? null, p_fields: fields });
    return Response.json(contact, { headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}

import { HttpError, requireAdmin } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { body, NO_STORE, prospectFailure, prospectRpc, text } from "@/lib/prospecting/server";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const CHANNELS = new Set(["whatsapp", "email", "phone", "instagram", "web", "other"]);

/** Opt-out of the whole account, one channel or one contact. Prepared attempts it covers are cancelled. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la cuenta.");
    const b = await body(request);
    if (b.scope !== "account" && b.scope !== "channel" && b.scope !== "contact") throw new HttpError(400, "Alcance de baja no válido.");
    if (b.scope === "channel" && (typeof b.channel !== "string" || !CHANNELS.has(b.channel))) throw new HttpError(400, "Elegí el canal.");
    if (b.scope === "contact" && !isUuid(b.contactId)) throw new HttpError(400, "Elegí el contacto.");
    const s = await prospectRpc("habita_prospect_suppress", {
      p_actor: actor.id,
      p_account: id,
      p_scope: b.scope,
      p_channel: b.scope === "channel" ? b.channel : null,
      p_contact: b.scope === "contact" ? b.contactId : null,
      p_reason: text(b.reason, 300),
    });
    return Response.json(s, { status: 201, headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}

/** Lifts an opt-out, with a reason (e.g. the agency asked to hear from us again). */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la cuenta.");
    const b = await body(request);
    if (!isUuid(b.suppressionId)) throw new HttpError(400, "Baja inválida.");
    const s = await prospectRpc("habita_prospect_lift", { p_actor: actor.id, p_suppression: b.suppressionId, p_reason: text(b.reason, 300) });
    return Response.json(s, { headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}

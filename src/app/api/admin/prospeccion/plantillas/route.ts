import { HttpError, requireAdmin } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { body, NO_STORE, prospectFailure, prospectRpc, text } from "@/lib/prospecting/server";
export const runtime = "nodejs";

/** A new template (version 1), or a new immutable version of one ({templateId}). Sent messages keep their frozen text. */
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const b = await body(request);
    const messageBody = typeof b.body === "string" ? b.body.replace(/\r\n/g, "\n").trim() : "";
    if (!messageBody || messageBody.length > 4000) throw new HttpError(400, "Escribí el texto (hasta 4000 caracteres).");
    if (b.templateId != null && !isUuid(b.templateId)) throw new HttpError(400, "Plantilla inválida.");
    if (!b.templateId) {
      if (!text(b.name, 80)) throw new HttpError(400, "Poné un nombre a la plantilla.");
      if (b.channel !== "whatsapp" && b.channel !== "email") throw new HttpError(400, "Elegí WhatsApp o email.");
      if (!Number.isInteger(b.step) || (b.step as number) < 0 || (b.step as number) > 3) throw new HttpError(400, "Paso no válido.");
    }
    const v = await prospectRpc("habita_prospect_template", {
      p_actor: actor.id,
      p_template: b.templateId ?? null,
      p_name: text(b.name, 80),
      p_purpose: text(b.purpose, 300),
      p_step: b.step ?? null,
      p_channel: b.channel ?? null,
      p_subject: text(b.subject, 200),
      p_body: messageBody,
    });
    return Response.json(v, { status: 201, headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}

import { HttpError, requireAdmin } from "@/lib/commerce/http";
import { demoUrl, isUuid } from "@/lib/demos/shared";
import { render, unresolved } from "@/lib/prospecting/render";
import { body, NO_STORE, prospectFailure, prospectRpc, renderContext, text } from "@/lib/prospecting/server";
export const runtime = "nodejs";

/**
 * Prepares (freezes) one message for a reviewed recipient. It never sends and
 * never counts as sent. The text is compared with the server's rendering of
 * the chosen template version: any edit makes it a custom message, so it is
 * never counted as that variant. `key` (uuid) makes a retry return the same
 * attempt.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const b = await body(request);
    if (!isUuid(b.key) || !isUuid(b.accountId) || !isUuid(b.contactId)) throw new HttpError(400, "Faltan la cuenta, el contacto o la clave.");
    if (b.templateVersionId != null && !isUuid(b.templateVersionId)) throw new HttpError(400, "Plantilla inválida.");
    if (!Number.isInteger(b.step) || (b.step as number) < 0 || (b.step as number) > 3) throw new HttpError(400, "Paso no válido.");
    if (b.reviewed !== true) throw new HttpError(400, "Confirmá que revisaste el destinatario antes de preparar el intento.");
    const messageBody = typeof b.body === "string" ? b.body.replace(/\r\n/g, "\n").trim() : "";
    const subject = text(b.subject, 200);
    const missing = unresolved(`${subject ?? ""} ${messageBody}`);
    if (missing.length) throw new HttpError(400, `Completá ${missing.map((m) => `{{${m}}}`).join(", ")} antes de preparar.`);

    let custom = true;
    if (b.templateVersionId) {
      const c = await renderContext(b.accountId, b.templateVersionId);
      if (c) {
        const ctx = {
          inmobiliaria: c.name,
          decisor: c.decision_maker,
          sdr: text(b.sender, 160) ?? c.sdr,
          demo: c.demo_token ? demoUrl(new URL(request.url).origin, c.demo_token) : null,
        };
        custom = render(c.body, ctx).trim() !== messageBody || (render(c.subject ?? "", ctx).trim() || null) !== subject;
      }
    }
    const attempt = await prospectRpc<{ id: string; replayed?: boolean }>("habita_prospect_prepare", {
      p_actor: actor.id,
      p_key: b.key,
      p_account: b.accountId,
      p_contact: b.contactId,
      p_step: b.step,
      p_campaign: text(b.campaign, 80),
      p_template_version: b.templateVersionId ?? null,
      p_custom: custom,
      p_subject: subject,
      p_body: messageBody,
      p_sender: text(b.sender, 160),
      p_reviewed: true,
    });
    return Response.json(attempt, { status: attempt.replayed ? 200 : 201, headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}

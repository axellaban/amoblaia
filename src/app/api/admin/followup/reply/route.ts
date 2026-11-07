import { processReply, registerReply } from "@/lib/followup/server";
import { agentRoute } from "@/lib/followup/route";
export const runtime = "nodejs";

/**
 * Registra una respuesta de WhatsApp: `{ inmobiliaria, texto, hora?, clasificacion?, confianza?, nota?, hasta?, contactoNombre?, contactoWhatsapp? }`.
 * Con clasificación y confianza ≥ 0,7 se aplica sola; un audio, una pregunta no cubierta o confianza baja va a Facu; sin clasificación queda en la bandeja.
 * Para resolver una de la bandeja: `{ id, clasificacion, hasta?, contactoNombre?, contactoWhatsapp? }` o `{ id, facu: true, nota? }`.
 */
export const POST = agentRoute((b, actor) =>
  typeof b.id === "string"
    ? processReply(b.id, { classification: b.clasificacion, until: b.hasta, contactName: b.contactoNombre, contactWhatsapp: b.contactoWhatsapp, facu: b.facu, note: b.nota }, actor)
    : registerReply(
        { agencyId: b.inmobiliaria, text: b.texto, receivedAt: b.hora, classification: b.clasificacion, confidence: b.confianza, note: b.nota, until: b.hasta, contactName: b.contactoNombre, contactWhatsapp: b.contactoWhatsapp },
        actor,
      ),
);

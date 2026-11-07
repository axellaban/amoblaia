import "server-only";
// La lista «Inmobiliarias» del equipo (/admin/inmobiliarias) para el panel comercial de Chapa Labs,
// servidor a servidor por /api/prospeccion: las mismas filas, los mismos reclamos a revisar y las
// mismas acciones de la lista (Creada/Enviada, link de la demo, link del panel, recalcular scores),
// con la misma lógica que sus botones. Chapa arma la vista; acá no se decide nada distinto.
import { HttpError } from "@/lib/commerce/http";
import { claimsToReview, createClaim } from "@/lib/agency/admin";
import { commercialRow, commercialRows } from "@/lib/agency/commercial-server";
import { legacyProspectStep } from "@/lib/agency/demo-funnel";
import { agencyPanelLink } from "@/lib/agency/panel-link";
import { demoRow, adminImagePaths, renderImage } from "@/lib/demos/server";
import { normalizeArNumber } from "@/lib/demos/send";
import { demoUrl, imageWidth, isUuid } from "@/lib/demos/shared";
import { recomputeAll } from "@/lib/leads/server";
import { adminClient } from "@/lib/supabase/server";

/** Las filas de la lista y los reclamos a revisar. `wa`: el número para wa.me (null sin uno válido). */
export async function agencyList() {
  const [rows, toReview] = await Promise.all([commercialRows(), claimsToReview().catch(() => [])]);
  // Chapa still reads the prospecting step in the old three-step encoding (with «Saludo respondido»).
  return {
    rows: rows.map((r) => ({
      ...r,
      prospectFunnel: r.prospectFunnel ? { ...r.prospectFunnel, step: legacyProspectStep(r.prospectFunnel) } : r.prospectFunnel,
      wa: normalizeArNumber(r.whatsapp ?? null),
    })),
    toReview,
  };
}

/** La portada de una demo, chica, para la lista (la misma imagen que muestra /admin/inmobiliarias). */
export async function agencyThumb(photoId: string, width: unknown) {
  if (!isUuid(photoId)) throw new HttpError(404, "No encontramos la imagen.");
  const paths = await adminImagePaths({ photoId });
  const image = paths ? await renderImage(paths.staged ?? paths.original, imageWidth(width ?? 120)) : null;
  if (!image) throw new HttpError(404, "No encontramos la imagen.");
  return image;
}

/**
 * «Creada» ↔ «Enviada», como DemoStepMenu: «Enviada» marca todas sus demos sin enviar (con una
 * enviada alcanza para el ciclo comercial) y «Creada» las desmarca. Queda en la auditoría.
 */
export async function setDemosSent(agencyId: string, sent: boolean, actorId: string, from = "chapa") {
  if (!isUuid(agencyId)) throw new HttpError(404, "No encontramos la inmobiliaria.");
  const db = adminClient();
  const { data, error } = await db.from("demos").select("id,sent_at").eq("agency_id", agencyId);
  if (error) throw new Error("DEMOS_LOOKUP_FAILED");
  const targets = ((data ?? []) as { id: string; sent_at: string | null }[]).filter((d) => (sent ? !d.sent_at : d.sent_at));
  for (const d of targets) {
    const update = db.from("demos").update({ sent_at: sent ? new Date().toISOString() : null }).eq("id", d.id);
    const saved = await (sent ? update.is("sent_at", null) : update);
    if (saved.error) throw new Error("DEMO_SENT_FAILED");
    await db.from("admin_audit").insert({ actor_id: actorId, action: sent ? "demo_sent" : "demo_unsent", subject_id: d.id, details: { by: "manual", from } });
  }
  return targets.length;
}

/**
 * El link de «Demo» de la lista: su última demo publicada como la ve la inmobiliaria. Sin cuenta,
 * con un código para reclamarla (un uso, 30 días), igual que el botón de la lista.
 */
export async function agencyDemoLink(agencyId: string, actorId: string, origin: string) {
  const row = await commercialRow(agencyId);
  if (!row) throw new HttpError(404, "No encontramos la inmobiliaria.");
  if (!row.shareDemo) throw new HttpError(409, "Todavía no tiene una demo publicada.");
  if (row.hasOwner) return { url: demoUrl(origin, row.shareDemo.token, true) };
  const demo = await demoRow(row.shareDemo.id);
  let title = demo.title?.trim() ?? "";
  if (!title) {
    const { data } = await adminClient().from("demo_properties").select("title").eq("id", demo.property_id).maybeSingle();
    title = (data as { title: string } | null)?.title ?? "";
  }
  const claim = await createClaim(agencyId, actorId, origin, { id: demo.id, token: demo.token, title });
  return { url: (claim as { presentationUrl?: string | null }).presentationUrl ?? demoUrl(origin, demo.token, true) };
}

/** El link fijo de su panel («Panel» en la lista). */
export const agencyPanel = (agencyId: string, actorId: string, origin: string) => agencyPanelLink(agencyId, actorId, origin);

/** «Recalcular lead scores». */
export const recalcScores = () => recomputeAll();

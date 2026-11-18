import { failure, HttpError } from "@/lib/commerce/http";
import { requireDemoAccess, stagingRule } from "@/lib/agency/server";
import { auditAgencyEdit } from "@/lib/agency/edit-context";
import { chooseForDemo, importListingPhotos } from "@/lib/demos/auto-prep";
import { readJson } from "@/lib/demos/input";
export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };
const PRIVATE = { "Cache-Control": "private, no-store" };

/**
 * «Preparar demo completa», del equipo, en dos pasos que el editor llama en orden:
 * - { step: "fotos" }: trae las fotos que faltan de la publicación (lectura nueva y reintentos);
 * - { step: "elegir" }: clasifica las fotos mirando la imagen y deja listas las 3 a ambientar,
 *   la portada y Nórdico como estilo principal.
 * Ninguno genera imágenes ni usa créditos: la tanda la manda el editor, como cualquier otra.
 */
export async function POST(request: Request, { params }: Params) {
  const started = Date.now();
  try {
    const { id } = await params;
    const access = await requireDemoAccess(request, id);
    if (!access.admin) throw new HttpError(403, "Acceso reservado al equipo.");
    const rule = stagingRule(access);
    if (rule.blocked) throw new HttpError(409, rule.blocked);
    const body = await readJson(request);
    if (body.step === "fotos") {
      const result = await importListingPhotos(id, access.actor.id, { deadline: started + maxDuration * 1000 - 15_000 });
      await auditAgencyEdit(access, "auto_prep_photos", { added: result.added, failed: result.failed });
      return Response.json(result, { headers: PRIVATE });
    }
    if (body.step === "elegir") {
      const choice = await chooseForDemo(id);
      await auditAgencyEdit(access, "auto_prep_choose", { picks: choice.picks.length, byImage: choice.byImage });
      return Response.json(choice, { headers: PRIVATE });
    }
    throw new HttpError(400, "Paso desconocido.");
  } catch (e) {
    return failure(e);
  }
}

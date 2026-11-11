import { HttpError, failure, requireAdmin } from "@/lib/commerce/http";
import { toggleSituation, changeBaseSituation, readSituationOverrides, removeCustomSituation, canonicalClassifierOptions, readStateCatalog, updateStateCatalog } from "@/lib/followup/state-catalog";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ states: await readStateCatalog(), overrides: await readSituationOverrides(), canonical: canonicalClassifierOptions() }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

/** Creates or edits classification metadata. Never changes existing rules or sends a message. */
export async function PUT(request: Request) {
  try {
    const user = await requireAdmin(request);
    const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Datos de estado inválidos.");
    return Response.json(input.base ? await changeBaseSituation(input, false) : await updateStateCatalog(input, user.id), { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin(request);
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== "object") throw new HttpError(400, "Situación inválida.");
    return Response.json(input.base ? await changeBaseSituation(input, true) : await removeCustomSituation(input), { headers: NO_STORE });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json(await toggleSituation(await request.json()), { headers: NO_STORE });
  } catch (error) { return failure(error); }
}

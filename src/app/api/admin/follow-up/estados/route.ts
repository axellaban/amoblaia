import { HttpError, failure, requireAdmin } from "@/lib/commerce/http";
import { canonicalClassifierOptions, readStateCatalog, updateStateCatalog } from "@/lib/followup/state-catalog";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json({ states: await readStateCatalog(), canonical: canonicalClassifierOptions() }, { headers: NO_STORE });
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
    return Response.json(await updateStateCatalog(input, user.id), { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

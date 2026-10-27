import { failure, requireAdmin } from "@/lib/commerce/http";
import { adminAgencies } from "@/lib/agency/admin";
import { createAgencyRecord } from "@/lib/agency/admin-edit";
import { readJson } from "@/lib/demos/input";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** The team's list of agencies: ?q=&pagina= (real total included). */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const q = new URL(request.url).searchParams;
    const result = await adminAgencies({ q: q.get("q"), page: Number(q.get("pagina")) || 1 });
    return Response.json(result, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/**
 * "Nueva inmobiliaria": the team's record of an agency, on its own
 * ({ key, name, website?, contactName?, contactEmail?, confirmDuplicates? }).
 * Possible duplicates answer 409 with the list, unless confirmed. It creates
 * no account, no invitation, no credits and no property.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const result = await createAgencyRecord(actor.id, await readJson(request, 4096));
    if (result.kind === "duplicates")
      return Response.json(
        { error: "Puede que esta inmobiliaria ya exista. Revisá las coincidencias antes de crearla.", duplicates: result.duplicates },
        { status: 409, headers: PRIVATE },
      );
    return Response.json({ id: result.id, name: result.name, replay: result.kind === "replay" }, { status: result.kind === "created" ? 201 : 200, headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

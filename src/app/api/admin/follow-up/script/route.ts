import { failure, requireAdmin } from "@/lib/commerce/http";
import { readScript, saveScript } from "@/lib/followup/server";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** El script que lee la extensión antes de trabajar: { body, updated_at }. */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json(await readScript(), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

/** Guarda el script: { body }. */
export async function PUT(request: Request) {
  try {
    const user = await requireAdmin(request);
    const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return Response.json(await saveScript(b.body, user.id), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

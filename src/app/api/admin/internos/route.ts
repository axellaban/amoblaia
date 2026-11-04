import { failure, requireAdmin } from "@/lib/commerce/http";
import { readJson } from "@/lib/demos/input";
import { internalAction, internalOverview } from "@/lib/internal/admin";
export const runtime = "nodejs";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "private, no-store" };

/** The registry of the team's people, accounts and devices (team only). */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await internalOverview(), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

/** One change: { action: person_create | person_update | identity_add | identity_remove | device_status | devices_confirm_unknown | link_create | recompute, ... }. */
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const body = await readJson(request, 4096);
    return Response.json(await internalAction(body, actor.id, new URL(request.url).origin), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

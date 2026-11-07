import { failure, requireAdmin } from "@/lib/commerce/http";
import { createVersion, setVersionStatus, updateVersion } from "@/lib/followup/server";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Una versión nueva de la next best action de una etapa: { stage, channel, trigger, body, ctas, status: "active" | "test" }. */
export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return Response.json(await createVersion(b, user.id), { status: 201, headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

/** Cambia el estado de una versión: { id, status: "active" | "test" | "archived" }. */
export async function PATCH(request: Request) {
  try {
    await requireAdmin(request);
    const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return Response.json(await setVersionStatus(b.id, b.status), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

/** Edita una versión guardada (mismo número): { id, channel, trigger, body, ctas, notes }. */
export async function PUT(request: Request) {
  try {
    await requireAdmin(request);
    const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return Response.json(await updateVersion(b.id, b), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

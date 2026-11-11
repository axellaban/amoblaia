import { failure, requireAdmin } from "@/lib/commerce/http";
import { actorName } from "@/lib/followup/actor";
import { readQuotaSettings, updateQuotaSettings } from "@/lib/followup/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json(await readQuotaSettings(), { headers: NO_STORE });
  } catch (e) { return failure(e); }
}
export async function PUT(request: Request) {
  try {
    const user = await requireAdmin(request);
    const data = (await request.json().catch(() => null)) as { cap?: unknown; outsideToday?: unknown } | null;
    return Response.json(await updateQuotaSettings(data ?? {}, { id: user.id, name: actorName(user) }), { headers: NO_STORE });
  } catch (e) { return failure(e); }
}

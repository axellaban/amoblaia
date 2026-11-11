import { failure, requireAdmin } from "@/lib/commerce/http";
import { buyerAgentSettings, updateBuyerAgentSettings } from "@/lib/demos/buyer-agent-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

/** The general test of the property assistant (off by default): read and switched by the team. */
// A GET carries no Origin header from the browser: checked without the request, like the other admin reads.
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await buyerAgentSettings(), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(request: Request) {
  try {
    const user = await requireAdmin(request);
    const data = (await request.json().catch(() => null)) as { enabled?: unknown; share?: unknown } | null;
    return Response.json(await updateBuyerAgentSettings(data ?? {}, user.id), { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

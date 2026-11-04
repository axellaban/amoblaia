import { failure, requireAdmin } from "@/lib/commerce/http";
import { agencyPanelLink } from "@/lib/agency/panel-link";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * «Acceso al panel»: the agency's fixed link (always the same one).
 * { rotate: true } changes it: the previous link stops working at once.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { rotate?: unknown };
    const link = await agencyPanelLink(id, actor.id, new URL(request.url).origin, body?.rotate === true);
    return Response.json(link, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

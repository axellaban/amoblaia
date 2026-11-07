import { failure, requireAdmin } from "@/lib/commerce/http";
import { actorName } from "./actor";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** The agent's routes (/api/admin/followup/*): team session, JSON body, JSON answer, never cached. */
export function agentRoute(work: (body: Record<string, unknown>, actor: { id: string; name: string }, request: Request) => Promise<unknown>) {
  return async (request: Request) => {
    try {
      const user = await requireAdmin(request);
      const body = request.method === "GET" ? Object.fromEntries(new URL(request.url).searchParams) : (((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>);
      return Response.json(await work(body, { id: user.id, name: actorName(user) }, request), { headers: NO_STORE });
    } catch (e) {
      return failure(e);
    }
  };
}

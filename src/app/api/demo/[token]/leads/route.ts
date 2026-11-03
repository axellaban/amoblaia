import { after } from "next/server";
import { readJson } from "@/lib/demos/input";
import { isAdmin } from "@/lib/commerce/http";
import { normalizeClientBatch } from "@/lib/leads/ingest";
import { demoByToken, memberOf, recomputeQuietly, recordLeadEvents } from "@/lib/leads/server";
import { cloudConfigured } from "@/lib/supabase/config";
import { currentUser } from "@/lib/supabase/server";
export const runtime = "nodejs";

const noContent = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

/**
 * Lead events of a published demo: { visitor, view, session, device, link,
 * internal, automation, events: [{ id, name, at, style?, photo?, value? }] }.
 * The demo comes from the token, never from the body. A signed-in member of
 * the team is internal; a member of the demo's agency is identified and may
 * report its activation (import, account). Generations are never accepted
 * here: the generation route records them when the backend confirms them.
 * The demo is recalculated after the response, so the page never waits.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!cloudConfigured()) return noContent(404);
    const { token } = await params;
    const body = await readJson(request, 16384);
    const demo = await demoByToken(token);
    if (!demo) return noContent(404);
    const user = await currentUser().catch(() => null);
    const team = isAdmin(user?.email ?? undefined);
    const member = Boolean(user && !user.is_anonymous && !team && (await memberOf(user.id, demo.agency_id)));
    const batch = normalizeClientBatch(body, {
      demoId: demo.id,
      agencyId: demo.agency_id,
      team,
      member,
      userId: member ? user!.id : null,
      userAgent: request.headers.get("user-agent") ?? "",
      now: Date.now(),
    });
    if (!batch) return noContent(400);
    if (batch.events.length) {
      await recordLeadEvents(batch.events);
      after(() => recomputeQuietly(demo.id));
    }
    return noContent();
  } catch {
    console.error("lead_events_request_failed");
    return noContent(400);
  }
}

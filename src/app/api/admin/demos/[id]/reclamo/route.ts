import { failure, requireAdmin } from "@/lib/commerce/http";
import { createClaim } from "@/lib/agency/admin";
import { demoRow } from "@/lib/demos/server";
export const runtime = "nodejs";

/**
 * A one-time link for the agency of this demo to take over its demos, with
 * their stagings, in its own habita account. Only the team creates it and
 * sends it to the agency; it expires in 30 days and works once.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    const demo = await demoRow(id);
    const claim = await createClaim(demo.agency_id, actor.id, new URL(request.url).origin, demo.token);
    return Response.json(claim, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

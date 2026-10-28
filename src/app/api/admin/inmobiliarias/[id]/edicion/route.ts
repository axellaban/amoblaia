import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { auditAgency, EDIT_SECONDS, editToken, readEditToken } from "@/lib/agency/edit-context";
import { EDIT_HEADER } from "@/lib/agency/edit-scope";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const PRIVATE = { "Cache-Control": "private, no-store" };

/**
 * Starts (or renews) the team's edit of one agency in this tab: a signed
 * context for this team member and this agency, valid for a few hours,
 * audited before it is handed out. The agency's account and session are not
 * touched; the support view keeps its own read-only rules.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
    const { data, error } = await adminClient().from("agencies").select("id").eq("id", id).maybeSingle();
    if (error) throw new Error("EDIT_AGENCY_LOOKUP_FAILED");
    if (!data) throw new HttpError(404, "No encontramos la inmobiliaria.");
    const previous = readEditToken(request.headers.get(EDIT_HEADER), actor.id);
    // A context that cannot be recorded does not start.
    await auditAgency(actor.id, id, previous?.agencyId === id ? "agency_edit_renew" : "agency_edit_start", { seconds: EDIT_SECONDS });
    return Response.json(editToken(id, actor.id), { status: 201, headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** Leaves the edit of this agency (the tab forgets its context); audited when it was valid. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    const ctx = readEditToken(request.headers.get(EDIT_HEADER), actor.id);
    if (ctx && ctx.agencyId === id) await auditAgency(actor.id, id, "agency_edit_end").catch(() => null);
    return Response.json({ ended: true }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

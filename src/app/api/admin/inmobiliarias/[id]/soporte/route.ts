import { cookies } from "next/headers";
import { failure, HttpError, requireAdmin, rpc } from "@/lib/commerce/http";
import { readSupportToken, SUPPORT_COOKIE, SUPPORT_SECONDS, supportToken } from "@/lib/agency/support";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const PRIVATE = { "Cache-Control": "private, no-store" };

async function audit(actorId: string, action: string, agencyId: string) {
  await rpc("amobla_account", { p_user: actorId, p_trial: false });
  const { error } = await adminClient().from("admin_audit").insert({ actor_id: actorId, action, subject_id: agencyId, details: {} });
  if (error) throw new Error("SUPPORT_AUDIT_FAILED");
}

/** Opens the agency's panel as its owner sees it, read only, for one hour (audited). */
export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
    const { data, error } = await adminClient().from("agencies").select("id").eq("id", id).maybeSingle();
    if (error) throw new Error("SUPPORT_AGENCY_LOOKUP_FAILED");
    if (!data) throw new HttpError(404, "No encontramos la inmobiliaria.");
    // Audited before it opens: a view that cannot be recorded does not start.
    await audit(actor.id, "agency_support_view", id);
    (await cookies()).set(SUPPORT_COOKIE, supportToken(id, actor.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SUPPORT_SECONDS,
    });
    return Response.json({ url: "/panel" }, { status: 201, headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** Leaves the support view. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    const jar = await cookies();
    const viewing = readSupportToken(jar.get(SUPPORT_COOKIE)?.value, actor.id);
    jar.delete(SUPPORT_COOKIE);
    if (viewing) await audit(actor.id, "agency_support_end", viewing).catch(() => null);
    return Response.json({ url: `/admin/inmobiliarias/${isUuid(id) ? id : ""}` }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

import { NextResponse } from "next/server";
import { INVITE_CODE, INVITE_PARAM } from "@/lib/agency/demo-invite";
import { membershipOf } from "@/lib/agency/server";
import { startSupport } from "@/lib/agency/support";
import { liveInvitation, startVisit } from "@/lib/agency/visit";
import { isAdmin } from "@/lib/commerce/http";
import { currentUser } from "@/lib/supabase/server";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Ingresar al panel" from a demo: /panel/visita?codigo=<invitación>. The
 * agency lands on the home of its own panel without creating its account
 * first; it looks around read only and creates the account when it wants to
 * save or stage something (the same invitation, which keeps its demos).
 * The team opening the same link sees that panel in its support view
 * (read only, audited) instead, so the link can be checked before sending it.
 * An invitation that cannot be used anymore goes to its sign-up page, which says so.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  if (!cloudEnabled() || !cloudConfigured()) return to("/");
  const code = url.searchParams.get(INVITE_PARAM) ?? "";
  if (!INVITE_CODE.test(code)) return to("/panel");
  const invitation = await liveInvitation(code).catch(() => null);
  if (!invitation) return to(`/panel/empezar?${new URLSearchParams({ [INVITE_PARAM]: code })}`);
  const user = await currentUser().catch(() => null);
  const verified = user && !user.is_anonymous && user.email_confirmed_at ? user : null;
  if (verified && isAdmin(verified.email)) {
    try {
      await startSupport(verified.id, invitation.agency.id, "view");
      return to("/panel");
    } catch {
      return to(`/admin/inmobiliarias/${invitation.agency.id}`);
    }
  }
  // Someone who already works for an agency keeps its own panel.
  const own = verified ? await membershipOf(verified.id).catch(() => null) : null;
  if (own) return to("/panel");
  await startVisit(code, invitation);
  return to("/panel");
}

import { NextResponse } from "next/server";
import { INVITE_CODE, INVITE_PARAM, intentDestination, intentOf, type DemoIntent } from "@/lib/agency/demo-invite";
import { membershipOf } from "@/lib/agency/server";
import { startSupport } from "@/lib/agency/support";
import { liveInvitation, startVisit, type LiveInvitation } from "@/lib/agency/visit";
import { isAdmin } from "@/lib/commerce/http";
import { isPreviewBot, panelPreviewResponse } from "@/lib/agency/panel-preview";
import { adminClient, currentUser } from "@/lib/supabase/server";
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
 * With ?accion=&foto=&estilo= (from «Generar» in the demo) it opens that
 * property's editor with the photo and style chosen (landing).
 * An invitation that cannot be used anymore goes to its sign-up page, which says so.
 */
/**
 * Where the visit opens: what the agency asked for in its demo (a style for a
 * photo, a photo to stage, another listing) opens that property in its editor
 * with the photo and style chosen, or the panel's import; anything else, its
 * home. The welcome of the visit shows over either.
 */
async function landing(invitation: LiveInvitation, intent: DemoIntent) {
  if (!intent) return "/panel";
  if (intent.kind === "import") return intentDestination(null, intent, false);
  try {
    // The demo of that photo, only when it belongs to the invitation's agency.
    const db = adminClient();
    const { data: photo } = await db.from("demo_photos").select("property_id").eq("id", intent.photo).maybeSingle();
    const property = (photo as { property_id: string } | null)?.property_id;
    if (!property) return "/panel";
    const { data: demo } = await db
      .from("demos")
      .select("id")
      .eq("property_id", property)
      .eq("agency_id", invitation.agency.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const id = (demo as { id: string } | null)?.id;
    return id ? intentDestination(id, intent, false) : "/panel";
  } catch {
    return "/panel";
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  const code = url.searchParams.get(INVITE_PARAM) ?? "";
  // WhatsApp and the other link previews get «Tu panel de …», not a visit.
  if (isPreviewBot(request.headers.get("user-agent"))) return panelPreviewResponse(INVITE_CODE.test(code) ? code : null, request);
  if (!cloudEnabled() || !cloudConfigured()) return to("/");
  if (!INVITE_CODE.test(code)) return to("/panel");
  const invitation = await liveInvitation(code).catch(() => null);
  if (!invitation) return to(`/panel/empezar?${new URLSearchParams({ [INVITE_PARAM]: code })}`);
  const intent = intentOf(Object.fromEntries(url.searchParams));
  const user = await currentUser().catch(() => null);
  const verified = user && !user.is_anonymous && user.email_confirmed_at ? user : null;
  if (verified && isAdmin(verified.email)) {
    try {
      await startSupport(verified.id, invitation.agency.id, "view");
      return to(await landing(invitation, intent));
    } catch {
      return to(`/admin/inmobiliarias/${invitation.agency.id}`);
    }
  }
  // Someone who already works for an agency keeps its own panel.
  const own = verified ? await membershipOf(verified.id).catch(() => null) : null;
  if (own) return to("/panel");
  await startVisit(code, invitation);
  return to(await landing(invitation, intent));
}

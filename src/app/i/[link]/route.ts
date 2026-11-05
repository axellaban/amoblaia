import { NextResponse } from "next/server";
import { shortLinkCode } from "@/lib/agency/demo-invite";
import { membershipOf } from "@/lib/agency/server";
import { startSupport } from "@/lib/agency/support";
import { liveVisit, startVisit } from "@/lib/agency/visit";
import { isAdmin } from "@/lib/commerce/http";
import { currentUser } from "@/lib/supabase/server";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The agency's fixed link to its panel: /i/<inmobiliaria>-<codigo>. It always
 * lands on the home of that agency's panel (docs/ACCESO_PANEL.md):
 * - its own members, signed in: their panel, nothing asked;
 * - anyone else, while the agency has no account: the panel as a guest, with
 *   the welcome (sign in, create the account or look around); a signed-in
 *   account outside the agency starts working there with one click;
 * - once the agency has its team: signing in, or «Solicitar acceso»;
 * - the team: the same panel in its support view (read only, audited).
 * A changed or unknown link gets a short notice, never the sign-up or /admin.
 * ?enlace= tells the panel how it was opened, for analytics only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ link: string }> }) {
  const url = new URL(request.url);
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  if (!cloudEnabled() || !cloudConfigured()) return to("/");
  const code = shortLinkCode((await params).link);
  const visit = code ? await liveVisit(code).catch(() => null) : null;
  if (!code || !visit || visit.source !== "link") return to("/i/inactivo");
  const user = await currentUser().catch(() => null);
  const verified = user && !user.is_anonymous && user.email_confirmed_at ? user : null;
  const own = verified ? await membershipOf(verified.id).catch(() => null) : null;
  if (own?.agency.id === visit.agency.id) return to("/panel?enlace=miembro");
  if (verified && isAdmin(verified.email)) {
    try {
      await startSupport(verified.id, visit.agency.id, "view");
      return to("/panel?enlace=equipo");
    } catch {
      return to("/i/inactivo");
    }
  }
  // A member of another agency keeps its own panel: the visit would not show over it.
  if (own) return to("/panel?enlace=otra");
  // The agency already has its team: its private panel is for its members. Sign in
  // (back here: a member goes straight in) or ask to join it (Journey C).
  if (visit.claimed) {
    const ask = `/panel/solicitar-acceso?${new URLSearchParams({ codigo: code })}`;
    return to(verified ? ask : `/acceso?${new URLSearchParams({ next: url.pathname })}`);
  }
  await startVisit(code, visit);
  return to(`/panel?enlace=${verified ? "sesion" : "invitado"}`);
}

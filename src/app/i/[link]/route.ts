import { NextResponse } from "next/server";
import { shortLinkCode } from "@/lib/agency/demo-invite";
import { membershipOf } from "@/lib/agency/server";
import { startSupport } from "@/lib/agency/support";
import { liveVisit, startVisit } from "@/lib/agency/visit";
import { isPreviewBot, panelPreviewResponse } from "@/lib/agency/panel-preview";
import { isAdmin } from "@/lib/commerce/http";
import { currentUser } from "@/lib/supabase/server";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The agency's fixed link to its panel: /i/<inmobiliaria>-<codigo>. It always
 * lands on the home of that agency's panel (docs/ACCESO_PANEL.md):
 * - its own members, signed in: their panel, nothing asked;
 * - anyone else: the panel as a guest, with the welcome (sign in, create the
 *   account or look around); a signed-in account outside the agency is
 *   offered to take it over (no owner yet) or told it already has one;
 * - the team: the same panel in its support view (read only, audited).
 * A changed or unknown link gets a short notice, never the sign-up or /admin.
 * ?enlace= tells the panel how it was opened, for analytics only.
 * Link-preview bots get the panel's preview instead (lib/agency/panel-preview.ts).
 */
export async function GET(request: Request, { params }: { params: Promise<{ link: string }> }) {
  const url = new URL(request.url);
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  const code = shortLinkCode((await params).link);
  // WhatsApp and the other link previews get «Tu panel de …», not a visit.
  if (isPreviewBot(request.headers.get("user-agent"))) return panelPreviewResponse(code, request);
  if (!cloudEnabled() || !cloudConfigured()) return to("/");
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
  await startVisit(code, visit);
  return to(`/panel?enlace=${verified ? "sesion" : "invitado"}`);
}

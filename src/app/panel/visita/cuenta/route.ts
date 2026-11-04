import { NextResponse } from "next/server";
import { invitationPath, INVITE_PARAM } from "@/lib/agency/demo-invite";
import { claimCodeFromVisit, currentVisit } from "@/lib/agency/visit";
import { safeNext } from "@/lib/commerce/redirect";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Crear cuenta" from the visit to the panel: the invitation's own sign-up
 * (Google, or e-mail and password), which moves its demos, stagings and
 * reserved credits into the new account. The code stays in the cookie, never
 * in the panel's pages. From the agency's fixed link a fresh one-time
 * invitation is made for it; an agency that already has its owner can only
 * sign in. ?volver= is the panel page to come back to afterwards.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const back = safeNext(url.searchParams.get("volver"), "/panel");
  const visit = await currentVisit();
  if (!visit) return NextResponse.redirect(new URL("/acceso?modo=registro&next=%2Fpanel", origin));
  if (visit.claimed) return NextResponse.redirect(new URL(`/acceso?${new URLSearchParams({ next: back })}`, origin));
  const code = await claimCodeFromVisit(visit).catch(() => null);
  if (!code) return NextResponse.redirect(new URL("/panel", origin));
  const path = visit.demoToken
    ? invitationPath(code, visit.demoToken)
    : `/panel/empezar?${new URLSearchParams({ [INVITE_PARAM]: code, ...(back.startsWith("/panel") && back !== "/panel" ? { volver: back } : {}) })}`;
  return NextResponse.redirect(new URL(path, origin));
}

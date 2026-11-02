import { NextResponse } from "next/server";
import { invitationPath, INVITE_PARAM } from "@/lib/agency/demo-invite";
import { currentVisit } from "@/lib/agency/visit";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Crear mi cuenta" from the visit to the panel: the invitation's own sign-up
 * (e-mail and password, or Google), which moves its demos, stagings and
 * reserved credits into the new account. The code stays in the cookie, never
 * in the panel's pages.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const visit = await currentVisit();
  if (!visit) return NextResponse.redirect(new URL("/acceso?modo=registro&next=%2Fpanel", origin));
  const path = visit.demoToken ? invitationPath(visit.code, visit.demoToken) : `/panel/empezar?${new URLSearchParams({ [INVITE_PARAM]: visit.code })}`;
  return NextResponse.redirect(new URL(path, origin));
}

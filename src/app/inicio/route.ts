import { NextResponse } from "next/server";
import { membershipOf } from "@/lib/agency/server";
import { startDestination, type StartLookup } from "@/lib/start-destination";
import { currentUser } from "@/lib/supabase/server";
import { JOIN_PATH } from "@/lib/agency/join";
import { currentVisit } from "@/lib/agency/visit";
export const dynamic = "force-dynamic";

/** The signed-in home: see startDestination. The query (ad click IDs) is kept, without ?ir. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = await currentUser().catch(() => null);
  let lookup: StartLookup = "none";
  if (user && !user.is_anonymous) {
    lookup = await membershipOf(user.id).then(
      (m): StartLookup => (m ? "agency" : "none"),
      (): StartLookup => "failed",
    );
  }
  // An account without an agency that came through an agency's link enters that one, never creates another.
  if (user && !user.is_anonymous && lookup === "none" && (await currentVisit().catch(() => null)))
    return NextResponse.redirect(new URL(JOIN_PATH, url.origin));
  const images = url.searchParams.get("ir") === "imagenes";
  url.searchParams.delete("ir");
  const to = new URL(startDestination(user, lookup, images), url.origin);
  to.search = url.search;
  return NextResponse.redirect(to);
}

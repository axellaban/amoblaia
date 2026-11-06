import { NextResponse } from "next/server";
import { membershipOf } from "@/lib/agency/server";
import { startDestination, type StartLookup } from "@/lib/start-destination";
import { currentUser } from "@/lib/supabase/server";
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
  const images = url.searchParams.get("ir") === "imagenes";
  url.searchParams.delete("ir");
  const to = new URL(startDestination(user, lookup, images), url.origin);
  to.search = url.search;
  return NextResponse.redirect(to);
}

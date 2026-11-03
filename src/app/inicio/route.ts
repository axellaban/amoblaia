import { NextResponse } from "next/server";
import { membershipOf } from "@/lib/agency/server";
import { currentUser } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";

/**
 * Where a sign-in lands when it was not heading anywhere: an agency's account
 * to its panel, any other account to its photos. The query (ad click IDs) is
 * kept. A failed lookup is not a reason to hide the photos: it goes there.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = await currentUser().catch(() => null);
  const agency = user && !user.is_anonymous ? await membershipOf(user.id).catch(() => null) : null;
  const to = new URL(agency ? "/panel" : "/proyectos", url.origin);
  to.search = url.search;
  return NextResponse.redirect(to);
}

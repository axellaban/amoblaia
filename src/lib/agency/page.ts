import "server-only";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { membershipFor } from "./server";
import { visitorMembership } from "./visit";
import { joinPath } from "./join";
import { isAdmin } from "@/lib/commerce/http";

/**
 * Gate of the agency panel's pages, with the same rules as its API: a
 * verified account (signed-out visitors go to sign up and come back here)
 * that works for an agency (otherwise it is created first, on /panel/empezar).
 * An agency that opened its panel from its demo's invitation, before creating
 * its account, sees it too, read only (visit.ts). The API checks again on
 * every request.
 */
export async function requirePanelPage(next: string) {
  if (!cloudEnabled() || !cloudConfigured()) notFound();
  const user = await currentUser().catch(() => null);
  const verified = user && !user.is_anonymous && user.email_confirmed_at ? user : null;
  // A failed lookup is an error (the panel's error page offers to retry),
  // never a reason to send the account to create another agency.
  const membership = verified ? await membershipFor(verified) : null;
  if (verified && membership) return { user: verified, membership };
  const visit = await visitorMembership();
  // Signed in after looking around an agency's panel from its link: the account enters it, no question asked.
  if (visit && verified && !isAdmin(verified.email)) redirect(joinPath(next));
  if (visit) return { user: verified, membership: visit };
  if (!verified) redirect(`/acceso?modo=registro&next=${encodeURIComponent(next)}`);
  redirect("/panel/empezar");
}

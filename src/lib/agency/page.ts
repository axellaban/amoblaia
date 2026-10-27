import "server-only";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { membershipOf } from "./server";

/**
 * Gate of the agency panel's pages, with the same rules as its API: a
 * verified account (signed-out visitors go to sign up and come back here)
 * that works for an agency (otherwise it is created first, on /panel/empezar).
 * The API checks again on every request.
 */
export async function requirePanelPage(next: string) {
  if (!cloudEnabled() || !cloudConfigured()) notFound();
  const user = await currentUser().catch(() => null);
  if (!user || user.is_anonymous || !user.email_confirmed_at)
    redirect(`/acceso?modo=registro&next=${encodeURIComponent(next)}`);
  // A failed lookup is an error (the panel's error page offers to retry),
  // never a reason to send the account to create another agency.
  const membership = await membershipOf(user.id);
  if (!membership) redirect("/panel/empezar");
  return { user, membership };
}

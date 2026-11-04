import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { membershipFor } from "@/lib/agency/server";
import { visitorMembership } from "@/lib/agency/visit";
export const dynamic = "force-dynamic";

/**
 * The link to share the prices (people ask for them a lot): it opens the
 * prices inside the agency's own panel, or the public /precios for someone
 * without one. Never asks to sign up just to see the prices.
 */
export default async function Page() {
  let inPanel = false;
  if (cloudEnabled() && cloudConfigured()) {
    try {
      const user = await currentUser();
      const verified = user && !user.is_anonymous && user.email_confirmed_at ? user : null;
      inPanel = Boolean((verified && (await membershipFor(verified))) || (await visitorMembership()));
    } catch {
      /* Unknown: the public prices are the same. */
    }
  }
  redirect(inPanel ? "/panel/creditos" : "/precios");
}

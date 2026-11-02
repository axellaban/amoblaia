import { Assistant } from "@/components/assistant";
import { SupportBanner } from "@/components/support-banner";
import { VisitBanner } from "@/components/visit-banner";
import { supportAgency } from "@/lib/agency/support";
import { currentVisit } from "@/lib/agency/visit";
import { membershipOf } from "@/lib/agency/server";
import { adminClient, currentUser } from "@/lib/supabase/server";

const PANEL = { kind: "panel" } as const;

/** The free credits waiting for the agency's account; a failed lookup shows none. */
async function pendingCredits(agencyId: string) {
  try {
    const { data } = await adminClient().from("agencies").select("free_credits_pending").eq("id", agencyId).maybeSingle();
    return (data as { free_credits_pending: number } | null)?.free_credits_pending ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The agency panel; in a team member's support view, a banner says so on
 * every page, and in the agency's visit before its account, another one
 * offers to create it. Miguel Ángel, the assistant, is at hand for accounts.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  const verified = user && !user.is_anonymous && user.email_confirmed_at ? user : null;
  const viewing = user ? await supportAgency(user).catch(() => null) : null;
  // The visit counts only for someone without a panel of their own (requirePanelPage's same rule).
  const own = !viewing && verified ? await membershipOf(verified.id).catch(() => null) : null;
  const visit = !viewing && !own ? await currentVisit().catch(() => null) : null;
  return (
    <>
      {viewing && <SupportBanner agencyId={viewing.id} agencyName={viewing.name} acting={viewing.supportMode === "act"} />}
      {visit && <VisitBanner agencyName={visit.agency.name} freeCredits={await pendingCredits(visit.agency.id)} />}
      {children}
      {user && !visit && <Assistant place={PANEL} />}
    </>
  );
}

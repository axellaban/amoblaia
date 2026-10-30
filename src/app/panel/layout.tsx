import { Assistant } from "@/components/assistant";
import { SupportBanner } from "@/components/support-banner";
import { supportAgency } from "@/lib/agency/support";
import { currentUser } from "@/lib/supabase/server";

const PANEL = { kind: "panel" } as const;

/** The agency panel; in a team member's support view, a banner says so on every page. Miguel Ángel, the assistant, is at hand on all of them. */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  const viewing = user ? await supportAgency(user).catch(() => null) : null;
  return (
    <>
      {viewing && <SupportBanner agencyId={viewing.id} agencyName={viewing.name} />}
      {children}
      {user && <Assistant place={PANEL} />}
    </>
  );
}

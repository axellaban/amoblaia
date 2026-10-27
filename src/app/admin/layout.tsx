import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin-nav";
import { isAdmin } from "@/lib/commerce/http";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { currentUser } from "@/lib/supabase/server";

/**
 * Shared frame of the team's pages: the green side panel stays mounted while
 * the content changes. Each page still checks access itself (requireAdminPage);
 * the panel is only drawn for the team, so a 404 never reveals it.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const team = cloudEnabled() && cloudConfigured() ? isAdmin((await currentUser().catch(() => null))?.email) : false;
  if (!team) return children;
  return (
    <div className="adm-shell">
      <AdminNav />
      <div className="adm-content">{children}</div>
    </div>
  );
}

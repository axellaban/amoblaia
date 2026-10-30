import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PanelNav } from "@/components/agency-panel";
import { AgencyTeam } from "@/components/agency-team";
import { requirePanelPage } from "@/lib/agency/page";
import { canManage } from "@/lib/agency/shared";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usuarios", robots: { index: false, follow: false } };

/** "Usuarios": accesses for the agency's employees. Owner and administrators only. */
export default async function UsersPage() {
  const { membership } = await requirePanelPage("/panel/usuarios");
  if (!canManage(membership.role)) redirect("/panel");
  return (
    <>
      <PanelNav section="usuarios" agencyName={membership.agency.name} role={membership.role} />
      <div className="account-page container ap-page">
        <AgencyTeam readOnly={Boolean(membership.support && !membership.acting)} />
      </div>
    </>
  );
}

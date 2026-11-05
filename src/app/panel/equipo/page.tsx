import type { Metadata } from "next";
import { PanelNav } from "@/components/agency-panel";
import { AgencyTeam } from "@/components/agency-team";
import { requirePanelPage } from "@/lib/agency/page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Equipo y accesos", robots: { index: false, follow: false } };

/**
 * «Equipo y accesos» (Configuración): the whole team sees who works for the
 * agency and its principal administrator; administrators also invite,
 * change roles, revoke accesses and answer requests. The API decides.
 */
export default async function TeamPage() {
  const { membership } = await requirePanelPage("/panel/equipo");
  return (
    <>
      <PanelNav section="usuarios" agencyName={membership.agency.name} role={membership.role} />
      <div className="account-page container ap-page">
        <AgencyTeam readOnly={Boolean(membership.visitor || (membership.support && !membership.acting))} />
      </div>
    </>
  );
}

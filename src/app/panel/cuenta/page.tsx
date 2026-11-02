import type { Metadata } from "next";
import { AccountDashboard } from "@/components/account";
import { PanelNav } from "@/components/panel-shell";
import { redirect } from "next/navigation";
import { requirePanelPage } from "@/lib/agency/page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mi cuenta", robots: { index: false, follow: false } };

/** "Mi cuenta" without leaving the panel: the same account page, under the panel's sidebar. */
export default async function Page() {
  const { membership } = await requirePanelPage("/panel/cuenta");
  // Visiting its panel before the account: "Mi cuenta" is creating it.
  if (membership.visitor) redirect("/panel/visita/cuenta");
  return (
    <>
      <PanelNav section="cuenta" agencyName={membership.agency.name} role={membership.role} />
      <div className="ap-account">
        <AccountDashboard />
      </div>
    </>
  );
}

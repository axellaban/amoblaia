import type { Metadata } from "next";
import { requirePanelPage } from "@/lib/agency/page";
import { CommercialWorkspace } from "@/components/commercial-workspace";
export const metadata: Metadata = { title: "Consultas IA", robots: { index: false, follow: false } };
export default async function Page() {
  const { membership } = await requirePanelPage("/panel/consultas-ia");
  return (
    <CommercialWorkspace
      product="consultas_ia"
      nav={{ agencyName: membership.agency.name, role: membership.role, tour: !membership.support && !membership.visitor }}
    />
  );
}

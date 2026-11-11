import type { Metadata } from "next";
import { requirePanelPage } from "@/lib/agency/page";
import { CommercialWorkspace } from "@/components/commercial-workspace";
export const metadata: Metadata = { title: "CRM Inteligente", robots: { index: false, follow: false } };
export default async function Page() {
  await requirePanelPage("/panel/crm-inteligente");
  return <CommercialWorkspace product="crm_inteligente"/>;
}

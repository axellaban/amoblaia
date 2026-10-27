import type { Metadata } from "next";
import { AgencyPanel } from "@/components/agency-panel";
import { requirePanelPage } from "@/lib/agency/page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inicio", robots: { index: false, follow: false } };
export default async function Page() {
  await requirePanelPage("/panel");
  return <AgencyPanel section="inicio" />;
}

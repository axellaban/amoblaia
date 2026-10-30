import type { Metadata } from "next";
import { AgencyPanel } from "@/components/agency-panel";
import { redirect } from "next/navigation";
import { requirePanelPage } from "@/lib/agency/page";
import { canManage } from "@/lib/agency/shared";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mi sitio web", robots: { index: false, follow: false } };
export default async function Page() {
  const { membership } = await requirePanelPage("/panel/sitio");
  if (!canManage(membership.role)) redirect("/panel");
  return <AgencyPanel section="sitio" />;
}

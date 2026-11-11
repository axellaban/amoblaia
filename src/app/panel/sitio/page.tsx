import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteBuilder } from "@/components/site/site-builder";
import { requirePanelPage } from "@/lib/agency/page";
import { canManage } from "@/lib/agency/shared";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mi sitio web", robots: { index: false, follow: false } };

/** Sitio web: the agency's website builder (owner and admins). */
export default async function Page() {
  const { membership } = await requirePanelPage("/panel/sitio");
  if (!canManage(membership.role)) redirect("/panel");
  return <SiteBuilder />;
}

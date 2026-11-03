import type { Metadata } from "next";
import { AgencyPanel } from "@/components/agency-panel";
import { PricingPlans } from "@/components/pricing";
import { requirePanelPage } from "@/lib/agency/page";
import { pricingProps } from "@/lib/commerce/pricing-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Planes y créditos", robots: { index: false, follow: false } };

/** "Planes y créditos": the plans of /precios inside the panel (its sidebar stays), then the agency's balance and movements. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePanelPage("/panel/creditos");
  const props = await pricingProps((await searchParams).plan);
  return <AgencyPanel section="creditos" plans={<PricingPlans {...props} />} />;
}

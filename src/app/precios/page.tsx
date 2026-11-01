import type { Metadata } from "next";
import { PricingPlans } from "@/components/pricing";
import { pricingProps } from "@/lib/commerce/pricing-page";
export const metadata: Metadata = { title: "Planes y packs de fotos" };
export const dynamic = "force-dynamic";
export default async function Pricing({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PricingPlans {...await pricingProps((await searchParams).plan)} />;
}

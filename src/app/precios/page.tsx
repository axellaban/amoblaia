import type { Metadata } from "next";
import { PricingPlans } from "@/components/pricing";
import { pricingProps } from "@/lib/commerce/pricing-page";
export const metadata: Metadata = {
  title: "Precios y créditos",
  // No text under the title in WhatsApp's preview: the image already says it all.
  // null so the site's description is not inherited (WhatsApp would show it).
  description: null,
  openGraph: {
    title: "Precios de habita.",
    url: "/precios",
    locale: "es_AR",
    siteName: "habita.",
    type: "website",
  },
};
export const dynamic = "force-dynamic";
export default async function Pricing({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PricingPlans {...await pricingProps((await searchParams).plan)} />;
}

import type { Metadata } from "next";
import { PricingPlans } from "@/components/pricing";
import { pricingProps } from "@/lib/commerce/pricing-page";
import { FREE_MONTHLY_CREDITS } from "@/lib/commerce/credit-packs";
export const metadata: Metadata = {
  title: "Precios y créditos",
  description: `Empezá gratis con ${FREE_MONTHLY_CREDITS} créditos por mes, sin tarjeta. Después, comprá créditos cuando los necesites, sin suscripción.`,
  // The image is ./opengraph-image.tsx; title and text are the ones WhatsApp shows under it.
  openGraph: {
    title: "Precios de habita. · Empezá gratis",
    description: `${FREE_MONTHLY_CREDITS} créditos gratis por mes, sin tarjeta. Después, comprá créditos cuando los necesites. Sin suscripción.`,
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

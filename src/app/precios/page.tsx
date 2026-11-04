import type { Metadata } from "next";
import { PricingPlans } from "@/components/pricing";
import { pricingProps } from "@/lib/commerce/pricing-page";
export const metadata: Metadata = {
  title: "Precios y créditos",
  description: "Plan Gratis con 10 créditos por mes y paquetes de créditos de pago único con Mercado Pago, sin suscripción.",
  openGraph: {
    title: "Precios de habita.",
    description: "Gratis: 10 créditos por mes. Paquetes de créditos de pago único, sin suscripción. Fotos y videos con IA para tus propiedades.",
    url: "/precios",
  },
};
export const dynamic = "force-dynamic";
export default async function Pricing({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PricingPlans {...await pricingProps((await searchParams).plan)} />;
}

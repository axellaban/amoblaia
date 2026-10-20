import type { Metadata } from "next";
import { PricingPlans } from "@/components/pricing";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { adminClient } from "@/lib/supabase/server";
import { billingConfigured } from "@/lib/commerce/mercadopago";
import type { Product } from "@/lib/commerce/catalog";
export const metadata: Metadata = { title: "Planes y packs de fotos" };
export const dynamic = "force-dynamic";
export default async function Pricing() {
  let products: Product[] = [];
  if (cloudConfigured()) {
    try {
      const { data } = await adminClient().from("products").select("*");
      products = (data || []) as Product[];
    } catch {
      /* Plans stay unavailable when the catalog cannot be loaded. */
    }
  }
  return (
    <PricingPlans
      products={products}
      enabled={cloudEnabled() && billingConfigured()}
      trial={cloudEnabled() && process.env.LIVE_TRIAL_ENABLED === "true"}
    />
  );
}

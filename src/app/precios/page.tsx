import type { Metadata } from "next";
import { PricingPlans } from "@/components/pricing";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { adminClient, currentUser } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/commerce/http";
import { billingConfigured } from "@/lib/commerce/mercadopago";
import type { Product } from "@/lib/commerce/catalog";
export const metadata: Metadata = { title: "Planes y packs de fotos" };
export const dynamic = "force-dynamic";
export default async function Pricing({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The plan chosen before creating the account (from an agency's demo): its payment opens right away.
  const plan = (await searchParams).plan;
  const initialSku = typeof plan === "string" && /^[a-z0-9-]{1,40}$/.test(plan) ? plan : undefined;
  let products: Product[] = [];
  if (cloudConfigured()) {
    try {
      const { data } = await adminClient().from("products").select("*");
      products = (data || []) as Product[];
    } catch {
      /* Plans stay unavailable when the catalog cannot be loaded. */
    }
  }
  // Sandbox checkouts stay reserved to the team, so only admins see the buttons outside production.
  let canBuy = cloudEnabled() && billingConfigured();
  const user = canBuy ? await currentUser().catch(() => null) : null;
  if (canBuy && process.env.MERCADOPAGO_MODE !== "production")
    canBuy = isAdmin(user?.email);
  // The "Primera propiedad" pack is one per account: hide it once bought.
  let firstPackUsed = false;
  // The active subscription, so its plan is marked and the others offer a
  // change. A pending one was never paid and is not anybody's plan.
  let currentSku: string | undefined;
  if (user) {
    const { count } = await adminClient()
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("sku", "pack-first")
      .eq("status", "paid");
    firstPackUsed = Boolean(count);
    const { data } = await adminClient()
      .from("subscriptions")
      .select("orders(sku)")
      .eq("user_id", user.id)
      .in("status", ["authorized", "paused"])
      .limit(1)
      .maybeSingle();
    currentSku =
      (data?.orders as unknown as { sku: string } | null)?.sku || undefined;
  }
  return (
    <PricingPlans
      products={products}
      enabled={canBuy}
      trial={cloudEnabled() && process.env.LIVE_TRIAL_ENABLED === "true"}
      email={user?.email || undefined}
      currentSku={currentSku}
      firstPackUsed={firstPackUsed}
      renderedAt={Date.now()}
      initialSku={initialSku}
    />
  );
}

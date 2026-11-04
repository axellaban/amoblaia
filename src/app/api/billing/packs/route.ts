import { failure } from "@/lib/commerce/http";
import { creditPackages } from "@/lib/commerce/credit-packs";
import { pricingProps } from "@/lib/commerce/pricing-page";
import { adminClient } from "@/lib/supabase/server";
import { cloudConfigured } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";

/**
 * The credit packs on sale, for the «Comprar créditos» selector wherever it
 * opens (pricing, panel, editor). Prices are informative: /api/checkout takes
 * only the SKU and charges the catalog price.
 */
export async function GET() {
  try {
    const props = await pricingProps(undefined);
    // An agency's balance is its owner's: a collaborator buying would add the
    // credits to their own account, so only the owner (or someone without an agency) buys.
    let buyer: "self" | "owner" = "self";
    let agency: string | null = null;
    if (props.userId && cloudConfigured()) {
      const { data } = await adminClient()
        .from("agency_members")
        .select("role,agencies(name)")
        .eq("user_id", props.userId)
        .limit(1)
        .maybeSingle();
      if (data && data.role !== "owner") {
        buyer = "owner";
        agency = (data.agencies as unknown as { name: string } | null)?.name ?? null;
      }
    }
    return Response.json(
      {
        packages: creditPackages(props.products),
        enabled: props.enabled,
        signedIn: Boolean(props.email),
        buyer,
        agency,
        balance: props.balance,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

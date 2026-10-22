import { requireAdmin, failure } from "@/lib/commerce/http";
import { billingStatus, mp } from "@/lib/commerce/mercadopago";
import { adminClient } from "@/lib/supabase/server";

/** Read-only diagnosis. No credentials, card data or email addresses leave the server. */
export async function GET() {
  try {
    const user = await requireAdmin();
    const merchant = await mp<{
      id: number;
      email: string;
      site_id: string;
      country_id: string;
      tags?: string[];
    }>("/users/me");
    const { data: order, error } = await adminClient()
      .from("orders")
      .select("id,payer_email,created_at,status")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("BILLING_DIAGNOSIS_FAILED");
    const normalize = (value?: string | null) => value?.trim().toLowerCase();
    return Response.json(
      {
        configuration: billingStatus(),
        merchant: {
          site: merchant.site_id,
          country: merchant.country_id,
          collectorMatches: String(merchant.id) === process.env.MERCADOPAGO_COLLECTOR_ID,
          testAccount: Boolean(merchant.tags?.includes("test_user")),
          loginMatchesSeller: normalize(user.email) === normalize(merchant.email),
        },
        latestAttempt: order ? {
          reference: order.id.slice(0, 8),
          at: order.created_at,
          status: order.status,
          hasEmail: Boolean(order.payer_email),
          emailMatchesLogin: Boolean(order.payer_email) && normalize(order.payer_email) === normalize(user.email),
          emailMatchesSeller: Boolean(order.payer_email) && normalize(order.payer_email) === normalize(merchant.email),
        } : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

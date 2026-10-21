import { after } from "next/server";
import { adminClient } from "@/lib/supabase/server";
import { requireUser, failure, rpc, isAdmin } from "@/lib/commerce/http";
import { onFreeTier } from "@/lib/commerce/jobs";
import { adoptGuest } from "@/lib/commerce/guest";
import { refreshBilling } from "@/lib/commerce/mercadopago";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await requireUser(undefined, true);
    // Retries a trial hand-over that failed at sign-in.
    await adoptGuest(user);
    const account = await rpc<{ credits: number; blocked: boolean }>(
      "amobla_account",
      { p_user: user.id, p_trial: process.env.LIVE_TRIAL_ENABLED === "true" },
    );
    const db = adminClient();
    const results = await Promise.all([
      db
        .from("subscriptions")
        .select("id,status,paid_until,created_at,orders(snapshot)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      db
        .from("credit_grants")
        .select("id,remaining,total,expires_at,source_key,revoked")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("payments")
        .select("id,status,amount_cents,paid_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      db
        .from("generations")
        .select("id,status,created_at,error_code,project_id")
        .eq("user_id", user.id)
        .in("status", ["queued", "running", "needs_review", "failed"])
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (results.some((r) => r.error)) throw new Error("ACCOUNT_LOOKUP_FAILED");
    // A plan waiting for a charge asks Mercado Pago directly, after
    // answering: the account page's next refresh shows the result even if a
    // notification never arrived.
    if (!user.is_anonymous)
      after(() =>
        refreshBilling(user.id).catch(() =>
          console.error("billing_refresh_failed", user.id),
        ),
      );
    return Response.json(
      {
        ...account,
        anonymous: user.is_anonymous === true,
        email: user.email,
        free: await onFreeTier(user.id),
        admin: isAdmin(user.email),
        subscriptions: results[0].data,
        grants: results[1].data,
        payments: results[2].data,
        jobs: results[3].data,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

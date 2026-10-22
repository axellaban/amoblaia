import { after } from "next/server";
import { sameSecret } from "@/lib/session";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { adminClient } from "@/lib/supabase/server";
import { runJob } from "@/lib/commerce/jobs";
import { reconcileCheckout } from "@/lib/commerce/reconcile";
import { endLaunchPrices, processInbox } from "@/lib/commerce/mercadopago";
export const maxDuration = 300;
export async function GET(request: Request) {
  const deadline = Date.now() + maxDuration * 1000 - 5000;
  const secret = process.env.CRON_SECRET;
  if (
    !secret ||
    secret.length < 32 ||
    !sameSecret(request.headers.get("authorization") || "", `Bearer ${secret}`)
  )
    return new Response("Unauthorized", { status: 401 });
  if (!cloudEnabled() || !cloudConfigured())
    return Response.json({ skipped: true });
  const db = adminClient();
  // Never retry a provider call whose outcome is unknown.
  const stale = await db
    .from("generations")
    .update({ status: "needs_review", error_code: "WORKER_INTERRUPTED" })
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if (stale.error) return new Response("Retry", { status: 503 });
  const [jobs, events, checkouts, renewals] = await Promise.all([
    db
      .from("generations")
      .select("id")
      .eq("status", "queued")
      .order("created_at")
      .limit(1),
    db
      .from("webhook_events")
      .select("event_key,topic,resource_id")
      .is("processed_at", null)
      // Events that keep failing go behind fresh ones instead of blocking them.
      .order("attempts")
      .order("received_at")
      .limit(25),
    db
      .from("orders")
      .select("id,user_id")
      .in("status", ["checkout_ready", "checkout_needs_review"])
      .gte(
        "created_at",
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      )
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("subscriptions")
      .select("order_id,user_id")
      .in("status", ["authorized", "paused"])
      .lte(
        "paid_until",
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      )
      .order("paid_until")
      .limit(5),
  ]);
  if (jobs.error || events.error || checkouts.error || renewals.error)
    return new Response("Retry", { status: 503 });
  after(async () => {
    for (const event of events.data || []) {
      if (Date.now() > deadline - 60000) break;
      await processInbox(event.event_key, event.topic, event.resource_id);
    }
    const orders = new Map(
      (checkouts.data || []).map((o) => [o.id, o.user_id]),
    );
    for (const sub of renewals.data || [])
      orders.set(sub.order_id, sub.user_id);
    for (const [id, userId] of orders) {
      if (Date.now() > deadline - 60000) break;
      await reconcileCheckout(userId, id).catch(() =>
        console.error("cron_checkout_pending", id),
      );
    }
    await endLaunchPrices().catch(() =>
      console.error("cron_launch_prices_failed"),
    );
    for (const job of jobs.data || [])
      try {
        await runJob(job.id, deadline);
      } catch {
        console.error("cron_job_failed", job.id);
      }
  });
  return Response.json({ scheduled: true });
}

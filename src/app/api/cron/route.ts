import { after } from "next/server";
import { sameSecret } from "@/lib/session";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { adminClient } from "@/lib/supabase/server";
import { runJob } from "@/lib/commerce/jobs";
import { processInbox } from "@/lib/commerce/mercadopago";
export const maxDuration = 300;
export async function GET(request: Request) {
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
  const [jobs, events] = await Promise.all([
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
      .order("received_at")
      .limit(10),
  ]);
  if (jobs.error || events.error) return new Response("Retry", { status: 503 });
  after(async () => {
    for (const event of events.data || [])
      await processInbox(event.event_key, event.topic, event.resource_id);
    for (const job of jobs.data || [])
      try {
        await runJob(job.id);
      } catch {
        console.error("cron_job_failed", job.id);
      }
  });
  return Response.json({ scheduled: true });
}

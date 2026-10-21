import { after } from "next/server";
import { requireUser, failure, rpc } from "@/lib/commerce/http";
import { enqueuePhoto, runJob } from "@/lib/commerce/jobs";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  const started = Date.now();
  try {
    const user = await requireUser(request, true);
    await rpc("amobla_account", {
      p_user: user.id,
      p_trial: process.env.LIVE_TRIAL_ENABLED === "true",
    });
    // When this function will be stopped (maxDuration), so each render
    // leaves room to record its result.
    const deadline = started + maxDuration * 1000 - 5000;
    const batch = await enqueuePhoto(request, user.id);
    after(async () => {
      try {
        await Promise.allSettled(batch.ids.map((id) => runJob(id, deadline)));
      } catch {
        console.error("job_dispatch_failed", batch.projectId);
      }
    });
    return Response.json(
      { id: batch.ids[0], ids: batch.ids, projectId: batch.projectId },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

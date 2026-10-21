import { after } from "next/server";
import { requireUser, failure, rpc } from "@/lib/commerce/http";
import { enqueuePhoto, runJob } from "@/lib/commerce/jobs";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const user = await requireUser(request, true);
    await rpc("amobla_account", {
      p_user: user.id,
      p_trial: process.env.LIVE_TRIAL_ENABLED === "true",
    });
    const id = await enqueuePhoto(request, user.id);
    after(async () => {
      try {
        await runJob(id);
      } catch {
        console.error("job_dispatch_failed", id);
      }
    });
    return Response.json(
      { id },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

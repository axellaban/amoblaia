import { after } from "next/server";
import { requireUser, failure, HttpError, rpc } from "@/lib/commerce/http";
import { runJob, signPath } from "@/lib/commerce/jobs";
import { adminClient } from "@/lib/supabase/server";
export const maxDuration = 300;
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const deadline = Date.now() + maxDuration * 1000 - 5000;
  try {
    const user = await requireUser(undefined, true);
    const { id } = await params;
    const { data: job, error } = await adminClient()
      .from("generations")
      .select(
        "id,status,result_path,error_code,project_id,is_free,room,style,mode,notes,created_at,started_at",
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !job)
      throw new HttpError(404, "No encontramos esta generación.");
    // A worker that died leaves the job 'running': past ten minutes it goes
    // to review here instead of polling forever (and locking the account).
    if (
      job.status === "running" &&
      job.started_at &&
      Date.now() - Date.parse(job.started_at) > 10 * 60 * 1000
    ) {
      await rpc("amobla_sweep_stale", { p_user: user.id }).catch(() => null);
      job.status = "needs_review";
    }
    if (job.status === "queued")
      after(async () => {
        try {
          await runJob(id, deadline);
        } catch {
          console.error("job_dispatch_failed", id);
        }
      });
    const result = job.result_path ? await signPath(job.result_path) : null;
    return Response.json(
      {
        id: job.id,
        status: job.status,
        projectId: job.project_id,
        result,
        variant: result
          ? {
              id: job.id,
              result,
              free: job.is_free,
              room: job.room,
              style: job.style,
              mode: job.mode,
              notes: job.notes,
              createdAt: Date.parse(job.created_at),
            }
          : null,
        error:
          job.status === "needs_review"
            ? "Estamos revisando esta generación. No vuelvas a enviarla; el equipo puede recuperar el resultado."
            : job.status === "failed"
              ? "La generación falló. Si se reservó una foto nueva, la devolvimos a tu saldo."
              : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

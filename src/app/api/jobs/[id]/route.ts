import { after } from "next/server";
import { requireUser, failure, HttpError } from "@/lib/commerce/http";
import { runJob, signPath } from "@/lib/commerce/jobs";
import { adminClient } from "@/lib/supabase/server";
export const maxDuration = 300;
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { data: job, error } = await adminClient()
      .from("generations")
      .select("id,status,result_path,error_code,project_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !job)
      throw new HttpError(404, "No encontramos esta generación.");
    if (job.status === "queued")
      after(async () => {
        try {
          await runJob(id);
        } catch {
          console.error("job_dispatch_failed", id);
        }
      });
    return Response.json(
      {
        id: job.id,
        status: job.status,
        projectId: job.project_id,
        result: job.result_path ? await signPath(job.result_path) : null,
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

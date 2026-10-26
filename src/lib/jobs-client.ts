import type { Project } from "@/lib/history";
export type JobState = {
  status?: string;
  error?: string;
  result?: string;
  variant?: NonNullable<Project["variants"]>[number];
  projectId?: string;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Polls a generation until it succeeds, fails or goes to review. Returns null
 * while it is still running after about five minutes; it keeps going on the
 * server and ends up in the user's projects.
 */
export async function waitForJob(id: string) {
  let failures = 0;
  for (let i = 0; i < 105; i++) {
    let job: JobState | null;
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      job = await response.json().catch(() => null);
      // Server hiccups and dropped connections are retried; only a real
      // answer (such as 'not found') ends the wait.
      if (response.status >= 500 || response.status === 429 || !job)
        throw new Error("RETRY");
      if (!response.ok)
        throw Object.assign(new Error(job.error), { final: true });
      failures = 0;
    } catch (e) {
      if ((e as { final?: boolean }).final) throw e;
      if (++failures > 8)
        throw new Error(
          "Perdimos la conexión. Tu diseño sigue en proceso y queda guardado en Mis fotos.",
          { cause: e },
        );
      await pause(3000);
      continue;
    }
    if (["succeeded", "failed", "needs_review"].includes(job.status || ""))
      return job;
    await pause(i < 20 ? 1500 : 3000);
  }
  return null;
}

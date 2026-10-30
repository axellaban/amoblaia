import { requireUser, failure, HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
export async function GET() {
  try {
    const user = await requireUser();
    const { data, error } = await adminClient()
      .from("profiles")
      .select("onboarding_completed_at")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw new Error("ONBOARDING_READ_FAILED");
    return Response.json(
      { completed: Boolean(data?.onboarding_completed_at) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    // Without a session there is no tour to show: answered without an error, so a visit logs none.
    if (e instanceof HttpError && e.status === 401)
      return Response.json({ completed: true }, { headers: { "Cache-Control": "private, no-store" } });
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const { error } = await adminClient()
      .from("profiles")
      .upsert(
        { id: user.id, onboarding_completed_at: new Date().toISOString() },
        { onConflict: "id" },
      );
    if (error) throw new Error("ONBOARDING_SAVE_FAILED");
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

import { requireUser, failure, HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { mp, syncSubscription } from "@/lib/commerce/mercadopago";
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const { id } = await request.json();
    if (typeof id !== "string" || !/^[a-z0-9_-]{1,100}$/i.test(id))
      throw new HttpError(400, "Suscripción inválida.");
    const { data, error } = await adminClient()
      .from("subscriptions")
      .select("id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data)
      throw new HttpError(404, "No encontramos la suscripción.");
    await mp(`/preapproval/${encodeURIComponent(id)}`, "PUT", {
      status: "cancelled",
    });
    await syncSubscription(id);
    return Response.json({ cancelled: true });
  } catch (e) {
    return failure(e);
  }
}

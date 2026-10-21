import { requireUser, failure, HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import {
  retireSubscription,
  syncSubscription,
} from "@/lib/commerce/mercadopago";
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
    // Cancels in Mercado Pago and records it here at once; the account must
    // not keep showing an active plan because a follow-up read failed.
    await retireSubscription(id);
    await syncSubscription(id).catch(() =>
      console.error("subscription_sync_deferred", id),
    );
    return Response.json({ cancelled: true });
  } catch (e) {
    return failure(e);
  }
}

import { after } from "next/server";
import { sameSecret } from "@/lib/session";
import { adminClient } from "@/lib/supabase/server";
import {
  validWebhookSignature,
  processInbox,
} from "@/lib/commerce/mercadopago";
export const maxDuration = 300;
export async function POST(request: Request) {
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN)
    return new Response("Unavailable", { status: 503 });
  if (Number(request.headers.get("content-length") || 0) > 32768)
    return new Response("Too large", { status: 413 });
  try {
    const url = new URL(request.url);
    const body = await request.json();
    // notification_url also receives legacy IPN callbacks (?topic=payment&id=...) alongside webhooks.
    const id = String(
      url.searchParams.get("data.id") ||
        body.data?.id ||
        url.searchParams.get("id") ||
        "",
    );
    const topic = String(
      url.searchParams.get("type") ||
        body.type ||
        url.searchParams.get("topic") ||
        body.topic ||
        "",
    );
    if (
      ![
        "payment",
        "subscription_preapproval",
        "subscription_authorized_payment",
      ].includes(topic)
    )
      return new Response("OK");
    if (!/^[a-z0-9_-]{1,100}$/i.test(id))
      return new Response("Invalid", { status: 400 });
    const token = process.env.MERCADOPAGO_NOTIFICATION_TOKEN;
    const tokenValid = Boolean(
      token &&
        token.length >= 32 &&
        sameSecret(url.searchParams.get("token") || "", token),
    );
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    const signatureValid = Boolean(
      secret && validWebhookSignature(request.headers, id, secret),
    );
    // Some subscription notification flows do not sign callbacks, and the signing secret only exists once the
    // Webhooks panel is configured. Those use a server-generated URL token; every event is subsequently
    // verified through MP's API, including seller, order, amount and currency.
    if (
      secret && request.headers.has("x-signature")
        ? !signatureValid
        : !tokenValid
    )
      return new Response("Unauthorized", { status: 401 });
    const key = `${topic}:${id}:${String(body.id || body.date_created || request.headers.get("x-request-id") || "event").slice(0, 100)}`;
    const saved = await adminClient()
      .from("webhook_events")
      .upsert(
        {
          event_key: key,
          topic,
          resource_id: id,
          processed_at: null,
          last_error: null,
        },
        { onConflict: "event_key" },
      );
    if (saved.error) return new Response("Retry", { status: 503 });
    after(() => processInbox(key, topic, id));
    return new Response("OK");
  } catch {
    return new Response("Invalid", { status: 400 });
  }
}

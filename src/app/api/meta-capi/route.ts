import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { validOrigin } from "@/lib/session";
import { currentUser } from "@/lib/supabase/server";

const GRAPH_VERSION = "v25.0";
const ok = () => Response.json({ ok: true });

function customData(value: unknown) {
  const out: Record<string, string | number | boolean> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, v] of Object.entries(value).slice(0, 20)) {
    if (!/^\w{1,40}$/.test(key)) continue;
    if (typeof v === "string") out[key] = v.slice(0, 200);
    else if (typeof v === "boolean" || (typeof v === "number" && isFinite(v)))
      out[key] = v;
  }
  return out;
}

/** Server half of the Meta Pixel: relays browser events to the Conversions
 * API. Without credentials it does nothing, and it never fails the caller. */
export async function POST(request: Request) {
  const pixel = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixel || !token) return ok();
  if (!validOrigin(request))
    return Response.json({ error: "Origen inválido." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 4096)
    return Response.json({ error: "Solicitud inválida." }, { status: 413 });
  try {
    const body = await request.json();
    const { eventName, eventId, url } = body ?? {};
    if (
      typeof eventName !== "string" ||
      !/^\w{1,64}$/.test(eventName) ||
      typeof eventId !== "string" ||
      !/^[\w-]{1,100}$/.test(eventId)
    )
      return Response.json({ error: "Evento inválido." }, { status: 400 });

    const jar = await cookies();
    const user = await currentUser().catch(() => null);
    const email = (
      user?.email || (typeof body.email === "string" ? body.email : "")
    )
      .trim()
      .toLowerCase();
    const forwarded = request.headers.get("x-forwarded-for");
    const userData: Record<string, unknown> = {
      client_ip_address: forwarded?.split(",")[0].trim() || undefined,
      client_user_agent: request.headers.get("user-agent") || undefined,
      fbp: jar.get("_fbp")?.value,
      fbc: jar.get("_fbc")?.value,
      em: /^[^@\s]+@[^@\s]+$/.test(email)
        ? [createHash("sha256").update(email).digest("hex")]
        : undefined,
    };
    const sameSite =
      typeof url === "string" &&
      URL.canParse(url) &&
      new URL(url).origin === new URL(request.url).origin;
    const payload: Record<string, unknown> = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: "website",
          event_source_url: sameSite ? url : request.headers.get("referer"),
          user_data: userData,
          custom_data: customData(body.customData),
        },
      ],
    };
    if (process.env.META_TEST_EVENT_CODE)
      payload.test_event_code = process.env.META_TEST_EVENT_CODE;

    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixel}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok)
      console.error(
        "meta_capi_failed",
        response.status,
        (await response.text().catch(() => "")).slice(0, 300),
      );
  } catch (error) {
    console.error(
      "meta_capi_error",
      error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN",
    );
  }
  return ok();
}

import { NextResponse } from "next/server";
import { consumeDeviceLink, deviceLabel } from "@/lib/internal/server";
import { validLinkToken } from "@/lib/internal/shared";
import { cloudConfigured } from "@/lib/supabase/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /interno/vincular?t=<token>: a one-time link from /admin/internos that
 * marks the browser that opens it (a phone, a private window, another Chrome
 * profile) as the team's. Valid once, for 30 minutes; only its hash is
 * stored. Lands on /interno, which shows the result.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const to = (q: string) => {
    const r = NextResponse.redirect(new URL(`/interno?${q}`, url.origin));
    r.headers.set("Cache-Control", "no-store");
    r.headers.set("Referrer-Policy", "no-referrer");
    return r;
  };
  if (!cloudConfigured()) return to("estado=no-disponible");
  const token = url.searchParams.get("t");
  if (!validLinkToken(token)) return to("estado=enlace-invalido");
  try {
    const id = await consumeDeviceLink(token, `${deviceLabel(request.headers.get("user-agent"))} · enlace`);
    return to(id ? "estado=vinculado" : "estado=enlace-invalido");
  } catch {
    console.error("internal_link_failed");
    return to("estado=error");
  }
}

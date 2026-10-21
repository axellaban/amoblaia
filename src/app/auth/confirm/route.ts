import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { adoptGuest } from "@/lib/commerce/guest";
import { cookies } from "next/headers";
import { EMAIL_FLOW_COOKIE, safeNext } from "@/lib/commerce/redirect";
import { GUEST_COOKIE } from "@/lib/guest-token";
import { validOrigin } from "@/lib/session";
const types = ["email", "signup", "recovery"] as const;
type LinkType = (typeof types)[number];
// Email links only show a confirmation page: signing in on a plain GET would
// let anyone log a visitor into the sender's account with a crafted link.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = new URL("/auth/confirmar", url.origin);
  for (const key of ["token_hash", "type", "next"]) {
    const value = url.searchParams.get(key);
    if (value) page.searchParams.set(key, value);
  }
  return NextResponse.redirect(page);
}
export async function POST(request: Request) {
  const url = new URL(request.url);
  // 303 so the browser follows with a GET instead of re-posting the form.
  const go = (path: string) =>
    NextResponse.redirect(new URL(path, url.origin), 303);
  if (!validOrigin(request)) return go("/acceso?error=enlace");
  const form = await request.formData().catch(() => null);
  const token_hash = String(form?.get("token_hash") || "");
  const type = String(form?.get("type") || "") as LinkType;
  if (!token_hash || !types.includes(type)) return go("/acceso?error=enlace");
  const supabase = await userClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (error) return go("/acceso?error=enlace");
  // Only the browser that asked for this email hands its trial over; any
  // other one forgets its trial instead of giving it to this account.
  const jar = await cookies();
  if (jar.get(EMAIL_FLOW_COOKIE)) {
    if (data.user) await adoptGuest(data.user);
  } else jar.delete(GUEST_COOKIE);
  jar.delete(EMAIL_FLOW_COOKIE);
  return go(
    type === "recovery"
      ? "/acceso?modo=actualizar"
      : safeNext(String(form?.get("next") || "") || null),
  );
}

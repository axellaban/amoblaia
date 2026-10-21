import { cookies } from "next/headers";
import { GUEST_COOKIE } from "@/lib/guest-token";
import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { guestId } from "@/lib/commerce/guest";
import { rpc } from "@/lib/commerce/http";
import { safeNext } from "@/lib/commerce/redirect";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await userClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await supabase.auth.getUser();
      const guest = await guestId();
      if (guest && data.user?.email_confirmed_at && guest !== data.user.id)
        await rpc("amobla_claim_guest", {
          p_guest: guest,
          p_user: data.user.id,
        });
      (await cookies()).delete(GUEST_COOKIE);
      return NextResponse.redirect(
        new URL(
          safeNext(url.searchParams.get("next"), "/proyectos"),
          url.origin,
        ),
      );
    }
  }
  // A Google sign-in that was cancelled or failed returns here without a code.
  const failed = new URL("/acceso", url.origin);
  failed.searchParams.set(
    "error",
    url.searchParams.has("error") || code ? "google" : "enlace",
  );
  const next = url.searchParams.get("next");
  if (next) failed.searchParams.set("next", safeNext(next, "/proyectos"));
  return NextResponse.redirect(failed);
}

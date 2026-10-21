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
      return NextResponse.redirect(
        new URL(
          safeNext(url.searchParams.get("next"), "/proyectos"),
          url.origin,
        ),
      );
    }
  }
  return NextResponse.redirect(new URL("/acceso?error=enlace", url.origin));
}

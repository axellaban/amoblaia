import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/commerce/redirect";
export async function GET(request: Request) {
  const url = new URL(request.url),
    token_hash = url.searchParams.get("token_hash"),
    type = url.searchParams.get("type");
  if (
    token_hash &&
    (type === "email" || type === "signup" || type === "recovery")
  ) {
    const supabase = await userClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error)
      return NextResponse.redirect(
        new URL(
          type === "recovery"
            ? "/acceso?modo=actualizar"
            : safeNext(url.searchParams.get("next")),
          url.origin,
        ),
      );
  }
  return NextResponse.redirect(new URL("/acceso?error=enlace", url.origin));
}

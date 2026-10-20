import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/commerce/redirect";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await userClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(safeNext(url.searchParams.get("next")), url.origin),
      );
  }
  return NextResponse.redirect(new URL("/acceso?error=enlace", url.origin));
}

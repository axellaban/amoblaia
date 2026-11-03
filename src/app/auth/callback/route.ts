import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { adoptGuest } from "@/lib/commerce/guest";
import { safeNext } from "@/lib/commerce/redirect";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await userClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await supabase.auth.getUser();
      // Never fails the sign-in; a failed trial hand-over is retried later.
      if (data.user) await adoptGuest(data.user);
      return NextResponse.redirect(
        new URL(
          safeNext(url.searchParams.get("next"), "/inicio"),
          url.origin,
        ),
      );
    }
  }
  // A cancelled or failed sign-in returns here without a usable code. Only
  // the same-tab Google button sets flow=google; email links are 'enlace'.
  const failed = new URL("/acceso", url.origin);
  failed.searchParams.set(
    "error",
    url.searchParams.get("flow") === "google" ? "google" : "enlace",
  );
  const next = url.searchParams.get("next");
  if (next) failed.searchParams.set("next", safeNext(next, "/inicio"));
  return NextResponse.redirect(failed);
}

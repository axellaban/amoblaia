import { NextResponse } from "next/server";
import { joinFromVisit, JOIN_PATH } from "@/lib/agency/join";
import { membershipOf } from "@/lib/agency/server";
import { safeNext } from "@/lib/commerce/redirect";
import { currentUser } from "@/lib/supabase/server";
import { VISIT_COOKIE } from "@/lib/agency/visit-token";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FAILED = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No pudimos entrar a tu panel</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:15vh auto;padding:0 16px;color:#1f2a24}a{display:inline-block;margin-top:1rem;padding:.7rem 1.1rem;border-radius:.6rem;background:#1f5c45;color:#fff;text-decoration:none}</style></head>
<body><h1>No pudimos entrar a tu panel</h1><p>Tu cuenta quedó creada. Volvé a intentarlo en unos segundos; si sigue pasando, escribinos y lo resolvemos.</p><a href="${JOIN_PATH}">Reintentar</a></body></html>`;

/**
 * The end of the sign-up (or sign-in) that started in an agency's panel,
 * opened from its demo or its panel link: the account enters that agency by
 * itself (joinFromVisit), with no question, and lands where it was. Without a
 * visit it goes on as any sign-in would.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = safeNext(url.searchParams.get("volver"), "/panel");
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  const user = await currentUser().catch(() => null);
  if (!user || user.is_anonymous || !user.email_confirmed_at)
    return to(`/acceso?${new URLSearchParams({ modo: "registro", next: `${url.pathname}${url.search}` })}`);
  try {
    const joined = await joinFromVisit(user);
    if (!joined) return to((await membershipOf(user.id)) ? back : "/inicio");
    const done = to(back.startsWith("/panel") ? back : "/panel");
    // The visit did its job: from now on the account is the way in.
    done.cookies.delete(VISIT_COOKIE);
    return done;
  } catch {
    console.error("visit_join_failed");
    return new NextResponse(FAILED, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
  }
}

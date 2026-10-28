import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { recordDemoView, VISITOR_COOKIE, VISITOR_SECONDS } from "@/lib/demos/server";
import { isUuid } from "@/lib/demos/shared";
import { currentUser } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
type Params = { params: Promise<{ token: string }> };

/**
 * A browser opened a published demo; the public page calls this once per load
 * and does not wait for it. A signed-in account is counted as itself; any
 * other browser by a random cookie kept for a year. Nothing here is shown to
 * the viewer, and an unknown or unpublished token counts nothing.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const user = await currentUser().catch(() => null);
    const account = user && !user.is_anonymous && user.email_confirmed_at ? user : null;
    const jar = await cookies();
    let visitor = jar.get(VISITOR_COOKIE)?.value;
    if (!isUuid(visitor)) {
      visitor = randomUUID();
      jar.set(VISITOR_COOKIE, visitor, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: VISITOR_SECONDS,
      });
    }
    const recorded = await recordDemoView(token, {
      key: account ? `cuenta:${account.id}` : `visitante:${visitor}`,
      userId: account?.id ?? null,
      email: account?.email ?? null,
    });
    return new Response(null, { status: recorded ? 204 : 404, headers: NO_STORE });
  } catch {
    console.error("demo_view_failed");
    return new Response(null, { status: 500, headers: NO_STORE });
  }
}

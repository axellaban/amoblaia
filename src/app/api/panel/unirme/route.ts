import { failure, HttpError, requireUser, rpc } from "@/lib/commerce/http";
import { joinAgency, joinWithNewAccount } from "@/lib/agency/team";
import { readJson } from "@/lib/demos/input";
import { validOrigin } from "@/lib/session";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };

/**
 * An employee uses the access their agency created for them: { code,
 * password } creates the account of the invited e-mail (the browser then
 * signs in with it); { code } alone joins with the signed-in account, which
 * must be that same e-mail's.
 */
export async function POST(request: Request) {
  try {
    if (!cloudEnabled() || !cloudConfigured()) throw new HttpError(503, "Las cuentas todavía no están habilitadas.");
    if (!validOrigin(request)) throw new HttpError(403, "Origen inválido.");
    const body = await readJson(request, 2048);
    if ("password" in body) {
      const result = await joinWithNewAccount(body.code, body.password);
      return Response.json({ email: result.email, created: true }, { status: 201, headers: PRIVATE });
    }
    const user = await requireUser(request);
    await rpc("amobla_account", { p_user: user.id, p_trial: false });
    await joinAgency(user.id, user.email, body.code);
    return Response.json({ joined: true }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

import { failure, HttpError } from "@/lib/commerce/http";
import { acceptWithNewAccount } from "@/lib/agency/invitation";
import { readJson } from "@/lib/demos/input";
import { validOrigin } from "@/lib/session";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
export const runtime = "nodejs";

/**
 * Accepts the team's invitation with a new account: { code, email, password }.
 * The browser then signs in with those same credentials. An e-mail that
 * already has an account answers 409: sign in, then claim with /api/panel/reclamar.
 */
export async function POST(request: Request) {
  try {
    if (!cloudEnabled() || !cloudConfigured()) throw new HttpError(503, "Las cuentas todavía no están habilitadas.");
    if (!validOrigin(request)) throw new HttpError(403, "Origen inválido.");
    const body = await readJson(request, 2048);
    const result = await acceptWithNewAccount(body.code, body.email, body.password);
    return Response.json({ email: result.email }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

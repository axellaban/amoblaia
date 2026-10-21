import { cookies } from "next/headers";
import { currentUser, userClient, adminClient } from "@/lib/supabase/server";
import { validOrigin } from "@/lib/session";
import { failure, HttpError, rpc } from "@/lib/commerce/http";
import { guestFingerprint, guestId, guestSecret } from "@/lib/commerce/guest";
import { GUEST_COOKIE, GUEST_SECONDS, guestToken } from "@/lib/guest-token";
export async function POST(request: Request) {
  try {
    if (!validOrigin(request)) throw new HttpError(403, "Origen inválido.");
    if (process.env.LIVE_TRIAL_ENABLED !== "true")
      throw new HttpError(
        503,
        "La prueba gratuita no está disponible en este momento.",
      );
    let user = await currentUser();
    const previousId = await guestId();
    if (!user && previousId) {
      const previous = await adminClient().auth.admin.getUserById(previousId);
      if (previous.data.user?.is_anonymous) user = previous.data.user;
    }
    if (!user) {
      await rpc("amobla_guest_capacity", { p_ip: guestFingerprint(request) });
      const client = await userClient();
      const response = await client.auth.signInAnonymously();
      if (response.error || !response.data.user)
        throw new HttpError(
          503,
          "No pudimos iniciar la prueba gratuita. Intentá nuevamente en unos minutos.",
        );
      user = response.data.user;
    }
    if (!user.is_anonymous) {
      const account = await rpc("amobla_account", {
        p_user: user.id,
        p_trial: true,
      });
      return Response.json(account, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    await rpc("amobla_register_guest", {
      p_user: user.id,
      p_ip: guestFingerprint(request),
    });
    (await cookies()).set(GUEST_COOKIE, guestToken(user.id, guestSecret()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: GUEST_SECONDS,
    });
    const account = await rpc("amobla_account", {
      p_user: user.id,
      p_trial: true,
    });
    return Response.json(account, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}

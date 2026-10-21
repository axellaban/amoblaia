import { currentUser, userClient, adminClient } from "@/lib/supabase/server";
import { validOrigin } from "@/lib/session";
import { failure, HttpError, rpc } from "@/lib/commerce/http";
import {
  guestFingerprint,
  guestId,
  setGuestCookie,
} from "@/lib/commerce/guest";
export async function POST(request: Request) {
  try {
    if (!validOrigin(request)) throw new HttpError(403, "Origen inválido.");
    if (process.env.LIVE_TRIAL_ENABLED !== "true")
      throw new HttpError(
        503,
        "La prueba gratuita no está disponible en este momento.",
      );
    let user = await currentUser();
    let newSession = false;
    const previousId = await guestId();
    if (!user && previousId) {
      const previous = await adminClient().auth.admin.getUserById(previousId);
      if (previous.data.user?.is_anonymous) user = previous.data.user;
    }
    if (!user) {
      await rpc("amobla_guest_capacity", { p_ip: guestFingerprint(request) });
      // Required by Supabase when its CAPTCHA protection is on.
      const body = await request
        .json()
        .catch(() => ({}) as { captchaToken?: unknown });
      const captchaToken =
        typeof body?.captchaToken === "string" &&
        body.captchaToken.length <= 4096
          ? body.captchaToken
          : undefined;
      const client = await userClient();
      const response = await client.auth.signInAnonymously({
        options: { captchaToken },
      });
      if (response.error || !response.data.user)
        throw new HttpError(
          503,
          "No pudimos iniciar la prueba gratuita. Intentá nuevamente en unos minutos.",
        );
      user = response.data.user;
      newSession = true;
    }
    if (!user.is_anonymous) {
      const account = await rpc<Record<string, unknown>>("amobla_account", {
        p_user: user.id,
        p_trial: true,
      });
      return Response.json(
        { ...account, newSession },
        {
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }
    await rpc("amobla_register_guest", {
      p_user: user.id,
      p_ip: guestFingerprint(request),
    });
    // Also renews the cookie of a trial that is already registered.
    await setGuestCookie(user.id);
    const account = await rpc<Record<string, unknown>>("amobla_account", {
      p_user: user.id,
      p_trial: true,
    });
    return Response.json(
      { ...account, newSession },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (e) {
    return failure(e);
  }
}

import { after } from "next/server";
import { readJson } from "@/lib/demos/input";
import {
  attachAliases,
  classifyRequest,
  deviceLabel,
  forgetDevice,
  issueDevice,
  matchFingerprint,
  recomputeAfterInternalChange,
  recordFingerprint,
  rememberUserId,
  renewDeviceCookie,
} from "@/lib/internal/server";
import { clientIp, type FingerprintInput } from "@/lib/internal/shared";
import { validOrigin } from "@/lib/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

/**
 * Whether this browser is the team's, asked once per page load by the
 * tracking code: { visitor, device, hint, forget? } →
 * { internal, reason, reset }. Never returns who the person is or any e-mail.
 *
 * - Signed in with an internal account: the browser gets (or renews) its
 *   signed device cookie, so it stays internal when it later opens a public
 *   demo without a session.
 * - Signed in with an account outside the team on a browser marked internal:
 *   the mark is revoked and `reset` tells the page to clear PostHog's flag
 *   and identity, so that person never inherits the team's classification.
 * - `forget`: «dejar de marcar este dispositivo» (the /interno page).
 * - A private window (or another profile) without session or cookie whose
 *   network + device fingerprint (IP, exact user agent, screen and time
 *   zone, hashed) matches a recent internal visit gets its own device cookie
 *   (source «fingerprint»): from then on the server treats it as internal.
 *   The IP alone never classifies anybody.
 * The browser ids it sends become aliases of the device, and the demos they
 * touched are recalculated after the response.
 */
export async function POST(request: Request) {
  if (!validOrigin(request)) return Response.json({ error: "Origen inválido." }, { status: 403, headers: NO_STORE });
  let body: Record<string, unknown> = {};
  try {
    body = await readJson(request, 1024);
  } catch {
    /* An empty body is a plain status check. */
  }
  let c = await classifyRequest({ hint: body.hint === true });
  const fp: FingerprintInput = { ip: clientIp(request.headers), userAgent: request.headers.get("user-agent"), screen: body.screen, tz: body.tz };
  const label = deviceLabel(request.headers.get("user-agent"));
  let reason: string | null = c.reason;
  try {
    if (body.forget === true) {
      await forgetDevice(c.deviceId, "olvidado_por_el_usuario");
      const signedIn = c.session.kind === "internal";
      return Response.json({ internal: signedIn, reason: signedIn ? "team_session" : null, reset: true }, { headers: NO_STORE });
    }
    if (c.clearDevice) {
      await forgetDevice(c.deviceId, c.session.kind === "external" ? "otra_cuenta" : "revocado");
      return Response.json({ internal: false, reason: null, reset: true }, { headers: NO_STORE });
    }
    let device = c.deviceId;
    // Nothing known about this browser (and no account): maybe a private window of the team.
    if (!c.internal && c.session.kind === "none" && !c.deviceId) {
      const match = await matchFingerprint(fp).catch(() => undefined);
      if (match) {
        device = await issueDevice({ personId: match.personId, source: "fingerprint", label: `${label} · huella del equipo` });
        c = { ...c, internal: true, reason: "internal_device", personId: match.personId, deviceId: device };
        reason = "team_fingerprint";
      }
    }
    if (c.session.kind === "internal") {
      if (c.personId) await rememberUserId(c.personId, c.session.userId).catch(() => undefined);
      // A device of another person (a shared team computer) is fine: the session already says internal.
      if (!c.deviceId || !(await deviceIsInternal(c))) {
        device = await issueDevice({ personId: c.personId, source: "login", label });
      } else await renewDeviceCookie(c.deviceId);
    }
    if (c.internal && device && c.reason !== "device_hint") {
      // Verified internal (account or signed device): this network + device is the team's for a while.
      await recordFingerprint(fp, { personId: c.personId, deviceId: device }, label).catch(() => undefined);
      const fresh = await attachAliases(device, body.visitor, body.device);
      if (fresh.length) after(() => recomputeAfterInternalChange(fresh).then(() => undefined).catch(() => console.error("internal_recompute_failed")));
    }
  } catch {
    console.error("internal_status_failed");
  }
  return Response.json({ internal: c.internal, reason, reset: false }, { headers: NO_STORE });
}

/** The session is internal: is the cookie's device itself still an internal one? */
async function deviceIsInternal(c: Awaited<ReturnType<typeof classifyRequest>>) {
  const plain = await classifyRequest({ user: null });
  return plain.deviceId === c.deviceId && plain.reason === "internal_device";
}

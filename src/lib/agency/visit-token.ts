import { createHmac, timingSafeEqual } from "node:crypto";

// The prospect's visit to its panel: the agency opens its own panel from its
// demo, before creating its account, and looks around. A signed cookie holds
// the invitation code it came with (the same secret the agency already has in
// its link) and expires with it; the server checks the invitation again on
// every request, so a used, revoked or expired code closes the visit at once.
// Pure: the key is passed in, so it can be tested.

export const VISIT_COOKIE = "habita_visita";
/** At most a week, and never past the invitation's own expiry. */
export const VISIT_SECONDS = 7 * 24 * 3600;

export type Visit = { code: string; exp: number };

const mac = (payload: string, key: string) => createHmac("sha256", key).update(`habita-visit:${payload}`).digest("hex");

/** The cookie's value: the code and its expiry (seconds), signed. */
export function visitToken(code: string, key: string, now = Date.now(), until: number | null = null) {
  const max = Math.floor(now / 1000) + VISIT_SECONDS;
  const exp = until ? Math.min(max, Math.floor(until / 1000)) : max;
  const payload = `${code}.${exp}`;
  return `${payload}.${mac(payload, key)}`;
}

/** The visit the cookie opens, if it is well formed, signed with this key and unexpired. */
export function readVisit(token: string | undefined, key: string, now = Date.now()): Visit | null {
  if (!token || !key) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [code, exp, given] = parts;
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(code) || !/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(given)) return null;
  const seconds = Number(exp);
  if (seconds * 1000 <= now || seconds > Math.floor(now / 1000) + VISIT_SECONDS) return null;
  const expected = Buffer.from(mac(`${code}.${exp}`, key), "hex");
  if (!timingSafeEqual(Buffer.from(given, "hex"), expected)) return null;
  return { code, exp: seconds };
}

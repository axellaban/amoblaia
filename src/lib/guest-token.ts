import { createHmac, timingSafeEqual } from "node:crypto";
export const GUEST_COOKIE = "amoblaia-guest";
export const GUEST_SECONDS = 30 * 24 * 60 * 60;
export function guestToken(id: string, key: string, now = Date.now()) {
  const body = `${id}.${Math.floor(now / 1000) + GUEST_SECONDS}`;
  return `${body}.${createHmac("sha256", key).update(`guest:${body}`).digest("hex")}`;
}
export function verifyGuestToken(
  token: string | undefined,
  key: string,
  now = Date.now(),
) {
  if (!token || !key) return null;
  const [id, expiry, mac, extra] = token.split(".");
  if (
    extra ||
    !/^[0-9a-f-]{36}$/i.test(id || "") ||
    !/^\d+$/.test(expiry || "") ||
    !/^[0-9a-f]{64}$/.test(mac || "")
  )
    return null;
  const seconds = Math.floor(now / 1000);
  if (Number(expiry) <= seconds || Number(expiry) > seconds + GUEST_SECONDS)
    return null;
  const expected = createHmac("sha256", key)
    .update(`guest:${id}.${expiry}`)
    .digest();
  return timingSafeEqual(Buffer.from(mac, "hex"), expected) ? id : null;
}

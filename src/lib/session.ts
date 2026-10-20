import { createHmac, timingSafeEqual } from "node:crypto";
export const COOKIE_NAME = "amoblaia-pilot";
export const SESSION_SECONDS = 8 * 60 * 60;
export function configurationIssues() {
  const issues: string[] = [];
  if (!process.env.OPENAI_API_KEY?.trim()) issues.push("OPENAI_API_KEY_MISSING");
  if (!process.env.STUDIO_ACCESS_PASSWORD) {
    issues.push("STUDIO_ACCESS_PASSWORD_MISSING");
  } else if (process.env.STUDIO_ACCESS_PASSWORD.length < 16) {
    issues.push("STUDIO_ACCESS_PASSWORD_TOO_SHORT");
  }
  return issues;
}
export function configured() {
  return configurationIssues().length === 0;
}
export function sameSecret(a: string, b: string) {
  const hash = (s: string) =>
    createHmac("sha256", "amoblaia-password-compare").update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}
export function createSession(password: string, now = Date.now()) {
  const expiry = Math.floor(now / 1000) + SESSION_SECONDS;
  return `${expiry}.${createHmac("sha256", password).update(`amoblaia:${expiry}`).digest("hex")}`;
}
export function verifySession(
  token: string | undefined,
  password: string | undefined,
  now = Date.now(),
) {
  if (!token || !password || password.length < 16) return false;
  const [expiry, signature, extra] = token.split(".");
  const seconds = Math.floor(now / 1000);
  if (
    extra ||
    !/^\d+$/.test(expiry) ||
    !signature ||
    Number(expiry) <= seconds ||
    Number(expiry) > seconds + SESSION_SECONDS
  )
    return false;
  return sameSecret(
    signature,
    createHmac("sha256", password).update(`amoblaia:${expiry}`).digest("hex"),
  );
}
export function validOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

/**
 * Internal traffic: the rules, without I/O, shared by the server and the
 * tests. Who is internal is decided on the server, from the signed-in
 * account (the registry) or from a device the server itself marked (a
 * signed, HttpOnly cookie). The browser only receives the verdict, never
 * the list of accounts. See docs/TRAFICO_INTERNO.md.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** The device cookie: HttpOnly, one year, renewed on each internal sign-in. */
export const DEVICE_COOKIE = "habita_dispositivo";
export const DEVICE_MAX_AGE = 365 * 24 * 3600;
/** A link to mark another device (phone, incognito, other profile) lasts this long and works once. */
export const LINK_MINUTES = 30;

export type InternalRole = "admin" | "collaborator" | "test";
export type DeviceStatus = "internal" | "unknown" | "external" | "revoked";

/** Why something is internal (stored with each event; short codes). */
export type InternalReason =
  | "team_session" // signed in with an account of the team (ADMIN_EMAILS or the registry)
  | "internal_device" // a device the server marked (sign-in or link), verified by its signature
  | "device_hint"; // the browser says so (its PostHog mark), not verified: only ever excludes itself

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isDeviceId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Lower case, trimmed, and only something that looks like an address. */
export function normalizeEmail(v: unknown) {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return /^[^\s@]{1,100}@[^\s@]{1,100}\.[a-z]{2,}$/.test(e) ? e : null;
}

const sign = (id: string, secret: string) => createHmac("sha256", secret).update(`habita-device:v1:${id}`).digest("base64url");

/** `v1.<device uuid>.<signature>`: the browser can carry it, never forge it. */
export function deviceCookieValue(deviceId: string, secret: string) {
  if (!isDeviceId(deviceId) || secret.length < 32) throw new Error("INVALID_DEVICE_COOKIE");
  return `v1.${deviceId}.${sign(deviceId, secret)}`;
}

/** The device id of a valid cookie, or null (missing, malformed, or signed with another secret). */
export function readDeviceCookie(value: string | undefined | null, secret: string) {
  if (!value || secret.length < 32) return null;
  const [version, id, signature, extra] = value.split(".");
  if (version !== "v1" || extra !== undefined || !isDeviceId(id) || !signature) return null;
  const expected = Buffer.from(sign(id, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

/** One-time link tokens are stored only as their hash. */
export const linkHash = (token: string) => createHmac("sha256", "habita-device-link").update(token).digest("hex");
export const validLinkToken = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(v);

/** Who the request is, as far as the session goes. */
export type SessionKind =
  | { kind: "none" }
  | { kind: "internal"; userId: string; personId: string | null }
  | { kind: "external"; userId: string };

export type Classification = {
  internal: boolean;
  reason: InternalReason | null;
  personId: string | null;
  deviceId: string | null;
  /**
   * A signed-in account outside the team is using a browser that was marked
   * internal: the mark must go (cookie, PostHog flag and identity), so the
   * next person on this browser does not inherit it.
   */
  clearDevice: boolean;
};

/**
 * The verdict for one request. The session wins: an internal account is
 * internal anywhere; an external account is external even on a browser the
 * team used (and that browser stops being internal). Without a session, a
 * device the server marked and has not revoked is internal. The browser's
 * own hint only counts when nothing better is known, and only to exclude.
 */
export function classify(session: SessionKind, device: { id: string; status: DeviceStatus; personId: string | null } | null, hint = false): Classification {
  const deviceId = device?.id ?? null;
  if (session.kind === "internal") return { internal: true, reason: "team_session", personId: session.personId, deviceId, clearDevice: false };
  if (session.kind === "external")
    return { internal: false, reason: null, personId: null, deviceId, clearDevice: Boolean(device && device.status === "internal") || hint };
  if (device?.status === "internal") return { internal: true, reason: "internal_device", personId: device.personId, deviceId, clearDevice: false };
  if (device?.status === "revoked") return { internal: false, reason: null, personId: null, deviceId, clearDevice: true };
  if (hint) return { internal: true, reason: "device_hint", personId: null, deviceId, clearDevice: false };
  return { internal: false, reason: null, personId: null, deviceId, clearDevice: false };
}

/**
 * Team fingerprint: how long a network + device seen in an internal session
 * still recognizes a private window (no cookies) of the same device. Renewed
 * on every internal visit. Short on purpose: mobile carriers hand the same
 * IP to other people after a while.
 */
export const FINGERPRINT_HOURS = 72;

export type FingerprintInput = { ip: string | null; userAgent: string | null; screen: unknown; tz: unknown };

/** The client's address as Vercel reports it (first hop of x-forwarded-for). */
export function clientIp(headers: Headers) {
  const raw = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "";
  return /^[0-9a-f:.]{3,45}$/i.test(raw) ? raw.toLowerCase() : null;
}

const SCREEN = /^\d{3,5}x\d{3,5}@\d(\.\d{1,2})?$/;
const TZ = /^[A-Za-z_]{2,20}(\/[A-Za-z0-9_+-]{1,30}){0,2}$/;

/**
 * HMAC of IP + exact user agent + screen + time zone, or null when any part
 * is missing: the IP alone never classifies anybody. Two people on the same
 * carrier IP only collide with the same browser build, screen and zone.
 */
export function fingerprintHash(input: FingerprintInput, secret: string) {
  const ua = (input.userAgent ?? "").trim();
  const screen = typeof input.screen === "string" && SCREEN.test(input.screen) ? input.screen : null;
  const tz = typeof input.tz === "string" && TZ.test(input.tz) ? input.tz : null;
  if (!input.ip || ua.length < 20 || !screen || !tz || secret.length < 32) return null;
  return createHmac("sha256", secret).update(`habita-fp:v1|${input.ip}|${ua.slice(0, 400)}|${screen}|${tz}`).digest("hex");
}

/** Browser ids the server accepts as aliases of a device. */
export const validVisitorAlias = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v);
export const validPhDevice = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.:-]{8,80}$/.test(v);

/** Adds what is new, keeps the order, and caps the list (a device has a handful of ids). */
export function mergeAliases(current: readonly string[], add: readonly (string | null | undefined)[], max = 20) {
  const out = [...current];
  for (const v of add) if (v && !out.includes(v)) out.push(v);
  return out.slice(-max);
}

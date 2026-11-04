import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/commerce/http";
import { cloudConfigured } from "@/lib/supabase/config";
import { adminClient, currentUser } from "@/lib/supabase/server";
import {
  classify,
  DEVICE_COOKIE,
  DEVICE_MAX_AGE,
  deviceCookieValue,
  FINGERPRINT_HOURS,
  fingerprintHash,
  LINK_MINUTES,
  linkHash,
  mergeAliases,
  normalizeEmail,
  readDeviceCookie,
  validPhDevice,
  validVisitorAlias,
  type Classification,
  type DeviceStatus,
  type FingerprintInput,
  type SessionKind,
} from "./shared";

/**
 * The single server-side answer to "is this the team?", used by every place
 * that records or reports commercial activity (demo activity, lead events,
 * generations, claims, purchases, metrics). Registry: internal_people and
 * internal_identities (several Gmail per person, plus the stable user id),
 * on top of ADMIN_EMAILS, which are always internal. Read with a short cache
 * so a busy demo does not read it on every event.
 */

const CACHE_MS = 60_000;

type Registry = { emails: Map<string, string>; users: Map<string, string>; at: number };
let registry: Registry | null = null;
let deviceCache = new Map<string, { status: DeviceStatus; personId: string | null; at: number }>();

export function invalidateInternalCache() {
  registry = null;
  deviceCache = new Map();
}

/** Email → person and user id → person, of active people. Empty (only ADMIN_EMAILS) before the migration. */
async function loadRegistry(): Promise<Registry> {
  if (registry && Date.now() - registry.at < CACHE_MS) return registry;
  const emails = new Map<string, string>();
  const users = new Map<string, string>();
  try {
    const { data, error } = await adminClient()
      .from("internal_identities")
      .select("kind,value,person_id,internal_people!inner(active)")
      .eq("internal_people.active", true)
      .limit(2000);
    if (error) throw error;
    for (const r of (data ?? []) as { kind: string; value: string; person_id: string }[])
      (r.kind === "email" ? emails : users).set(r.value, r.person_id);
  } catch {
    // Pending migration or a failed read: ADMIN_EMAILS still decide; a stale cache is better than none.
    if (registry) return registry;
  }
  registry = { emails, users, at: Date.now() };
  return registry;
}

/** The person of an account, or undefined when it is not internal (null: internal by ADMIN_EMAILS only). */
export async function internalPersonOf(user: Pick<User, "id" | "email"> | null | undefined): Promise<string | null | undefined> {
  if (!user) return undefined;
  const reg = await loadRegistry();
  const email = normalizeEmail(user.email);
  const person = reg.users.get(user.id) ?? (email ? reg.emails.get(email) : undefined);
  if (person) return person;
  return isAdmin(user.email ?? undefined) ? null : undefined;
}

export async function isInternalUser(user: Pick<User, "id" | "email"> | null | undefined) {
  return (await internalPersonOf(user)) !== undefined;
}

/** By id alone (payments, claims): the registry's user ids and the accounts behind its e-mails. */
export async function isInternalUserId(userId: string) {
  const reg = await loadRegistry();
  if (reg.users.has(userId)) return true;
  try {
    const { data } = await adminClient().auth.admin.getUserById(userId);
    return (await internalPersonOf(data.user)) !== undefined;
  } catch {
    return false;
  }
}

/** Every account id of the team (SQL: habita_internal_user_ids). Empty before the migration. */
export async function internalUserIds() {
  try {
    const { data, error } = await adminClient().rpc("habita_internal_user_ids");
    if (error) throw error;
    return new Set(((data ?? []) as unknown[]).map((r) => (typeof r === "string" ? r : String(Object.values(r as object)[0]))));
  } catch {
    return new Set<string>();
  }
}

/** The secret that signs device cookies: its own variable, or derived from the service key. */
function deviceSecret() {
  const own = process.env.INTERNAL_DEVICE_SECRET?.trim();
  if (own && own.length >= 32) return own;
  const base = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return base ? createHash("sha256").update(`habita-internal-device:${base}`).digest("hex") : "";
}

async function deviceRow(id: string) {
  const hit = deviceCache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return { id, status: hit.status, personId: hit.personId };
  try {
    const { data } = await adminClient().from("internal_devices").select("status,person_id").eq("id", id).maybeSingle();
    const row = data as { status: DeviceStatus; person_id: string | null } | null;
    if (!row) return null;
    deviceCache.set(id, { status: row.status, personId: row.person_id, at: Date.now() });
    return { id, status: row.status, personId: row.person_id };
  } catch {
    return null;
  }
}

async function sessionKind(user: User | null): Promise<SessionKind> {
  if (!user || user.is_anonymous || !user.email_confirmed_at) return { kind: "none" };
  const person = await internalPersonOf(user);
  return person === undefined ? { kind: "external", userId: user.id } : { kind: "internal", userId: user.id, personId: person };
}

/**
 * Who is asking: the signed-in account first, then the signed device
 * cookie, then (only to exclude) the browser's own hint. Never throws:
 * without Supabase, everyone is external.
 */
export async function classifyRequest(opts: { hint?: boolean; user?: User | null } = {}): Promise<Classification & { session: SessionKind }> {
  const none = { ...classify({ kind: "none" }, null, Boolean(opts.hint)), session: { kind: "none" } as SessionKind };
  if (!cloudConfigured()) return none;
  try {
    const user = opts.user !== undefined ? opts.user : await currentUser().catch(() => null);
    const session = await sessionKind(user);
    const jar = await cookies();
    const id = readDeviceCookie(jar.get(DEVICE_COOKIE)?.value, deviceSecret());
    const device = id ? await deviceRow(id) : null;
    return { ...classify(session, device, Boolean(opts.hint)), session };
  } catch {
    return none;
  }
}

/** Shorthand for the routes that only need a yes or no. */
export async function internalRequest(hint = false) {
  const c = await classifyRequest({ hint });
  return { internal: c.internal, reason: c.reason };
}

const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: DEVICE_MAX_AGE };

/** Creates a device for a person and sets its cookie on this browser. */
export async function issueDevice(args: { personId: string | null; source: "login" | "link" | "manual" | "fingerprint"; label?: string | null; actor?: string | null }) {
  const secret = deviceSecret();
  if (!secret) throw new Error("INTERNAL_DEVICE_SECRET_MISSING");
  const { data, error } = await adminClient()
    .from("internal_devices")
    .insert({ person_id: args.personId, source: args.source, status: "internal", label: args.label?.slice(0, 120) ?? null, status_by: args.actor ?? null, status_reason: args.source })
    .select("id")
    .single();
  if (error || !data) throw new Error("INTERNAL_DEVICE_CREATE_FAILED");
  const id = (data as { id: string }).id;
  (await cookies()).set(DEVICE_COOKIE, deviceCookieValue(id, secret), cookieOptions);
  deviceCache.set(id, { status: "internal", personId: args.personId, at: Date.now() });
  return id;
}

/** Renews the cookie of an existing internal device (another year from now). */
export async function renewDeviceCookie(id: string) {
  const secret = deviceSecret();
  if (secret) (await cookies()).set(DEVICE_COOKIE, deviceCookieValue(id, secret), cookieOptions);
}

/** This browser stops being internal: the device is revoked (kept for audit) and the cookie goes. */
export async function forgetDevice(id: string | null, reason: string, actor: string | null = null) {
  if (id) await setDeviceStatus(id, "revoked", reason, actor).catch(() => undefined);
  (await cookies()).delete(DEVICE_COOKIE);
}

export async function setDeviceStatus(id: string, status: DeviceStatus, reason: string, actor: string | null) {
  const { error } = await adminClient()
    .from("internal_devices")
    .update({ status, status_at: new Date().toISOString(), status_reason: reason.slice(0, 60), status_by: actor })
    .eq("id", id);
  if (error) throw new Error("INTERNAL_DEVICE_UPDATE_FAILED");
  deviceCache.delete(id);
  // A device that stops being internal takes its network + device fingerprint with it,
  // so a private window on that same computer is not marked again.
  if (status !== "internal") await adminClient().from("internal_fingerprints").delete().eq("device_id", id);
}

/**
 * Records the browser ids this device uses (habita_visitante and PostHog's
 * $device_id). Returns the ids that are new, so the caller recalculates only
 * when something changed.
 */
export async function attachAliases(id: string, visitor: unknown, phDevice: unknown) {
  const v = validVisitorAlias(visitor) ? visitor : null;
  const p = validPhDevice(phDevice) ? phDevice : null;
  if (!v && !p) return [];
  const db = adminClient();
  const { data } = await db.from("internal_devices").select("visitor_ids,ph_device_ids").eq("id", id).maybeSingle();
  const row = data as { visitor_ids: string[]; ph_device_ids: string[] } | null;
  if (!row) return [];
  const visitors = mergeAliases(row.visitor_ids, [v]);
  const phs = mergeAliases(row.ph_device_ids, [p]);
  const fresh = [...visitors.filter((x) => !row.visitor_ids.includes(x)), ...phs.filter((x) => !row.ph_device_ids.includes(x)).map((x) => `ph:${x}`)];
  await db
    .from("internal_devices")
    .update({ visitor_ids: visitors, ph_device_ids: phs, last_seen_at: new Date().toISOString() })
    .eq("id", id);
  return fresh;
}

/** Stores the account's stable id next to its e-mail, so SQL reports know it without reading auth. */
export async function rememberUserId(personId: string, userId: string) {
  const reg = await loadRegistry();
  if (reg.users.has(userId)) return;
  await adminClient().from("internal_identities").upsert({ person_id: personId, kind: "user_id", value: userId }, { onConflict: "kind,value", ignoreDuplicates: true });
  registry = null;
}

/** A one-time link that marks another device of this person. Only its hash is stored. */
export async function createDeviceLink(personId: string, actor: string, origin: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + LINK_MINUTES * 60000).toISOString();
  const { error } = await adminClient().from("internal_device_links").insert({ token_hash: linkHash(token), person_id: personId, created_by: actor, expires_at: expires });
  if (error) throw new Error("INTERNAL_LINK_CREATE_FAILED");
  return { url: `${origin}/interno/vincular?t=${token}`, expires };
}

/** Uses a link: valid, unused and not expired. Marks this browser. Returns the device or null. */
export async function consumeDeviceLink(token: string, label: string | null) {
  const db = adminClient();
  const hash = linkHash(token);
  // The claim is the update itself: two browsers opening the same link cannot both win.
  const { data } = await db
    .from("internal_device_links")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", hash)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("person_id")
    .maybeSingle();
  const link = data as { person_id: string } | null;
  if (!link) return null;
  const id = await issueDevice({ personId: link.person_id, source: "link", label });
  await db.from("internal_device_links").update({ device_id: id }).eq("token_hash", hash);
  return id;
}

/** Remembers (or refreshes) the network + device of an internal visit. Best effort. */
export async function recordFingerprint(input: FingerprintInput, owner: { personId: string | null; deviceId: string | null }, label: string | null) {
  const hash = fingerprintHash(input, deviceSecret());
  if (!hash) return;
  const now = new Date();
  await adminClient()
    .from("internal_fingerprints")
    .upsert(
      {
        hash,
        person_id: owner.personId,
        device_id: owner.deviceId,
        label,
        last_seen_at: now.toISOString(),
        expires_at: new Date(now.getTime() + FINGERPRINT_HOURS * 3600000).toISOString(),
      },
      { onConflict: "hash" },
    );
}

/** The person whose recent internal visit had exactly this network + device, or undefined. */
export async function matchFingerprint(input: FingerprintInput): Promise<{ personId: string | null } | undefined> {
  const hash = fingerprintHash(input, deviceSecret());
  if (!hash) return undefined;
  const db = adminClient();
  const { data } = await db.from("internal_fingerprints").select("person_id,matches").eq("hash", hash).gt("expires_at", new Date().toISOString()).maybeSingle();
  const row = data as { person_id: string | null; matches: number } | null;
  if (!row) return undefined;
  await db.from("internal_fingerprints").update({ matches: row.matches + 1 }).eq("hash", hash);
  return { personId: row.person_id };
}

/** A short description of the browser for the admin list (never the full user agent). */
export function deviceLabel(userAgent: string | null) {
  const ua = userAgent ?? "";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Otro";
  const browser = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  return `${os} · ${browser}`;
}

/**
 * After the set of internal browsers changed: recalculates the lead scores
 * and the activity summary of the demos those ids touched (or all of them).
 * Best effort; the next recalculation fixes a failure.
 */
export async function recomputeAfterInternalChange(ids: string[] | "all") {
  const { recomputeAll, recomputeDemo, internalVisitorIds } = await import("@/lib/leads/server");
  const db = adminClient();
  if (ids === "all") {
    const leads = await recomputeAll();
    const { data } = await db.rpc("habita_recompute_demo_activity", { p_demo: null });
    return { ...leads, activity: Number(data) || 0 };
  }
  if (!ids.length) return { demos: 0, visitors: 0, activity: 0 };
  const visitors = ids.filter((i) => !i.startsWith("ph:"));
  const devices = ids.filter((i) => i.startsWith("ph:")).map((i) => i.slice(3));
  const demos = new Set<string>();
  const reads = [
    db.from("lead_events").select("demo_id").in("visitor_id", ids).limit(5000),
    devices.length ? db.from("lead_events").select("demo_id").in("ph_device_id", devices).limit(5000) : null,
    visitors.length ? db.from("demo_activity").select("demo_id").in("visitor", visitors).limit(5000) : null,
  ];
  for (const r of await Promise.all(reads.map((q) => q ?? Promise.resolve({ data: [] })))) for (const row of (r.data ?? []) as { demo_id: string }[]) demos.add(row.demo_id);
  const internal = await internalVisitorIds();
  let scored = 0;
  for (const id of demos) {
    scored += (await recomputeDemo(id, internal)).length;
    await db.rpc("habita_recompute_demo_activity", { p_demo: id });
  }
  return { demos: demos.size, visitors: scored, activity: demos.size };
}

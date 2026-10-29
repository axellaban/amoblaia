import { redactInvite } from "@/lib/agency/demo-invite";

const INVITE = /[?&#]codigo=/i;

/**
 * Replaces the private invitation code in every string of an analytics
 * payload, however deep: event properties, person properties and the session
 * replay ($snapshot), whose page URL and link hrefs are nested inside. Edits
 * in place (a replay batch can be large) and returns the same value.
 */
export function redactDeep<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === "string") return (INVITE.test(value) ? redactInvite(value) : value) as T;
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = redactDeep(value[i], seen);
    return value;
  }
  const bag = value as Record<string, unknown>;
  for (const key of Object.keys(bag)) bag[key] = redactDeep(bag[key], seen);
  return value;
}

/** Browsers of the habita team: their sessions stay out of the commercial funnel. */
export const INTERNAL_PROPERTY = "habita_internal";

/** `?interno=1` marks a test device (a phone, an incognito window) as the team's; `?interno=0` clears it. */
export function internalFlagFromUrl(search: string): boolean | null {
  const value = new URLSearchParams(search).get("interno");
  return value === "1" ? true : value === "0" ? false : null;
}

/** The deployment the event came from, so an error is tied to a release. */
export function releaseProperties(env: Record<string, string | undefined>) {
  const sha = env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
  return {
    ...(sha ? { app_version: sha.slice(0, 7) } : {}),
    app_env: env.NEXT_PUBLIC_VERCEL_ENV || "local",
  };
}

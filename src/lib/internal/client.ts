import posthog from "posthog-js";
import { visitorId } from "@/lib/demos/activity-client";

/**
 * The browser side of the internal-traffic classification. The server
 * decides (/api/interno/estado); this module only applies the verdict:
 * - internal: every PostHog event carries is_internal (super property, and
 *   synchronously in before_send so even the first page view does), and the
 *   person gets is_internal for the cohort. A local hint remembers it, so the
 *   next page load is marked before the server answers.
 * - reset (an account outside the team signed in on a browser the team used,
 *   or the team revoked this device): the hint and the flags go, and PostHog
 *   starts a new anonymous identity, so the next person never inherits the
 *   team's person. The team's person keeps is_internal (its history stays out).
 * Never receives nor stores who the person is. Best effort: nothing here can
 * break a page.
 */

export const HINT_KEY = "habita_internal";
const SET_KEY = "habita_internal_set";
const PARAM = "habita_interno";
const TIMEOUT_MS = 2500;

/** The local mark (synchronous): used by before_send and by the demo reports. */
export function internalHint() {
  try {
    return Boolean(localStorage.getItem(HINT_KEY));
  } catch {
    return false;
  }
}

function posthogReady() {
  try {
    return Boolean(posthog.__loaded);
  } catch {
    return false;
  }
}

/** Flags this browser as the team's: local hint, every event, and (once per tab session) the person. */
export function markInternal(reason: string) {
  try {
    localStorage.setItem(HINT_KEY, reason.slice(0, 40));
  } catch {
    /* Blocked storage: the server cookie still classifies the requests. */
  }
  if (!posthogReady()) return;
  try {
    posthog.register({ is_internal: true, internal_reason: reason.slice(0, 40) });
    // One $set per tab session is enough for the cohort; repeating it every page adds nothing.
    let done = false;
    try {
      done = sessionStorage.getItem(SET_KEY) === "1";
      sessionStorage.setItem(SET_KEY, "1");
    } catch {
      /* Without sessionStorage it is sent each time; harmless. */
    }
    if (!done) posthog.setPersonProperties({ is_internal: true }, { first_internal_at: new Date().toISOString() });
  } catch {
    /* Tracking is best effort. */
  }
}

/**
 * Drops the mark. `newIdentity` (another account on this browser, or a
 * revoked device) also gives PostHog a fresh anonymous id, so the internal
 * person keeps its flag and the new one starts clean.
 */
export function clearInternal(newIdentity: boolean) {
  try {
    localStorage.removeItem(HINT_KEY);
    sessionStorage.removeItem(SET_KEY);
  } catch {
    /* Nothing stored. */
  }
  if (!posthogReady()) return;
  try {
    posthog.unregister("is_internal");
    posthog.unregister("internal_reason");
    if (newIdentity) {
      const keep = { app_env: process.env.NEXT_PUBLIC_VERCEL_ENV || "local", tracking_version: 2 };
      posthog.reset();
      posthog.register(keep);
    }
  } catch {
    /* Tracking is best effort. */
  }
}

let pending: Promise<boolean> | null = null;

function screenOf() {
  try {
    return `${Math.round(window.screen.width)}x${Math.round(window.screen.height)}@${Math.round((window.devicePixelRatio || 1) * 100) / 100}`;
  } catch {
    return undefined;
  }
}

function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

async function ask(forget = false): Promise<boolean> {
  let device: string | undefined;
  try {
    if (posthogReady()) device = (posthog.get_property?.("$device_id") as string | undefined) || undefined;
  } catch {
    /* No PostHog: the server still classifies. */
  }
  const hint = internalHint();
  const r = await fetch("/api/interno/estado", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor: visitorId(), device, hint, forget, screen: screenOf(), tz: timeZone() }),
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!r.ok) return hint;
  const data = (await r.json()) as { internal?: boolean; reason?: string | null; reset?: boolean };
  if (data.reset) clearInternal(true);
  if (data.internal) markInternal(data.reason || "internal");
  return Boolean(data.internal);
}

/**
 * Asks the server once per page load (and applies the answer). The demo
 * reports wait for it (up to 2.5 s) so a private window of the team is
 * recognized before its first visit is counted.
 */
export function syncInternal(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (pending) return pending;
  let forget = false;
  try {
    // ?habita_interno=0 unmarks this browser (the old manual mark). Marking is only done by the server now.
    const url = new URL(window.location.href);
    if (url.searchParams.get(PARAM) === "0") {
      forget = true;
      url.searchParams.delete(PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  } catch {
    /* Keep going. */
  }
  pending = ask(forget).catch(() => internalHint());
  return pending;
}

/** The verdict for reports that must not count the team: waits a moment for the server, else uses the hint. */
export function internalReady(): Promise<boolean> {
  const fallback = new Promise<boolean>((resolve) => window.setTimeout(() => resolve(internalHint()), TIMEOUT_MS));
  return Promise.race([syncInternal(), fallback]);
}

/** «Dejar de marcar este dispositivo» on /interno. */
export async function forgetThisDevice() {
  pending = null;
  pending = ask(true).catch(() => false);
  return pending;
}

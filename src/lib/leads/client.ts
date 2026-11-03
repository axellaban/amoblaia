import posthog from "posthog-js";
import { visitorId } from "@/lib/demos/activity-client";
import { DEMO_REF_KEY } from "@/lib/demos/shared";
import type { LeadEventName } from "./config";

/**
 * The browser side of the Lead Engagement Score. The public demo page starts
 * it (startLeadTracking) and the deliberate actions call leadEvent; events
 * wait a moment and leave together, by beacon when the page hides or is left.
 * Each event has its own random id, so a repeated delivery is stored once.
 * Best effort: nothing here can break or slow the page.
 */

type Pending = { id: string; name: LeadEventName; at: string; style?: string; photo?: string; value?: number };
type Context = { token: string; link: string; view: string; active: number };

const FLUSH_MS = 4000;
const INTERNAL_KEY = "habita_internal";
let ctx: Context | null = null;
let queue: Pending[] = [];
let timer: number | null = null;
let listening = false;

const uid = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }
};

function envelope(link: string) {
  let internal = false;
  try {
    internal = Boolean(localStorage.getItem(INTERNAL_KEY));
  } catch {
    /* Blocked storage. */
  }
  let session: string | undefined;
  let device: string | undefined;
  try {
    if (posthog.__loaded) {
      session = posthog.get_session_id?.() || undefined;
      device = (posthog.get_property?.("$device_id") as string | undefined) || undefined;
    }
  } catch {
    /* PostHog blocked or not loaded: the events still count. */
  }
  return {
    visitor: visitorId(),
    session,
    device,
    link,
    internal,
    automation: typeof navigator !== "undefined" && navigator.webdriver === true,
  };
}

function send(token: string, body: object, beacon: boolean) {
  const url = `/api/demo/${encodeURIComponent(token)}/leads`;
  const json = JSON.stringify(body);
  try {
    if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon?.(url, new Blob([json], { type: "application/json" }))) return;
  } catch {
    /* Fall back to fetch. */
  }
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: json, keepalive: true }).catch(() => undefined);
}

/** Sends what is waiting. `beacon` when the page is hiding or being left. */
export function flushLeads(beacon = false) {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (!ctx || !queue.length) return;
  const events = queue.slice(0, 50);
  queue = queue.slice(50);
  send(ctx.token, { ...envelope(ctx.link), view: ctx.view, events }, beacon);
  if (queue.length) flushLeads(beacon);
}

const onHide = () => {
  if (document.visibilityState === "hidden") flushLeads(true);
};
const onPageHide = () => flushLeads(true);

/** Starts a page view of a public demo. Returns the function that ends it. */
export function startLeadTracking(token: string, link: string) {
  if (typeof window === "undefined") return () => undefined;
  flushLeads(true);
  ctx = { token, link: link.slice(0, 40), view: uid(), active: 0 };
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
  }
  const mine = ctx;
  return () => {
    flushLeads(true);
    // Other cleanups of the same page (the active-time timer) still report right after this one.
    window.setTimeout(() => {
      if (ctx !== mine) return;
      flushLeads(true);
      ctx = null;
    }, 0);
  };
}

/** One deliberate action of the visitor on the demo. Does nothing outside a public demo. */
export function leadEvent(name: LeadEventName, extra: { style?: string; photo?: string } = {}) {
  if (!ctx) return;
  queue.push({ id: uid(), name, at: new Date().toISOString(), ...extra });
  if (timer === null) timer = window.setTimeout(() => flushLeads(false), FLUSH_MS);
}

/**
 * Active time of this page view, added up piece by piece and always sent as
 * the running total of the view (one row per view on the server), so a
 * report that arrives twice or late never counts the same seconds again.
 */
export function leadActiveTime(ms: number) {
  if (!ctx || !(ms > 0)) return;
  ctx.active += ms;
  queue = queue.filter((e) => e.name !== "demo_active_time");
  queue.push({ id: uid(), name: "demo_active_time", at: new Date().toISOString(), value: Math.round(ctx.active) });
  // Pieces arrive when the tab hides or the page is left: send now, while the page is alive.
  flushLeads(true);
}

type DemoRef = { demoId?: string; token?: string; link?: string; at?: number };
const REF_DAYS = 60;

/**
 * An action outside the demo (the sign-up, the agency's panel) credited to
 * the demo this browser last opened, within 60 days. The server only takes
 * the activation steps from a signed-in member of that demo's agency.
 */
export function leadFromDemoRef(name: LeadEventName, extra: { property?: string } = {}) {
  try {
    const ref = JSON.parse(localStorage.getItem(DEMO_REF_KEY) || "null") as DemoRef | null;
    if (!ref?.token || !ref.at || Date.now() - ref.at > REF_DAYS * 86400000) return;
    const event = { id: uid(), name, at: new Date().toISOString(), ...extra };
    fetch(`/api/demo/${encodeURIComponent(ref.token)}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...envelope(ref.link ?? ""), events: [event] }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* Best effort. */
  }
}

import posthog from "posthog-js";
import { registerSuperProperties, track, type EventProperties } from "@/lib/analytics";

/**
 * Behavior telemetry on top of the product events of analytics.ts, for the
 * demos the team sends to agencies and what follows them (sign-up, panel,
 * first import and generation). Privacy first: it never reads form values,
 * typed text, invitation codes or raw links; elements say what they are with
 * data attributes (see `cta`), never by their label. Continuous movements
 * (the comparison slider, scrolling) are summarized, never sent one by one.
 * PostHog adds the visitor (distinct_id), $session_id, $device_type and the
 * recording link to every event; demo_id and the agency travel as super
 * properties registered by the demo page.
 */

/** Where the click was: one value per area of the product, for every event of this module. */
export function surfaceOf(pathname: string) {
  if (pathname.startsWith("/demo/")) return "demo";
  if (/^\/inmobiliaria\/[^/]+\/[^/]+/.test(pathname)) return "agency_site_property";
  if (pathname.startsWith("/inmobiliaria/")) return "agency_site";
  if (pathname.startsWith("/panel/empezar")) return "signup";
  if (pathname.startsWith("/panel")) return "panel";
  if (pathname.startsWith("/precios")) return "pricing";
  if (pathname.startsWith("/acceso")) return "auth";
  return "other";
}

export type CtaKind = "habita_b2b" | "buyer_contact" | "navigation" | "content";
type CtaExtra = { photo?: string; style?: string; plan?: string; intent?: string };

/**
 * Data attributes that make an element a tracked call to action: one
 * `cta_clicked` per click with its id, place and logical destination. They
 * change nothing on screen. `kind` separates habita's own commercial actions
 * (habita_b2b) from the agency's buyers contacting it (buyer_contact).
 */
export function cta(id: string, location: string, destination: string, kind: CtaKind = "habita_b2b", extra: CtaExtra = {}) {
  return {
    "data-cta": id,
    "data-cta-location": location,
    "data-cta-destination": destination,
    "data-cta-kind": kind,
    ...(extra.photo ? { "data-cta-photo": extra.photo } : {}),
    ...(extra.style ? { "data-cta-style": extra.style } : {}),
    ...(extra.plan ? { "data-cta-plan": extra.plan } : {}),
    ...(extra.intent ? { "data-cta-intent": extra.intent } : {}),
  };
}

/** The properties of one click on a `cta` element, read only from its data attributes. */
export function ctaProperties(el: HTMLElement, pathname: string): EventProperties {
  const d = el.dataset;
  const clip = (v: string | undefined, n = 80) => (v ? v.slice(0, n) : undefined);
  const props: EventProperties = {
    cta_id: clip(d.cta) ?? "unknown",
    cta_location: clip(d.ctaLocation) ?? "unknown",
    cta_destination: clip(d.ctaDestination) ?? "unknown",
    cta_kind: clip(d.ctaKind) ?? "habita_b2b",
    surface: surfaceOf(pathname),
  };
  if (d.ctaPhoto) props.photo_id = clip(d.ctaPhoto)!;
  if (d.ctaStyle) props.style_id = clip(d.ctaStyle)!;
  if (d.ctaPlan) props.plan = clip(d.ctaPlan)!;
  if (d.ctaIntent) props.cta_intent = clip(d.ctaIntent)!;
  return props;
}

/** A click that leaves the page: sent at once so the navigation does not drop it. */
const leavesPage = (el: HTMLElement) => {
  if (!(el instanceof HTMLAnchorElement)) return el.dataset.ctaNavigates === "1";
  const href = el.getAttribute("href") ?? "";
  return Boolean(href) && !href.startsWith("#") && el.target !== "_blank" && !el.hasAttribute("download");
};

/**
 * Fired when a click is about to take the visitor to another page in the
 * same tab. PostHog's own exit beacon (pagehide) is compressed
 * asynchronously and does not survive a same-tab navigation, so the timers
 * report here, while the page is still alive.
 */
const LEAVING = "habita:leaving";

const INTERNAL_KEY = "habita_internal";
const INTERNAL_PARAM = "habita_interno";

/**
 * The team's own traffic (admin pages, its previews, or a device marked with
 * ?habita_interno=1) carries is_internal on every event and on the person,
 * so the commercial dashboards can leave it out. ?habita_interno=0 unmarks it.
 */
export function markInternal(reason: string) {
  try {
    localStorage.setItem(INTERNAL_KEY, reason.slice(0, 40));
  } catch {
    /* Blocked storage: this page load is still marked. */
  }
  try {
    if (!posthog.__loaded) return;
    posthog.register({ is_internal: true });
    posthog.setPersonProperties({ is_internal: true });
  } catch {
    /* Tracking is best effort. */
  }
}

function applyInternal() {
  let flagged: string | null = null;
  try {
    const param = new URLSearchParams(window.location.search).get(INTERNAL_PARAM);
    if (param === "0") {
      localStorage.removeItem(INTERNAL_KEY);
      posthog.unregister("is_internal");
      posthog.setPersonProperties({ is_internal: false });
      return;
    }
    if (param === "1") localStorage.setItem(INTERNAL_KEY, "manual");
    flagged = localStorage.getItem(INTERNAL_KEY);
  } catch {
    /* Blocked storage: nothing to read. */
  }
  if (flagged) markInternal(flagged);
}

/** Installed once, from instrumentation-client.ts, after PostHog starts. */
export function installInteractionTracking(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __habitaTracking?: boolean };
  if (w.__habitaTracking || !posthog.__loaded) return;
  w.__habitaTracking = true;
  registerSuperProperties({
    app_env: process.env.NEXT_PUBLIC_VERCEL_ENV || "local",
    tracking_version: 2,
  });
  applyInternal();
  // Capture phase: runs before the element's own handler and before a navigation starts.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest<HTMLElement>("[data-cta]");
      if (!el || el.matches(":disabled,[aria-disabled='true']")) return;
      const leaving = leavesPage(el);
      track("cta_clicked", ctaProperties(el, window.location.pathname), leaving);
      if (leaving) window.dispatchEvent(new Event(LEAVING));
    },
    { capture: true },
  );
}

/** Rounded 0–100, the way positions are reported. */
const pct = (n: number) => Math.round(Math.min(100, Math.max(0, n)));

export type SliderInput = "mouse" | "touch" | "pen" | "keyboard";

/**
 * One gesture on the before/after slider, from the moment it starts until it
 * is released (or, with the keyboard, until the keys stop for a moment): one
 * event with where it started and ended, how far it went and how long it took.
 */
export class SliderGesture {
  private min: number;
  private max: number;
  private last: number;
  private travel = 0;
  readonly startedAt: number;
  constructor(
    readonly input: SliderInput,
    readonly start: number,
    now = Date.now(),
  ) {
    this.min = this.max = this.last = start;
    this.startedAt = now;
  }
  move(position: number) {
    this.travel += Math.abs(position - this.last);
    this.last = position;
    this.min = Math.min(this.min, position);
    this.max = Math.max(this.max, position);
  }
  /** The summary, or null when nothing moved (a vertical swipe the browser took for scrolling). */
  end(now = Date.now()): EventProperties | null {
    if (this.travel < 1 && this.input !== "keyboard") return null;
    return {
      input: this.input,
      start_position: pct(this.start),
      end_position: pct(this.last),
      min_position: pct(this.min),
      max_position: pct(this.max),
      // Total distance moved, in slider percent: a back-and-forth comparison goes past 100.
      travel: Math.round(this.travel),
      duration_ms: Math.min(now - this.startedAt, 600000),
    };
  }
}

/** Slider gestures in this page load: tells the first one from the rest. */
let sliderUses = 0;
export function reportSlider(summary: EventProperties, context: EventProperties) {
  sliderUses += 1;
  track("comparison_slider_used", { ...context, ...summary, interaction_index: sliderUses, surface: surfaceOf(window.location.pathname) });
}

/**
 * Time on screen of one thing (a photo in a style): counts only while the
 * tab is visible, and reports when it changes, the tab hides or the page is
 * left. Shorter than `minMs`, it was only passed by.
 */
export class ViewTimer {
  private key = "";
  private props: EventProperties = {};
  private visibleMs = 0;
  private since: number | null = null;
  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") this.flush("hidden", true, true);
    else if (this.key && this.since === null) this.since = Date.now();
  };
  private readonly onPageHide = () => this.flush("pagehide", true, true);
  private readonly onLeaving = () => this.flush("navigation", true, true);
  constructor(
    private readonly event: string,
    private readonly minMs = 1000,
  ) {
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener(LEAVING, this.onLeaving);
  }
  show(key: string, props: EventProperties) {
    if (key === this.key) return;
    this.flush("change");
    this.key = key;
    this.props = props;
    this.visibleMs = 0;
    this.since = document.visibilityState === "visible" ? Date.now() : null;
  }
  /** `keep` leaves the same thing on screen, counting again when the tab comes back. */
  private flush(reason: string, beacon = false, keep = false) {
    if (!this.key) return;
    const total = this.visibleMs + (this.since === null ? 0 : Date.now() - this.since);
    if (total >= this.minMs) track(this.event, { ...this.props, duration_ms: Math.min(total, 3600000), end_reason: reason }, beacon);
    this.visibleMs = 0;
    this.since = null;
    if (!keep) this.key = "";
  }
  dispose() {
    this.flush("unmount");
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener(LEAVING, this.onLeaving);
  }
}

const IDLE_MS = 30000;
const TICK_MS = 5000;

/**
 * Active time on a demo: visible and touched in the last 30 s. Reported in
 * pieces (each time the tab hides or the page is left), so the visit's total
 * is the sum of its demo_active_time events, and the deepest scroll reached.
 * Returns the function that stops it.
 */
export function startDemoEngagement(context: EventProperties) {
  let lastInput = Date.now();
  let lastTick = Date.now();
  let activeMs = 0;
  let visibleMs = 0;
  let maxScroll = 0;
  let scrollQueued = false;
  const tick = () => {
    const now = Date.now();
    if (document.visibilityState === "visible") {
      const span = now - lastTick;
      visibleMs += span;
      if (now - lastInput < IDLE_MS) activeMs += span;
    }
    lastTick = now;
  };
  const onInput = () => {
    tick();
    lastInput = Date.now();
  };
  const onScroll = () => {
    onInput();
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      const doc = document.documentElement;
      const reach = (window.scrollY + window.innerHeight) / Math.max(1, doc.scrollHeight);
      maxScroll = Math.max(maxScroll, pct(reach * 100));
    });
  };
  const flush = (reason: string) => {
    tick();
    if (visibleMs >= 1000)
      track(
        "demo_active_time",
        { ...context, active_ms: Math.min(activeMs, 3600000), visible_ms: Math.min(visibleMs, 3600000), max_scroll_pct: maxScroll, end_reason: reason },
        true,
      );
    activeMs = 0;
    visibleMs = 0;
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush("hidden");
    else {
      lastTick = Date.now();
      lastInput = Date.now();
    }
  };
  const onPageHide = () => flush("pagehide");
  const onLeaving = () => flush("navigation");
  const timer = window.setInterval(tick, TICK_MS);
  const inputs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
  for (const e of inputs) window.addEventListener(e, onInput, { passive: true, capture: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener(LEAVING, onLeaving);
  return () => {
    flush("unmount");
    window.clearInterval(timer);
    for (const e of inputs) window.removeEventListener(e, onInput, { capture: true });
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener(LEAVING, onLeaving);
  };
}

import posthog from "posthog-js";
import { registerSuperProperties, track as sendTrack, type EventProperties } from "@/lib/analytics";
import { leadEvent } from "@/lib/leads/client";
import { routeOf, surfaceOf } from "@/lib/tracking-routes";

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

export { routeOf, surfaceOf } from "@/lib/tracking-routes";

export type CtaKind = "habita_b2b" | "buyer_contact" | "navigation" | "content" | "product_action";
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

/** Not sent at all: the team's own admin. */
const UNTRACKED_SURFACES = new Set(["admin"]);

/** Interactive elements whose clicks count, when they are not a `cta`. */
const CLICKABLE =
  "a[href],button,summary,[role=button],[role=tab],[role=menuitem],[role=menuitemradio],[role=option],[role=switch],[role=link],input[type=checkbox],input[type=radio],input[type=file],input[type=submit],input[type=range]";

/** Texts that may be personal (an e-mail, a phone, an address number) never leave the browser. */
export function cleanLabel(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const t = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\s@]+@[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, "[número]")
    .replace(/https?:\/\/\S+/g, "[enlace]");
  return t ? t.slice(0, 60) : undefined;
}

function elementKind(el: HTMLElement): string {
  const role = el.getAttribute("role");
  if (role) return role;
  if (el instanceof HTMLAnchorElement) return "link";
  if (el instanceof HTMLInputElement) return el.type;
  return el.tagName.toLowerCase();
}

/** The named area of the screen a click happened in: `area()` first, then the landmark around it. */
function areaOf(el: Element): string {
  const named = el.closest<HTMLElement>("[data-track-area]");
  if (named?.dataset.trackArea) return named.dataset.trackArea.slice(0, 60);
  const landmark = el.closest("dialog,[role=dialog],header,nav,aside,footer,form,main");
  if (!landmark) return "page";
  return landmark.getAttribute("role") === "dialog" ? "dialog" : landmark.tagName.toLowerCase();
}

/** Where a link goes, as a kind and, for pages of the app, its route template. */
export function linkTarget(href: string, base: string): { href_kind: string; ui_destination?: string } {
  if (href.startsWith("#")) return { href_kind: "anchor", ui_destination: href.slice(0, 40) };
  if (/^mailto:/i.test(href)) return { href_kind: "email" };
  if (/^tel:/i.test(href)) return { href_kind: "phone" };
  try {
    const url = new URL(href, base);
    if (/(^|\.)(wa\.me|whatsapp\.com)$/i.test(url.hostname)) return { href_kind: "whatsapp" };
    if (url.origin === new URL(base).origin) return { href_kind: "internal", ui_destination: routeOf(url.pathname) };
    return { href_kind: "external", ui_destination: url.hostname.slice(0, 60) };
  } catch {
    return { href_kind: "unknown" };
  }
}

/**
 * One click on anything interactive that is not a `cta`: what it was
 * (`ui_element`), its stable name when it has one (`uiId()`), its visible
 * label cleaned of anything personal, the area of the screen and, for a
 * link, where it goes. Together with `cta_clicked` it answers «where do they
 * click» on every screen; elements inside `[data-track-private]` or
 * `.ph-no-capture` send no label.
 */
export function uiClickProperties(el: HTMLElement, pathname: string, base = "https://habita.local/"): EventProperties {
  const props: EventProperties = {
    ui_element: elementKind(el),
    ui_area: areaOf(el),
    surface: surfaceOf(pathname),
  };
  const name = el.dataset.track;
  if (name) props.ui_id = name.slice(0, 80);
  const privateLabel = el.closest("[data-track-private],.ph-no-capture,input[type=password]");
  if (!privateLabel) {
    // An input has no text of its own: its <label> says what it is.
    const text = el instanceof HTMLInputElement ? el.labels?.[0]?.textContent : el.textContent;
    const label = cleanLabel(el.getAttribute("aria-label") || el.getAttribute("title") || text);
    if (label) props.ui_label = label;
  }
  if (el instanceof HTMLAnchorElement) {
    const href = el.getAttribute("href");
    if (href) Object.assign(props, linkTarget(href, base));
    if (el.target === "_blank") props.new_tab = true;
  }
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) props.checked = el.checked;
  if (el.closest("dialog,[role=dialog]")) props.in_dialog = true;
  return props;
}

/** A stable name for an element that is not a `cta` (a filter, a tab, a menu item): sent as `ui_id`. */
export const uiId = (id: string) => ({ "data-track": id });

/**
 * A named area of a screen (`ui_area` on every click inside it). With
 * `viewed`, it also sends `section_viewed` the first time a third of it
 * (or half the screen) shows in this page load: how far down a demo people get.
 */
export function area(name: string, viewed = false) {
  return {
    "data-track-area": name,
    ...(viewed ? { ref: sectionRef(name) } : {}),
  };
}

const seenSections = new Set<string>();
const sectionRefs = new Map<string, (el: HTMLElement | null) => (() => void) | undefined>();
/** One ref per section name, so a re-render does not observe it again. */
function sectionRef(name: string) {
  const known = sectionRefs.get(name);
  if (known) return known;
  const ref = (el: HTMLElement | null) => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const key = () => `${window.location.pathname}|${name}`;
    if (seenSections.has(key())) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // A third of it, or half the screen for a section taller than three screens.
        if (!entries.some((e) => e.isIntersecting && (e.intersectionRatio >= 0.33 || e.intersectionRect.height >= window.innerHeight * 0.5))) return;
        observer.disconnect();
        if (seenSections.has(key())) return;
        seenSections.add(key());
        sendTrack("section_viewed", { section: name, surface: surfaceOf(window.location.pathname) });
      },
      { threshold: [0, 0.1, 0.2, 0.33] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  };
  sectionRefs.set(name, ref);
  return ref;
}

/** A stable name for a form, sent as `form_id` of `form_submitted`. */
export const formId = (id: string) => ({ "data-track-form": id });

/** The name of a form for `form_submitted`: `formId()`, its aria-label or the area it sits in. */
function formName(form: HTMLFormElement) {
  return (form.dataset.trackForm || form.getAttribute("aria-label") || form.getAttribute("name") || areaOf(form)).slice(0, 60);
}

const lastClick: { node: Element | null; at: number } = { node: null, at: 0 };

/** Installed once, from instrumentation-client.ts, after PostHog starts. */
export function installInteractionTracking(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __habitaTracking?: boolean };
  if (w.__habitaTracking || !posthog.__loaded) return;
  w.__habitaTracking = true;
  registerSuperProperties({
    app_env: process.env.NEXT_PUBLIC_VERCEL_ENV || "local",
    tracking_version: 3,
    product: "habita",
  });
  applyInternal();
  // Capture phase: runs before the element's own handler and before a navigation starts.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const pathname = window.location.pathname;
      if (UNTRACKED_SURFACES.has(surfaceOf(pathname))) return;
      const el = target.closest<HTMLElement>(`[data-cta],${CLICKABLE}`);
      if (!el || el.matches(":disabled,[aria-disabled='true']")) return;
      // A cta keeps its own event (the funnels use it); anything else is a ui_clicked.
      const ctaEl = el.closest<HTMLElement>("[data-cta]");
      // A <label> passes its click on to its input: one click, counted once.
      const node = ctaEl ?? el;
      const now = Date.now();
      if (node === lastClick.node && now - lastClick.at < 300) return;
      lastClick.node = node;
      lastClick.at = now;
      const leaving = leavesPage(node);
      if (ctaEl) sendTrack("cta_clicked", ctaProperties(ctaEl, pathname), leaving);
      else sendTrack("ui_clicked", uiClickProperties(el, pathname, window.location.href), leaving);
      if (leaving) window.dispatchEvent(new Event(LEAVING));
    },
    { capture: true },
  );
  // Which forms are sent, by name, never with what was written in them.
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const pathname = window.location.pathname;
      if (UNTRACKED_SURFACES.has(surfaceOf(pathname))) return;
      sendTrack("form_submitted", {
        form_id: formName(form),
        ui_area: areaOf(form),
        fields: form.querySelectorAll("input:not([type=hidden]),select,textarea").length,
        surface: surfaceOf(pathname),
      });
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
  // Lead score: a real gesture on the slider (only inside a public demo; elsewhere it does nothing).
  leadEvent("demo_comparison_used", {
    ...(typeof context.photo_id === "string" ? { photo: context.photo_id } : {}),
    ...(typeof context.style_id === "string" ? { style: context.style_id } : {}),
  });
  sendTrack("comparison_slider_used", { ...context, ...summary, interaction_index: sliderUses, surface: surfaceOf(window.location.pathname) });
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
    if (total >= this.minMs) sendTrack(this.event, { ...this.props, duration_ms: Math.min(total, 3600000), end_reason: reason }, beacon);
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
export function startDemoEngagement(context: EventProperties, onActive?: (activeMs: number) => void) {
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
    // The lead score adds up the same active time, piece by piece.
    if (activeMs > 0) onActive?.(Math.min(activeMs, 3600000));
    if (visibleMs >= 1000)
      sendTrack(
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

import posthog from "posthog-js";

/**
 * Privacy-safe, delegated interaction telemetry for public /demo/ pages.
 * Uses no form values, invitation codes, raw hrefs or free-form user text.
 * Semantic data attributes take precedence over heuristic classification.
 */
export function installDemoInteractionTracking(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __habitaDemoTracking?: boolean };
  if (w.__habitaDemoTracking) return;
  w.__habitaDemoTracking = true;

  const getDemo = () => {
    const parts = window.location.pathname.split("/");
    return parts[1] === "demo" && !!parts[2] ? parts[2] : null;
  };
  const capture = (name: string, extra: Record<string, string | number | boolean> = {}) => {
    const demo_slug = getDemo();
    if (!demo_slug || !posthog.__loaded) return;
    posthog.capture(name, { demo_slug, ...extra });
  };
  const classify = (el: HTMLElement): string => {
    const explicit = el.dataset.analyticsAction;
    if (explicit) return explicit.slice(0, 80);
    const href = el instanceof HTMLAnchorElement ? new URL(el.href).pathname : "";
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim().toLowerCase().slice(0, 100);
    if (/cr[eé]dit/.test(label + href)) return "credits";
    if (/precio|plan|suscri/.test(label + href)) return "pricing";
    if (/import|propiedad|publicaci[oó]n/.test(label + href)) return "import_property";
    if (/panel|inmobiliaria|registr|comenz|empez/.test(label + href)) return "agency_panel";
    if (/descarg/.test(label)) return "download";
    if (/contact|whatsapp/.test(label)) return "contact";
    if (/original/.test(label)) return "original_photo";
    if (/estilo|style/.test(label)) return "style";
    return "other";
  };
  const location = (el: HTMLElement): string =>
    el.closest("header") ? "header" : el.closest("footer") ? "footer" :
    el.closest("[data-analytics-location]")?.getAttribute("data-analytics-location")?.slice(0, 60) || "content";
  const onClick = (event: MouseEvent) => {
    if (!getDemo()) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest<HTMLElement>("a,button,[role='button'],[data-analytics-action]");
    if (!el || el.closest("[data-analytics-ignore]")) return;
    const action = classify(el);
    capture("demo_interaction_clicked", {
      action, location: location(el),
      element: el.tagName.toLowerCase(),
      explicit_tag: !!el.dataset.analyticsAction,
    });
    if (action !== "other") capture("demo_cta_detail_clicked", {
      cta_id: action, cta_location: location(el),
    });
  };
  document.addEventListener("click", onClick, { capture: true });

  // Record completed slider gestures, never every movement.
  const starts = new WeakMap<HTMLElement, { at: number; value: number | null }>();
  const slider = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>("[data-analytics-slider],input[type='range'],[role='slider']") : null;
  const value = (el: HTMLElement): number | null => {
    const raw = el instanceof HTMLInputElement ? el.value : el.getAttribute("aria-valuenow");
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const begin = (event: Event) => {
    if (!getDemo()) return;
    const el = slider(event.target);
    if (el && !starts.has(el)) starts.set(el, { at: Date.now(), value: value(el) });
  };
  const end = (event: Event) => {
    if (!getDemo()) return;
    const el = slider(event.target);
    if (!el) return;
    const start = starts.get(el);
    if (!start) return;
    starts.delete(el);
    const endValue = value(el);
    capture("demo_slider_used", {
      slider_id: el.dataset.analyticsSlider || "comparison",
      duration_ms: Math.min(Date.now() - start.at, 600000),
      ...(start.value === null ? {} : { start_value: start.value }),
      ...(endValue === null ? {} : { end_value: endValue }),
    });
  };
  document.addEventListener("pointerdown", begin, true);
  document.addEventListener("pointerup", end, true);
  document.addEventListener("pointercancel", end, true);
  document.addEventListener("keydown", (event) => {
    if (!getDemo()) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const el = slider(event.target);
    if (!el) return;
    capture("demo_slider_keyboard_used", { slider_id: el.dataset.analyticsSlider || "comparison", key: event.key });
  }, true);
  document.addEventListener("change", (event) => {
    if (!getDemo()) return;
    const el = slider(event.target);
    if (el && starts.has(el)) end(event);
  }, true);

  // Page exit is an engagement signal, not a reliable measurement of active time.
  let enteredAt = Date.now();
  const onVisibility = () => {
    if (!getDemo()) return;
    if (document.visibilityState === "hidden") {
      capture("demo_tab_hidden", { visible_duration_ms: Math.min(Date.now() - enteredAt, 3600000) });
    } else enteredAt = Date.now();
  };
  document.addEventListener("visibilitychange", onVisibility);
}

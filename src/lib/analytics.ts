import posthog from "posthog-js";

export type EventProperties = Record<string, string | number | boolean>;

/** Product event for PostHog. Steps shared with Maru Coach use its names
 * (limite_planes_visto, plan_click, checkout_creado, compra_confirmada) so
 * both funnels compare. PostHog only loads in
 * production (see instrumentation-client.ts), so elsewhere this does nothing.
 * Pass `beacon` right before leaving the page so the event is not dropped.
 * `setOnce` keeps the first value of a person property (first demo, first
 * import…) without overwriting it later. */
export function track(
  event: string,
  properties: EventProperties = {},
  beacon = false,
  setOnce?: EventProperties,
) {
  try {
    if (!posthog.__loaded) return;
    posthog.capture(
      event,
      setOnce ? { ...properties, $set_once: setOnce } : properties,
      beacon ? { transport: "sendBeacon" } : undefined,
    );
  } catch {
    /* Tracking is best effort. */
  }
}

/** Keeps the commercial demo a visitor came from on every later event
 * (registro, foto_subida, compra_confirmada…), for attribution. */
export function registerSuperProperties(properties: EventProperties) {
  try {
    if (!posthog.__loaded) return;
    posthog.register(properties);
  } catch {
    /* Tracking is best effort. */
  }
}

/** First-touch attribution: kept from the first demo seen, never replaced. */
export function registerSuperPropertiesOnce(properties: EventProperties) {
  try {
    if (!posthog.__loaded) return;
    posthog.register_once(properties);
  } catch {
    /* Tracking is best effort. */
  }
}

/** Person properties: `set` replaces, `setOnce` keeps the first value. */
export function setPersonProperties(set: EventProperties, setOnce?: EventProperties) {
  try {
    if (!posthog.__loaded) return;
    posthog.setPersonProperties(set, setOnce);
  } catch {
    /* Tracking is best effort. */
  }
}

const MILESTONE_KEY = "habita_milestones";

/**
 * An activation step that counts once (first import, first generation…):
 * its own event the first time this browser reaches it, and a person
 * property with the first date, kept by PostHog across devices once merged.
 * The usual event (property_import_started…) still fires every time.
 */
export function trackMilestone(milestone: string, properties: EventProperties = {}) {
  try {
    if (!posthog.__loaded) return;
    let seen: Record<string, number> = {};
    try {
      seen = JSON.parse(localStorage.getItem(MILESTONE_KEY) || "{}");
    } catch {
      /* Private mode or blocked storage: the person property still dedupes. */
    }
    if (seen[milestone]) return;
    seen[milestone] = Date.now();
    try {
      localStorage.setItem(MILESTONE_KEY, JSON.stringify(seen));
    } catch {
      /* Same as above. */
    }
    track(milestone, properties, false, { [`${milestone}_at`]: new Date().toISOString() });
  } catch {
    /* Tracking is best effort. */
  }
}

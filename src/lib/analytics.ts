import posthog from "posthog-js";

export type EventProperties = Record<string, string | number | boolean>;

/** Product event for PostHog. Steps shared with Maru Coach use its names
 * (limite_planes_visto, plan_click, checkout_creado, compra_confirmada) so
 * both funnels compare. PostHog only loads in
 * production (see instrumentation-client.ts), so elsewhere this does nothing.
 * Pass `beacon` right before leaving the page so the event is not dropped. */
export function track(
  event: string,
  properties: EventProperties = {},
  beacon = false,
) {
  try {
    if (!posthog.__loaded) return;
    posthog.capture(
      event,
      properties,
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

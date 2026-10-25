import posthog from "posthog-js";

export type EventProperties = Record<string, string | number | boolean>;

/** Product event for PostHog. The names match Maru Coach's (foto_subida,
 * diseno_generado, limite_planes_visto, plan_click, checkout_creado,
 * compra_confirmada) so both funnels compare. PostHog only loads in
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

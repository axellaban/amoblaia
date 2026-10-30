import posthog from "posthog-js";
import { INTERNAL_PROPERTY } from "./analytics-privacy";

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

/** Marks this browser as the team's: every later event carries
 * habita_internal, so the commercial funnel can leave it out. */
export function markInternal() {
  registerSuperProperties({ [INTERNAL_PROPERTY]: true });
}

/** A failed step as an event: where and with which HTTP status, never the
 * message (it may echo what the visitor typed). */
export function trackFailure(event: string, error: unknown, properties: EventProperties = {}) {
  const status =
    error && typeof error === "object" && "status" in error && typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : 0;
  track(event, { ...properties, status });
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

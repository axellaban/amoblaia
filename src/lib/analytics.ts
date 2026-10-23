import posthog from "posthog-js";

// Product events for the PostHog funnels and dashboards. PostHog only loads
// where instrumentation-client initialised it, so elsewhere this is a no-op.
export type AnalyticsEvent =
  | "foto_subida"
  | "herramienta_resultado"
  | "activacion"
  | "diseno_descargado"
  | "limite_planes_visto"
  | "plan_click"
  | "checkout_creado"
  | "checkout_error"
  | "compra_confirmada";

export function track(event: AnalyticsEvent, properties?: Record<string, unknown>) {
  if (typeof window === "undefined" || !posthog.__loaded) return;
  posthog.capture(event, properties);
}

// Events that must count once per browser, such as the first useful result
// or a confirmed order revisited from its return link.
export function trackOnce(
  key: string,
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
) {
  if (typeof window === "undefined" || !posthog.__loaded) return;
  const flag = `amoblaia:tracked:${key}`;
  try {
    if (localStorage.getItem(flag)) return;
    localStorage.setItem(flag, "1");
  } catch {
    /* storage blocked: count it anyway */
  }
  posthog.capture(event, properties);
}

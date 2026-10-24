import posthog from "posthog-js";

/**
 * Product events for PostHog (initialised in instrumentation-client, only in
 * production unless a key is configured). Properties describe the interaction
 * only: never names, phones, emails or free text. A click on a contact button
 * is a click, not a sent message nor a visit.
 */
export type EventName =
  | "ficha_abierta"
  | "ambientacion_explorada"
  | "estilo_seleccionado"
  | "comparativa_descargada"
  | "contacto_clic";
export type EventProps = Record<string, string | number | boolean>;

export function track(event: EventName, props: EventProps = {}) {
  try {
    if (typeof window === "undefined" || !posthog.__loaded) return;
    posthog.capture(event, props);
  } catch {
    /* Measurement never breaks the page. */
  }
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export type MetaCustomData = Record<string, string | number | boolean>;

/** Sends an event to the Meta Pixel and, with the same event ID so Meta can
 * deduplicate, to the Conversions API. Tracking never breaks the app. */
export function metaTrack(
  eventName: string,
  customData: MetaCustomData = {},
  standard = false,
  options: { eventId?: string; email?: string } = {},
) {
  try {
    if (typeof window === "undefined") return;
    const eventId = options.eventId || crypto.randomUUID();
    window.fbq?.(standard ? "track" : "trackCustom", eventName, customData, {
      eventID: eventId,
    });
    void fetch("/api/meta-capi", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventName,
        eventId,
        customData,
        url: window.location.href,
        email: options.email,
      }),
    }).catch(() => {});
  } catch {
    /* Tracking is best effort. */
  }
}

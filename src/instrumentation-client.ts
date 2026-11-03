import posthog from "posthog-js";
import { redactInvite } from "@/lib/agency/demo-invite";
import { routeOf, surfaceOf } from "@/lib/tracking-routes";
// habita. project token (US Cloud). Public by design; override per environment if needed.
const key =
  process.env.NEXT_PUBLIC_POSTHOG_KEY ??
  "phc_sy5S5HWym8wjPi9z4m8g7Motdg7Gp3q99xYGAUyTDcLZ";
// Only production sends events, like the Google Ads tag, unless a key is set explicitly.
if (key && (process.env.NEXT_PUBLIC_VERCEL_ENV === "production" || process.env.NEXT_PUBLIC_POSTHOG_KEY)) {
  posthog.init(key, {
    // Same-origin reverse proxy (see next.config.ts) so ad blockers don't drop events.
    api_host: "/ingest",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || "https://us.posthog.com",
    defaults: "2026-08-30",
    // Where they click on every screen (PostHog → Heatmaps), and the clicks that do nothing.
    enable_heatmaps: true,
    capture_dead_clicks: true,
    // The private invitation code travels in some URLs: it never reaches the analytics.
    before_send: (event) => {
      if (!event) return event;
      // Every event says which screen it came from, as a template (no ids, tokens or codes).
      if (event.properties && typeof window !== "undefined") {
        event.properties.route ??= routeOf(window.location.pathname);
        event.properties.surface ??= surfaceOf(window.location.pathname);
      }
      for (const bag of [event.properties, event.$set, event.$set_once] as (Record<string, unknown> | undefined)[])
        if (bag) for (const k of Object.keys(bag)) if (typeof bag[k] === "string") bag[k] = redactInvite(bag[k] as string);
      return event;
    },
  });
  // Clicks on tracked calls to action and the internal-traffic mark, loaded off the critical path.
  void import("@/lib/interaction-tracking").then(({ installInteractionTracking }) => installInteractionTracking());
}

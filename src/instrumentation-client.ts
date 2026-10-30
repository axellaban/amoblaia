import posthog from "posthog-js";
import { INTERNAL_PROPERTY, internalFlagFromUrl, redactDeep, releaseProperties } from "@/lib/analytics-privacy";
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
    // Uncaught errors and rejections reach Error Tracking, tied to the session replay.
    capture_exceptions: true,
    // The private invitation code travels in some URLs: it never reaches the analytics,
    // not even inside the session replay ($snapshot), which nests the page URL and link hrefs.
    before_send: (event) => {
      if (!event) return event;
      redactDeep(event.properties);
      redactDeep(event.$set);
      redactDeep(event.$set_once);
      return event;
    },
    loaded: (ph) => {
      try {
        // Release on every event: errors and funnels by deployment.
        ph.register(releaseProperties({
          NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
          NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
        }));
        const internal = internalFlagFromUrl(window.location.search);
        if (internal === true) ph.register({ [INTERNAL_PROPERTY]: true });
        if (internal === false) ph.unregister(INTERNAL_PROPERTY);
      } catch {
        /* Tracking is best effort. */
      }
    },
  });
}

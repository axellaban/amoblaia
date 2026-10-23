import posthog from "posthog-js";
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (key) {
  posthog.init(key, {
    // Same-origin reverse proxy (see next.config.ts) so ad blockers don't drop events.
    api_host: "/ingest",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || "https://us.posthog.com",
    defaults: "2026-08-30",
  });
}

import posthog from "posthog-js";
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
  });
}

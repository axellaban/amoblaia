import posthog from "posthog-js";
import { redactInvite } from "@/lib/agency/demo-invite";
import { internalHint } from "@/lib/internal/client";
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
    // The private invitation code travels in some URLs: it never reaches the analytics.
    before_send: (event) => {
      if (!event) return event;
      // The team's browsers: marked synchronously, so not even the first page view leaves unmarked.
      if (internalHint()) event.properties = { ...event.properties, is_internal: true };
      for (const bag of [event.properties, event.$set, event.$set_once] as (Record<string, unknown> | undefined)[])
        if (bag) for (const k of Object.keys(bag)) if (typeof bag[k] === "string") bag[k] = redactInvite(bag[k] as string);
      return event;
    },
  });
  // Clicks on tracked calls to action, loaded off the critical path.
  void import("@/lib/interaction-tracking").then(({ installInteractionTracking }) => installInteractionTracking());
}
// Is this browser the team's? The server answers (session, signed device, team fingerprint) in every environment.
if (typeof window !== "undefined") void import("@/lib/internal/client").then(({ syncInternal }) => syncInternal());

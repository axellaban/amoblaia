import { BOT_PATTERN } from "@/lib/leads/ingest";

export type ActivityVerdict = { internal: boolean; reason: string | null };

/**
 * Who a step of the public demo counts as. The team (its account, device or
 * hint) keeps its own reason. Crawlers, link previews and automation are
 * stored flagged as `bot`, like the lead events of the same visit, so they
 * never move the demo's summary («Demo visitada», visitors, `sent_at`). Pure.
 */
export function activityVerdict(team: ActivityVerdict, userAgent: string | null): ActivityVerdict {
  if (team.internal) return team;
  if (BOT_PATTERN.test(userAgent ?? "")) return { internal: true, reason: "bot" };
  return { internal: false, reason: null };
}

/**
 * What the public demo page reports, turned into stored lead events. Pure:
 * the route gives it the demo (looked up by its token, never trusted from the
 * body), who is asking and the clock. Everything the browser sends is
 * checked; free text, links and codes are never accepted, so nothing
 * sensitive can reach the table.
 */
import {
  AGENCY_LINKS,
  BUYER_LINKS,
  CLIENT_EVENTS,
  MEMBER_EVENTS,
  type Identity,
  type LeadEventName,
  type VisitorType,
} from "./config.ts";
import type { LeadEvent } from "./score.ts";

export type IngestContext = {
  demoId: string;
  agencyId: string | null;
  /** A signed-in member of the team: everything it does is internal. */
  team: boolean;
  /** A signed-in member of the demo's own agency (verified by the server). */
  member: boolean;
  userId: string | null;
  userAgent: string;
  now: number;
};

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const SAFE = /^[A-Za-z0-9_.:-]{1,80}$/;
const STYLE = /^[a-z0-9_-]{1,40}$/i;
const LINKS = new Set([...AGENCY_LINKS, ...BUYER_LINKS]);
const MAX_EVENTS = 50;
/** Reports older than this (a queue kept for days) or from the future get the server's time. */
const MAX_AGE_MS = 48 * 3600 * 1000;
const MAX_ACTIVE_MS = 6 * 3600 * 1000;

/** Crawlers, link previews and automation never count as a lead. */
export const BOT_PATTERN = /bot|crawl|spider|slurp|headless|lighthouse|facebookexternalhit|whatsapp|preview|python-requests|curl\/|wget|playwright|puppeteer|selenium/i;

const text = (v: unknown, pattern: RegExp) => (typeof v === "string" && pattern.test(v) ? v : null);

function when(v: unknown, now: number) {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return new Date(Number.isFinite(t) && t <= now + 5 * 60000 && t >= now - MAX_AGE_MS ? t : now).toISOString();
}

export type ClientBatch = { visitor: string; events: LeadEvent[]; dropped: number };

/** null when the batch itself is not valid (no visitor or not a list). */
export function normalizeClientBatch(body: Record<string, unknown>, ctx: IngestContext): ClientBatch | null {
  const visitor = text(body.visitor, ID);
  if (!visitor || !Array.isArray(body.events)) return null;
  const link = text(body.link, SAFE);
  const linkType = link && LINKS.has(link) ? link : null;
  const reasons = [
    ctx.team && "team_session",
    body.internal === true && "device_flag",
    body.automation === true && "automation",
    BOT_PATTERN.test(ctx.userAgent) && "bot",
  ].filter(Boolean) as string[];
  const internal = reasons.length > 0;
  const identity: Identity = ctx.member ? "identified" : linkType && AGENCY_LINKS.includes(linkType) ? "linked" : "anonymous";
  const visitorType: VisitorType = internal ? "internal" : ctx.member || (linkType && AGENCY_LINKS.includes(linkType)) ? "agency" : linkType ? "buyer" : "unknown";
  const session = text(body.session, SAFE);
  const device = text(body.device, SAFE);
  const view = text(body.view, ID);
  const out: LeadEvent[] = [];
  let dropped = 0;
  for (const raw of body.events.slice(0, MAX_EVENTS)) {
    const e = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const name = e.name as LeadEventName;
    const allowed = CLIENT_EVENTS.includes(name) || (MEMBER_EVENTS.includes(name) && ctx.member);
    const eventId = text(e.id, ID);
    if (!allowed || !eventId) {
      dropped += 1;
      continue;
    }
    let id = `c:${eventId}`;
    let value: number | null = null;
    if (name === "demo_active_time") {
      // One row per page view, holding its cumulative active time.
      if (!view) {
        dropped += 1;
        continue;
      }
      id = `c:${view}:active`;
      value = Math.max(0, Math.min(MAX_ACTIVE_MS, Math.round(Number(e.value) || 0)));
    }
    out.push({
      event_id: id,
      event_name: name,
      occurred_at: when(e.at, ctx.now),
      demo_id: ctx.demoId,
      agency_id: ctx.agencyId,
      visitor_id: visitor,
      session_id: session,
      ph_device_id: device,
      view_id: view,
      style_id: text(e.style, STYLE),
      photo_id: text(e.photo, SAFE),
      generation_id: null,
      property_id: text(e.property, SAFE),
      value,
      source: "client",
      visitor_type: visitorType,
      is_internal: internal,
      internal_reason: reasons[0] ?? null,
      identity,
      quality: "complete",
      link_type: linkType,
    });
  }
  dropped += Math.max(0, body.events.length - MAX_EVENTS);
  return { visitor, events: out, dropped };
}

/** A generation the server itself confirmed (the public generation route). */
export function serverGenerationEvent(
  kind: "demo_generation_started" | "demo_generation_completed",
  args: { demoId: string; agencyId: string | null; visitor: string; generationId: string; photoId: string; styleId: string; at: string; team: boolean },
): LeadEvent {
  return {
    event_id: `s:${kind === "demo_generation_started" ? "gen-start" : "gen-done"}:${args.generationId}`,
    event_name: kind,
    occurred_at: args.at,
    demo_id: args.demoId,
    agency_id: args.agencyId,
    visitor_id: args.visitor,
    generation_id: args.generationId,
    photo_id: args.photoId,
    style_id: args.styleId,
    source: "server",
    visitor_type: args.team ? "internal" : "unknown",
    is_internal: args.team,
    internal_reason: args.team ? "team_session" : null,
    identity: "anonymous",
    quality: "complete",
  };
}

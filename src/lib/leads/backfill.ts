/**
 * Historical events (PostHog and the database) turned into lead events, only
 * where their meaning is verified in the code that fired them. Ambiguous
 * events are counted and left out: they never become points. Pure, so the
 * backfill script and the tests share it. See docs/LEAD_SCORE.md § Backfill.
 */
import { AGENCY_LINKS, BUYER_LINKS, type LeadEventName } from "./config.ts";
import type { LeadEvent } from "./score.ts";

/** One PostHog event, as the HogQL export gives it. */
export type PostHogRow = {
  uuid: string;
  event: string;
  timestamp: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  /** person.properties.is_internal at ingestion (person-on-events). */
  person_internal?: boolean | null;
};

/** One generation a visitor asked for on a public demo (demo_public_stagings + generations). */
export type StagingRow = {
  key: string;
  demo_id: string;
  visitor: string;
  photo_id: string;
  style: string;
  created_at: string;
  generation_id: string | null;
  status: string | null;
  result_path: string | null;
  finished_at: string | null;
};

export type BackfillContext = {
  /** Existing demos: id → agency. Events of other ids (deleted demos, typos) are skipped. */
  demos: Map<string, string>;
  /** PostHog devices that the team used at any time (an internal event, or the person marked). */
  internalDevices: ReadonlySet<string>;
};

/**
 * What each PostHog event means, from the code that fires it (2026-10-30):
 * - demo_vista: one per page view of a public demo (repeats on refresh were fixed).
 * - demo_estilo: the click on a style (`choose`), with its style (`style_id`, or `estilo` before v2).
 * - demo_photo_changed: a change of photo the visitor made (arrow, swipe, thumbnail, keyboard);
 *   the first photo is never reported. Only with its `method` and `photo_id`.
 * - comparison_slider_used: one completed gesture that moved the line.
 * - demo_active_time: a piece of active time (visible and touched in the last 30 s); a visit is their sum.
 * - demo_agency_cta_clicked: a click on a CTA that leads to the agency's sign-up.
 * - demo_owner_precios: the plans were opened (bar, credits menu or the prices link).
 * - signup_form_started: the first character typed in a sign-up form.
 */
const MAPPED: Record<string, LeadEventName> = {
  demo_vista: "demo_opened",
  demo_estilo: "demo_style_selected",
  demo_photo_changed: "demo_photo_selected",
  comparison_slider_used: "demo_comparison_used",
  demo_active_time: "demo_active_time",
  demo_agency_cta_clicked: "demo_agency_cta_clicked",
  demo_owner_precios: "demo_pricing_viewed",
  signup_form_started: "demo_signup_started",
};

/** Read and deliberately not scored, with the reason. */
export const AMBIGUOUS: Record<string, string> = {
  demo_style_viewed: "tiempo en pantalla de un estilo: se repite al ocultar o volver a la pestaña, no es un clic",
  agency_signup_started: "pantalla de registro vista, no registro empezado",
  demo_generation_completed: "lo reporta el navegador; la generación se confirma con la base",
  demo_owner_generar: "clic en generar; la solicitud se confirma con la base",
  diseno_generado: "editor general, sin vínculo verificable con una demo",
  foto_subida: "editor general, sin vínculo verificable con una demo",
  demo_contacto: "un comprador contactando a la inmobiliaria, no una solicitud a habita",
  demo_visita: "un comprador coordinando una visita con la inmobiliaria",
  cta_clicked: "duplica los eventos específicos de cada acción",
};

const PHOTO_METHODS = new Set(["arrow", "swipe", "thumbnail", "keyboard"]);
const LINKS = new Set([...AGENCY_LINKS, ...BUYER_LINKS]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);

export const deviceOf = (row: PostHogRow) => str(row.properties.$device_id) ?? row.distinct_id;

/** Devices the team used: any of their events was internal, or the person was marked. */
export function internalDevicesOf(rows: PostHogRow[]) {
  const out = new Set<string>();
  for (const r of rows) if (r.properties.is_internal === true || r.properties.is_internal === "true" || r.person_internal === true) out.add(deviceOf(r));
  return out;
}

export type Mapped = { event: LeadEvent | null; reason: string };

export function mapPostHogEvent(row: PostHogRow, ctx: BackfillContext): Mapped {
  if (AMBIGUOUS[row.event]) return { event: null, reason: `ambiguous:${row.event}` };
  const name = MAPPED[row.event];
  if (!name) return { event: null, reason: `unused:${row.event}` };
  const p = row.properties;
  const demoId = str(p.demo_id);
  if (!demoId || !UUID.test(demoId) || !ctx.demos.has(demoId)) return { event: null, reason: "no_demo" };
  let style: string | null = null;
  let photo: string | null = null;
  let value: number | null = null;
  if (name === "demo_style_selected") {
    style = str(p.style_id) ?? str(p.estilo);
    // Rule 4: without the style a selection cannot be told apart from another.
    if (!style || style === "original") return { event: null, reason: "style_missing" };
  }
  if (name === "demo_photo_selected") {
    photo = str(p.photo_id);
    if (!photo || !PHOTO_METHODS.has(String(p.method))) return { event: null, reason: "photo_unverified" };
  }
  if (name === "demo_active_time") {
    value = Math.max(0, Math.round(Number(p.active_ms) || 0));
    if (!value) return { event: null, reason: "no_active_time" };
  }
  if (name === "demo_comparison_used" && (Number(p.travel) || 0) < 1 && p.input !== "keyboard") return { event: null, reason: "slider_unmoved" };
  const device = deviceOf(row);
  const env = str(p.app_env);
  const reason =
    p.is_internal === true || p.is_internal === "true"
      ? "event_flag"
      : row.person_internal === true
        ? "person_flag"
        : ctx.internalDevices.has(device)
          ? "device_flag"
          : env && env !== "production"
            ? "non_production"
            : null;
  const link = str(p.demo_link_type);
  const linkType = link && LINKS.has(link) ? link : null;
  return {
    reason: "mapped",
    event: {
      event_id: `b:${row.uuid}`,
      event_name: name,
      occurred_at: new Date(row.timestamp).toISOString(),
      demo_id: demoId,
      agency_id: ctx.demos.get(demoId) ?? null,
      visitor_id: `ph:${device}`,
      session_id: str(p.$session_id),
      ph_device_id: device,
      style_id: style,
      photo_id: photo,
      value,
      source: "backfill",
      visitor_type: reason ? "internal" : linkType && AGENCY_LINKS.includes(linkType) ? "agency" : linkType ? "buyer" : "unknown",
      is_internal: Boolean(reason),
      internal_reason: reason,
      identity: linkType && AGENCY_LINKS.includes(linkType) ? "linked" : "anonymous",
      // Before tracking_version 2 there were no photo, slider or active-time events: the history is partial.
      quality: Number(p.tracking_version) === 2 ? "complete" : "partial",
      link_type: linkType,
    },
  };
}

/**
 * Generations confirmed by the database: started when the claim exists,
 * completed only with status succeeded and a stored result. The visitor is
 * the one the server recorded. The PostHog device is linked only when one
 * single demo_owner_generar of the same demo and style happened in the two
 * minutes before (then both histories are the same browser).
 */
export function stagingEvents(rows: StagingRow[], clicks: PostHogRow[], ctx: BackfillContext): LeadEvent[] {
  const out: LeadEvent[] = [];
  for (const s of rows) {
    if (!ctx.demos.has(s.demo_id)) continue;
    const at = Date.parse(s.created_at);
    const candidates = new Set(
      clicks
        .filter((c) => {
          const t = Date.parse(c.timestamp);
          const style = str(c.properties.style_id) ?? str(c.properties.estilo);
          return c.event === "demo_owner_generar" && str(c.properties.demo_id) === s.demo_id && style === s.style && t <= at + 5000 && t >= at - 120000;
        })
        .map(deviceOf),
    );
    const device = candidates.size === 1 ? [...candidates][0] : null;
    const internal = device ? ctx.internalDevices.has(device) : false;
    const base = {
      demo_id: s.demo_id,
      agency_id: ctx.demos.get(s.demo_id) ?? null,
      visitor_id: s.visitor,
      ph_device_id: device,
      photo_id: s.photo_id,
      style_id: s.style,
      source: "backfill" as const,
      visitor_type: internal ? ("internal" as const) : ("unknown" as const),
      is_internal: internal,
      internal_reason: internal ? "device_flag" : null,
      identity: "anonymous" as const,
      quality: "complete" as const,
    };
    // Same ids the generation route writes: a live and a historical record of one generation are one row.
    out.push({ ...base, event_id: `s:gen-start:${s.key}`, event_name: "demo_generation_started", occurred_at: new Date(s.created_at).toISOString(), generation_id: s.key });
    if (s.generation_id && s.status === "succeeded" && s.result_path)
      out.push({
        ...base,
        event_id: `s:gen-done:${s.generation_id}`,
        event_name: "demo_generation_completed",
        occurred_at: new Date(s.finished_at ?? s.created_at).toISOString(),
        generation_id: s.generation_id,
      });
  }
  return out;
}

export type BackfillReport = {
  rows: number;
  mapped: number;
  skipped: Record<string, number>;
  first_complete_at: string | null;
  last_at: string | null;
};

export function mapAll(rows: PostHogRow[], ctx: BackfillContext) {
  const events: LeadEvent[] = [];
  const skipped: Record<string, number> = {};
  let firstComplete: string | null = null;
  let last: string | null = null;
  for (const r of rows) {
    const m = mapPostHogEvent(r, ctx);
    if (m.event) {
      events.push(m.event);
      if (m.event.quality === "complete" && (!firstComplete || m.event.occurred_at < firstComplete)) firstComplete = m.event.occurred_at;
      if (!last || m.event.occurred_at > last) last = m.event.occurred_at;
    } else skipped[m.reason] = (skipped[m.reason] ?? 0) + 1;
  }
  const report: BackfillReport = { rows: rows.length, mapped: events.length, skipped, first_complete_at: firstComplete, last_at: last };
  return { events, report };
}

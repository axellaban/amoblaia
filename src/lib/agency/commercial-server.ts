import "server-only";
import { adminClient } from "@/lib/supabase/server";
import { internalUserIds } from "@/lib/internal/server";
import { agencyDetail, allScoreRows } from "@/lib/leads/server";
import { rollupAgency, rollupDemo, type ScoreRow } from "@/lib/leads/rollup";
import type { Stage as ProspectStage } from "@/lib/prospecting/types";
import { commercialStage, demoVisitFact, lastActivity, type ActivityFact, type CommercialRow } from "./commercial";
import { contactedSend, funnelStep, isTestAgency, prospectStep } from "./demo-funnel";

/**
 * The facts behind the «Inmobiliarias» panel, read in a few light queries:
 * agencies, their demos, prospecting, subscriptions and lead scores. Every
 * optional source (a pending migration, a failed read) degrades to «not
 * known», never to an error of the whole list.
 */

type AgencyRow = { id: string; name: string; owner_id: string | null; claimed_at: string | null; created_at: string };
type DemoRow = {
  id: string;
  token?: string | null;
  agency_id: string;
  status: string;
  sent_at: string | null;
  activity_level: number | null;
  activity_at: string | null;
  cover_photo_id: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string | null;
  published_at: string | null;
};

const PAGE = 1000;

/** Every row of a query, page by page (PostgREST caps each answer). */
async function all<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, code: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw new Error(code);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/** Same, but an optional source: a missing table or column reads as nothing. */
async function optional<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch {
    return [];
  }
}

async function demosOf(agencyId: string | null) {
  const db = adminClient();
  const full = "id,token,agency_id,status,sent_at,activity_level,activity_at,cover_photo_id,created_by,created_at,updated_at,published_at";
  const read = (fields: string) =>
    all<DemoRow>((from, to) => {
      let q = db.from("demos").select(fields).order("created_at", { ascending: false }).range(from, to);
      if (agencyId) q = q.eq("agency_id", agencyId);
      return q;
    }, "COMMERCIAL_DEMOS_FAILED");
  try {
    return await read(full);
  } catch {
    // Before the activity and sending migrations: the basic columns only.
    return read("id,token,agency_id,status,cover_photo_id,created_at,published_at");
  }
}

async function subscribedOwners(owners: string[]) {
  if (!owners.length) return new Set<string>();
  const rows = await optional(async () => {
    const out: { user_id: string }[] = [];
    for (let i = 0; i < owners.length; i += 200) {
      const { data, error } = await adminClient().from("subscriptions").select("user_id").eq("status", "authorized").in("user_id", owners.slice(i, i + 200));
      if (error) throw new Error("COMMERCIAL_SUBSCRIPTIONS_FAILED");
      out.push(...((data ?? []) as { user_id: string }[]));
    }
    return out;
  });
  return new Set(rows.map((r) => r.user_id));
}

/**
 * Owners that did something in their panel after creating their account: an
 * image generated or a property imported (a property they created themselves
 * is read from the demos), with the latest of those. One light read per owner
 * and table; a failed read is «nothing».
 */
const OWNER_ACTION: Record<"generations" | "property_imports", string> = {
  generations: "Generó una imagen en su panel",
  property_imports: "Importó una propiedad",
};
async function ownerActions(owners: { id: string; since: string }[]) {
  const db = adminClient();
  const latest = new Map<string, ActivityFact>();
  await Promise.all(
    owners.map(async ({ id, since }) => {
      for (const table of ["generations", "property_imports"] as const) {
        const { data, error } = await db.from(table).select("created_at").eq("user_id", id).gt("created_at", since).order("created_at", { ascending: false }).limit(1);
        const at = (data as { created_at: string }[] | null)?.[0]?.created_at;
        if (error || !at) continue;
        const prev = latest.get(id);
        if (!prev || at > prev.at) latest.set(id, { at, text: OWNER_ACTION[table] });
      }
    }),
  );
  return latest;
}

type ProspectRow = { id: string; agency_id: string; stage: ProspectStage; created_at: string };
type ProspectEventRow = { id: string; account_id: string; type: string; occurred_at: string; human: boolean | null; channel: string | null; corrects_event_id: string | null };
type ProspectContactRow = { account_id: string; channel: string; address: string | null; invalid_at: string | null };
/** Prospecting stages that prove a reply or an interest (the stage only moves forward). */
const INTERESTED_STAGES: readonly ProspectStage[] = ["interested", "activated", "customer"];

async function prospectStages(agencyId: string | null) {
  const rows = await optional(() =>
    all<ProspectRow>((from, to) => {
      let q = adminClient().from("prospect_accounts").select("id,agency_id,stage,created_at").range(from, to);
      if (agencyId) q = q.eq("agency_id", agencyId);
      return q;
    }, "COMMERCIAL_PROSPECTS_FAILED"),
  );
  return { stages: new Map(rows.map((r) => [r.agency_id, r.stage])), accounts: rows };
}

/**
 * Each agency's prospecting step for the funnel: contacted (a send, or a
 * stage past «pending»), replied (a human reply) and interested, with the
 * day it was first contacted and whether the account is lost. Corrected
 * events don't count, nor a send to a channel whose every contact turned out
 * invalid («Número incorrecto», «Sin WhatsApp»): that message reached no one
 * (contactedSend, same rule as /admin/prospeccion and /api/metricas).
 */
async function prospectFunnel(accounts: ProspectRow[]) {
  const out = new Map<string, { step: number; at: string; lost: boolean; replied: boolean }>();
  /** Each agency's latest reply or interest: its own engagement for «Última actividad». */
  const replies = new Map<string, ActivityFact>();
  if (!accounts.length) return { funnel: out, replies };
  const one = accounts.length === 1 ? accounts[0].id : null;
  const [events, contacts] = await Promise.all([
    optional(() =>
      all<ProspectEventRow>((from, to) => {
        let q = adminClient()
          .from("prospect_events")
          .select("id,account_id,type,occurred_at,human,channel,corrects_event_id")
          .in("type", ["sent", "reply", "interest", "correction"])
          .range(from, to);
        if (one) q = q.eq("account_id", one);
        return q;
      }, "COMMERCIAL_PROSPECT_EVENTS_FAILED"),
    ),
    optional(() =>
      all<ProspectContactRow>((from, to) => {
        let q = adminClient().from("prospect_contacts").select("account_id,channel,address,invalid_at").range(from, to);
        if (one) q = q.eq("account_id", one);
        return q;
      }, "COMMERCIAL_PROSPECT_CONTACTS_FAILED"),
    ),
  ]);
  const corrected = new Set(events.map((e) => e.corrects_event_id).filter(Boolean));
  const byAccount = new Map<string, ProspectEventRow[]>();
  for (const e of events)
    if (e.type !== "correction" && !corrected.has(e.id) && !(e.type === "reply" && e.human === false))
      byAccount.set(e.account_id, [...(byAccount.get(e.account_id) ?? []), e]);
  const contactsOf = new Map<string, ProspectContactRow[]>();
  for (const c of contacts) contactsOf.set(c.account_id, [...(contactsOf.get(c.account_id) ?? []), c]);
  for (const a of accounts) {
    const own = byAccount.get(a.id) ?? [];
    const mine = (contactsOf.get(a.id) ?? []).map((c) => ({ channel: c.channel, invalid: !!c.invalid_at }));
    const sends = own.filter((e) => e.type === "sent");
    const validSends = sends.filter((e) => contactedSend(e.channel, mine));
    const interested = INTERESTED_STAGES.includes(a.stage) || own.some((e) => e.type === "interest");
    const replied = interested || a.stage === "conversation" || own.some((e) => e.type === "reply");
    // «Contactado» without a dated send moves the stage alone; a stage that only came from invalid sends does not count.
    const byStage = a.stage !== "pending" && a.stage !== "discarded" && (a.stage !== "sent" || !sends.length || validSends.length > 0);
    const contacted = replied || validSends.length > 0 || byStage;
    const step = prospectStep({ contacted, replied, interested });
    if (step === null) continue;
    for (const e of own) {
      if (e.type !== "reply" && e.type !== "interest") continue;
      const prev = replies.get(a.agency_id);
      if (!prev || e.occurred_at > prev.at) replies.set(a.agency_id, { at: e.occurred_at, text: e.type === "interest" ? "Mostró interés" : "Respondió el mensaje" });
    }
    const at = own.map((e) => e.occurred_at).sort()[0] ?? a.created_at;
    const prev = out.get(a.agency_id);
    if (!prev || step > prev.step) out.set(a.agency_id, { step, at: prev && prev.at < at ? prev.at : at, lost: a.stage === "lost", replied });
  }
  return { funnel: out, replies };
}

/** Each agency's contact WhatsApp; optional (before its migration, nothing). */
async function agencyWhatsapps(agencyId: string | null) {
  const rows = await optional(() =>
    all<{ id: string; contact_whatsapp: string | null }>((from, to) => {
      let q = adminClient().from("agencies").select("id,contact_whatsapp").range(from, to);
      if (agencyId) q = q.eq("id", agencyId);
      return q;
    }, "COMMERCIAL_WHATSAPPS_FAILED"),
  );
  return new Map(rows.map((r) => [r.id, r.contact_whatsapp]));
}

async function scoreRows(demoIds: string[] | null) {
  if (demoIds === null) return optional(() => allScoreRows());
  if (!demoIds.length) return [];
  return optional(async () => {
    const { data, error } = await adminClient()
      .from("lead_visitor_scores")
      .select("demo_id,agency_id,visitor_id,score,classification,commercial_score,activation_score,signals,explanation,last_event_at,attribution_confidence,visitor_type,is_internal,score_data_quality")
      .in("demo_id", demoIds)
      .limit(5000);
    if (error) throw new Error("COMMERCIAL_SCORES_FAILED");
    return (data ?? []) as ScoreRow[];
  });
}

/**
 * The panel's rows: every agency (or only one) with its stage, account,
 * properties, lead score and latest activity.
 */
export async function commercialRows(only: string | null = null): Promise<CommercialRow[]> {
  const db = adminClient();
  const [agenciesRaw, demos, prospects, team, whatsapps] = await Promise.all([
    all<AgencyRow>((from, to) => {
      let q = db.from("agencies").select("id,name,owner_id,claimed_at,created_at").order("created_at", { ascending: false }).range(from, to);
      if (only) q = q.eq("id", only);
      return q;
    }, "COMMERCIAL_AGENCIES_FAILED"),
    demosOf(only),
    prospectStages(only),
    internalUserIds(),
    agencyWhatsapps(only),
  ]);
  // An agency taken by a team account (QA of the claim, a test) has no real account:
  // no «Cuenta creada», no activity, no subscription. Its demos' visits still count.
  const agencies = agenciesRaw.map((a) => (a.owner_id && team.has(a.owner_id) ? { ...a, owner_id: null, claimed_at: null } : a));
  const claimed = agencies.filter((a): a is AgencyRow & { owner_id: string } => Boolean(a.owner_id));
  const [subscribed, scores, actions, prospecting] = await Promise.all([
    subscribedOwners([...new Set(claimed.map((a) => a.owner_id))]),
    scoreRows(only ? demos.map((d) => d.id) : null),
    ownerActions(claimed.map((a) => ({ id: a.owner_id, since: a.claimed_at ?? a.created_at }))).catch(() => new Map<string, ActivityFact>()),
    prospectFunnel(prospects.accounts),
  ]);
  const funnelOf = prospecting.funnel;
  const byAgency = new Map<string, DemoRow[]>();
  for (const d of demos) byAgency.set(d.agency_id, [...(byAgency.get(d.agency_id) ?? []), d]);
  // The demo decides its agency (the score row only keeps a copy).
  const agencyOfDemo = new Map(demos.map((d) => [d.id, d.agency_id]));
  const fixed = scores.map((r) => ({ ...r, agency_id: agencyOfDemo.get(r.demo_id) ?? r.agency_id }));

  return agencies.map((a) => {
    const own = byAgency.get(a.id) ?? [];
    const rollup = own.length ? rollupAgency(a.id, own.map((d) => d.id), fixed) : null;
    const score = rollup?.score ?? null;
    const prospectStage = prospects.stages.get(a.id) ?? null;
    const isSubscribed = Boolean(a.owner_id && subscribed.has(a.owner_id));
    const level = Math.max(0, ...own.map((d) => d.activity_level ?? 0));
    const sent = own.map((d) => d.sent_at).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
    const published = own.filter((d) => d.status === "published");
    const since = a.claimed_at ?? a.created_at;
    const share = published.find((d) => d.token);
    // Its account worked in its panel: an image, an import, or a property it created itself.
    const ownerAction = a.owner_id ? actions.get(a.owner_id) ?? null : null;
    const created = own
      .filter((d) => a.owner_id && d.created_by === a.owner_id && d.created_at > since)
      .map((d) => d.created_at)
      .sort()
      .at(-1);
    const ownerActive = Boolean(ownerAction || created);
    // The cover of its latest published demo, else of any demo.
    const cover = [...published, ...own].find((d) => d.cover_photo_id)?.cover_photo_id ?? null;
    // Only what the agency did (ACTIVITY_HINT): never the team creating, editing or sending.
    const ownIds = new Set(own.map((d) => d.id));
    const facts: (ActivityFact | null)[] = [
      demoVisitFact(fixed.filter((r) => r.agency_id === a.id && ownIds.has(r.demo_id))),
      prospecting.replies.get(a.id) ?? null,
      a.claimed_at ? { at: a.claimed_at, text: "Creó su cuenta" } : null,
      ownerAction,
      created ? { at: created, text: "Creó una propiedad en su panel" } : null,
    ];
    return {
      id: a.id,
      name: a.name,
      coverPhotoId: cover,
      stage: commercialStage({
        prospectStage,
        demoSent: Boolean(sent),
        activityLevel: level,
        score,
        hasOwner: Boolean(a.owner_id),
        subscribed: isSubscribed,
      }),
      hasOwner: Boolean(a.owner_id),
      subscribed: isSubscribed,
      prospect: Boolean(prospectStage),
      prospectFunnel: funnelOf.get(a.id) ?? null,
      properties: own.length,
      published: published.length,
      score,
      lastActivity: lastActivity(facts),
      createdAt: a.created_at,
      test: isTestAgency(a.name),
      whatsapp: whatsapps.get(a.id) ?? null,
      // Demos come newest first: the first published one with its token.
      shareDemo: share?.token ? { id: share.id, token: share.token } : null,
      demos: own.map((d) => ({
        id: d.id,
        sent: Boolean(d.sent_at),
        activityLevel: d.activity_level ?? 0,
        createdAt: d.created_at,
        step: funnelStep({
          sentAt: d.sent_at,
          activityLevel: d.activity_level ?? 0,
          hasOwner: Boolean(a.owner_id),
          ownerActive,
          subscribed: isSubscribed,
        }),
      })),
    };
  });
}

/** One agency's row, or null when it does not exist. */
export async function commercialRow(agencyId: string) {
  return (await commercialRows(agencyId))[0] ?? null;
}

/** Score and external visits of each demo of one agency (the «Propiedades y demos» list). */
export async function demoScoresOf(agencyId: string, demoIds: string[]) {
  const rows = (await scoreRows(demoIds)).map((r) => ({ ...r, agency_id: agencyId }));
  return Object.fromEntries(demoIds.map((id) => [id, rollupDemo(id, agencyId, rows).score]));
}

const INTERACTIONS = new Set(["demo_style_selected", "demo_photo_selected", "demo_comparison_used"]);
const RECENT_TEXT: Record<string, string> = {
  demo_opened: "Vio la demo",
  demo_style_selected: "Exploró estilos de ambientación",
  demo_photo_selected: "Recorrió las fotos",
  demo_comparison_used: "Usó el slider antes/después",
  demo_agency_cta_clicked: "Tocó el botón para inmobiliarias",
  demo_pricing_viewed: "Vio los precios",
  demo_signup_started: "Empezó el registro",
  demo_contact_requested: "Pidió que la contacten",
  demo_generation_completed: "Generó una imagen",
  demo_property_import_completed: "Importó una propiedad",
  demo_account_created: "Creó su cuenta",
};

/**
 * The «Actividad» tab: totals of what people outside the team did with the
 * agency's demos, the latest moments (repeated ones folded) and each demo's
 * score. Null when the lead tables are not there yet.
 */
export async function agencyActivity(agencyId: string) {
  const d = await agencyDetail(agencyId).catch(() => null);
  if (!d) return null;
  const internal = new Set(d.internal.map((i) => i.visitor_id));
  const events = d.events.filter((e) => !e.is_internal && !internal.has(e.visitor_id));
  const count = (pred: (name: string) => boolean) => events.filter((e) => pred(e.event_name)).length;
  const title = new Map(d.demos.map((x) => [x.demo_id, x.title]));
  const recent: { text: string; demo: string; at: string }[] = [];
  for (const e of events) {
    const text = RECENT_TEXT[e.event_name];
    if (!text) continue;
    const demo = title.get(e.demo_id) ?? "Demo";
    // Newest first: the same action on the same demo shows once, at its latest time.
    if (recent.some((r) => r.text === text && r.demo === demo)) continue;
    recent.push({ text, demo, at: e.occurred_at });
    if (recent.length >= 8) break;
  }
  return {
    score: d.rollup.score,
    visits: count((n) => n === "demo_opened"),
    interactions: count((n) => INTERACTIONS.has(n)),
    generated: count((n) => n === "demo_generation_completed"),
    signups: count((n) => n === "demo_account_created" || n === "demo_signup_started"),
    recent,
    byDemo: d.demos.map((x) => ({ id: x.demo_id, title: x.title, score: x.score })),
    /** Only the latest 400 events are read: the totals say so when they reach it. */
    capped: d.events.length >= 400,
  };
}
export type AgencyActivity = NonNullable<Awaited<ReturnType<typeof agencyActivity>>>;

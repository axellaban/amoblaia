import "server-only";
import { adminClient } from "@/lib/supabase/server";
import { rollupAgency, rollupDemo, sharedVisitors, type AgencyRollup, type DemoRollup, type ScoreRow } from "./rollup";
import { scoreDemoEvents, scoreRow, type LeadEvent } from "./score";

/**
 * Persistence of the Lead Engagement Score. Events go to lead_events; each
 * new batch recalculates its demo from all of that demo's events (a few
 * hundred rows) and replaces its rows in lead_visitor_scores, which is all
 * the panel reads. A full recalculation (recomputeAll) gives the same rows.
 */

const EVENT_FIELDS =
  "event_id,event_name,occurred_at,demo_id,agency_id,visitor_id,session_id,ph_device_id,view_id,style_id,photo_id,generation_id,property_id,value,source,visitor_type,is_internal,internal_reason,identity,quality,link_type";
const SCORE_FIELDS =
  "demo_id,agency_id,visitor_id,aliases,score,classification,commercial_score,activation_score,signals,explanation,last_event_at,attribution_confidence,visitor_type,is_internal,score_data_quality";

function check<T>(result: { data: T | null; error: unknown }, code: string): T {
  if (result.error) throw new Error(code);
  return result.data as T;
}

/** Stores events (best effort for the caller: it decides whether a failure matters). */
export async function recordLeadEvents(events: LeadEvent[]) {
  if (!events.length) return 0;
  const { data, error } = await adminClient().rpc("habita_lead_record", { p_events: events });
  if (error) throw new Error("LEAD_RECORD_FAILED");
  return Number(data) || 0;
}

export async function internalVisitorIds() {
  const rows = check(await adminClient().from("lead_internal_visitors").select("visitor_id").limit(5000), "LEAD_INTERNAL_FAILED") as { visitor_id: string }[];
  return new Set(rows.map((r) => r.visitor_id));
}

/** All the events of one demo, oldest first (paged, so a busy demo is read whole). */
export async function demoEvents(demoId: string) {
  const out: LeadEvent[] = [];
  for (let from = 0; ; from += 1000) {
    const page = check(
      await adminClient().from("lead_events").select(EVENT_FIELDS).eq("demo_id", demoId).order("occurred_at").order("event_id").range(from, from + 999),
      "LEAD_EVENTS_FAILED",
    ) as LeadEvent[];
    out.push(...page.map((e) => ({ ...e, value: e.value == null ? null : Number(e.value) })));
    if (page.length < 1000) return out;
  }
}

/** Recalculates every visitor of one demo from its events and replaces its rows. */
export async function recomputeDemo(demoId: string, internal?: Set<string>) {
  const [events, marked] = await Promise.all([demoEvents(demoId), internal ? Promise.resolve(internal) : internalVisitorIds()]);
  const scores = scoreDemoEvents(events, marked, demoId);
  const { error } = await adminClient().rpc("habita_lead_replace_scores", { p_demo: demoId, p_rows: scores.map(scoreRow) });
  if (error) throw new Error("LEAD_SCORES_FAILED");
  return scores;
}

/** Best effort, after a response: a failure is logged and the next batch fixes it. */
export async function recomputeQuietly(demoId: string) {
  try {
    await recomputeDemo(demoId);
  } catch {
    console.error("lead_recompute_failed");
  }
}

/** Every demo with events, one after another: the audit recalculation. */
export async function recomputeAll() {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const page = check(
      await adminClient().from("lead_events").select("demo_id").order("demo_id").range(from, from + 999),
      "LEAD_EVENTS_FAILED",
    ) as { demo_id: string }[];
    for (const r of page) ids.add(r.demo_id);
    if (page.length < 1000) break;
  }
  // Demos whose events were all removed keep no stale score.
  const scored = check(await adminClient().from("lead_visitor_scores").select("demo_id").limit(10000), "LEAD_SCORES_FAILED") as { demo_id: string }[];
  for (const r of scored) ids.add(r.demo_id);
  const internal = await internalVisitorIds();
  let visitors = 0;
  for (const id of [...ids].sort()) visitors += (await recomputeDemo(id, internal)).length;
  return { demos: ids.size, visitors };
}

/** The demos where a browser (or its PostHog device) has events. */
async function demosOfVisitor(visitorId: string) {
  const db = adminClient();
  const device = visitorId.startsWith("ph:") ? visitorId.slice(3) : null;
  const [own, byDevice, scored] = await Promise.all([
    db.from("lead_events").select("demo_id,ph_device_id").eq("visitor_id", visitorId).limit(5000),
    device ? db.from("lead_events").select("demo_id").eq("ph_device_id", device).limit(5000) : Promise.resolve({ data: [], error: null }),
    db.from("lead_visitor_scores").select("demo_id").or(`visitor_id.eq.${visitorId},aliases.cs.{${visitorId}}`).limit(5000),
  ]);
  const ids = new Set<string>();
  for (const r of [...(check(own, "LEAD_EVENTS_FAILED") ?? []), ...(check(byDevice, "LEAD_EVENTS_FAILED") ?? []), ...(check(scored, "LEAD_SCORES_FAILED") ?? [])] as { demo_id: string }[])
    ids.add(r.demo_id);
  return [...ids];
}

const VISITOR = /^(ph:)?[A-Za-z0-9_.:-]{8,100}$/;
export const validLeadVisitor = (v: unknown): v is string => typeof v === "string" && VISITOR.test(v);

/**
 * Marks (or unmarks) a browser as the team's. Who and when stay on the row
 * and in admin_audit; every demo it touched is recalculated right away.
 */
export async function setInternalVisitor(args: { visitorId: string; internal: boolean; actorId: string; note?: string | null }) {
  const db = adminClient();
  if (args.internal) {
    const { error } = await db
      .from("lead_internal_visitors")
      .upsert({ visitor_id: args.visitorId, reason: "manual", note: args.note ?? null, marked_by: args.actorId, marked_at: new Date().toISOString() });
    if (error) throw new Error("LEAD_INTERNAL_FAILED");
  } else {
    const { error } = await db.from("lead_internal_visitors").delete().eq("visitor_id", args.visitorId);
    if (error) throw new Error("LEAD_INTERNAL_FAILED");
  }
  await db.from("admin_audit").insert({
    actor_id: args.actorId,
    action: args.internal ? "lead_visitor_internal" : "lead_visitor_external",
    subject_id: null,
    details: { visitor: args.visitorId, note: args.note ?? null },
  });
  const demos = await demosOfVisitor(args.visitorId);
  const internal = await internalVisitorIds();
  for (const id of demos) await recomputeDemo(id, internal);
  return { demos: demos.length };
}

type DemoInfo = { id: string; agency_id: string; status: string; sent_at: string | null; title: string | null; property_id: string };

async function demoInfos() {
  const rows = check(
    await adminClient().from("demos").select("id,agency_id,status,sent_at,title,property_id").order("created_at", { ascending: false }).limit(1000),
    "LEAD_DEMOS_FAILED",
  ) as DemoInfo[];
  const props = rows.length
    ? (check(await adminClient().from("demo_properties").select("id,title").in("id", rows.map((d) => d.property_id)), "LEAD_DEMOS_FAILED") as { id: string; title: string }[])
    : [];
  const title = new Map(props.map((p) => [p.id, p.title]));
  return rows.map((d) => ({ ...d, title: d.title || title.get(d.property_id) || "Demo" }));
}

async function allScoreRows() {
  const out: ScoreRow[] = [];
  for (let from = 0; ; from += 1000) {
    const page = check(
      await adminClient().from("lead_visitor_scores").select(SCORE_FIELDS).order("demo_id").order("visitor_id").range(from, from + 999),
      "LEAD_SCORES_FAILED",
    ) as ScoreRow[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

export type LeadOverview = {
  agencies: (AgencyRollup & { name: string; has_account: boolean })[];
  demos: (DemoRollup & { title: string; agency_name: string; status: string; sent_at: string | null })[];
  internal_visitors: number;
  calculated_at: string;
};

/** The whole panel in three reads: demos, agencies and the stored visitor scores. */
export async function leadOverview(): Promise<LeadOverview> {
  const [demos, rows, agencies, internal] = await Promise.all([
    demoInfos(),
    allScoreRows(),
    adminClient().from("agencies").select("id,name,owner_id").limit(2000),
    adminClient().from("lead_internal_visitors").select("visitor_id", { count: "exact", head: true }),
  ]);
  const agencyRows = check(agencies, "LEAD_AGENCIES_FAILED") as { id: string; name: string; owner_id: string | null }[];
  const names = new Map(agencyRows.map((a) => [a.id, a.name]));
  const withAccount = new Set(agencyRows.filter((a) => a.owner_id).map((a) => a.id));
  // The demo decides its agency (the stored agency is only a copy).
  const agencyOfDemo = new Map(demos.map((d) => [d.id, d.agency_id]));
  const fixed = rows.map((r) => ({ ...r, agency_id: agencyOfDemo.get(r.demo_id) ?? r.agency_id }));
  const shared = sharedVisitors(fixed);
  const byAgency = new Map<string, string[]>();
  for (const d of demos) byAgency.set(d.agency_id, [...(byAgency.get(d.agency_id) ?? []), d.id]);
  return {
    agencies: [...byAgency.entries()].map(([id, ids]) => ({
      ...rollupAgency(id, ids, fixed, shared),
      name: names.get(id) ?? "Inmobiliaria",
      // A fact from the database, never part of the score: the claim is not tied to a visitor.
      has_account: withAccount.has(id),
    })),
    demos: demos.map((d) => ({
      ...rollupDemo(d.id, d.agency_id, fixed),
      title: d.title ?? "Demo",
      agency_name: names.get(d.agency_id) ?? "Inmobiliaria",
      status: d.status,
      sent_at: d.sent_at,
    })),
    internal_visitors: internal.count ?? 0,
    calculated_at: new Date().toISOString(),
  };
}

/** One small map for the demo list badges: demo → its rollup (score, class, external visitors). */
export async function demoScores() {
  const [demos, rows] = await Promise.all([
    adminClient().from("demos").select("id,agency_id").limit(1000),
    allScoreRows(),
  ]);
  const list = check(demos, "LEAD_DEMOS_FAILED") as { id: string; agency_id: string }[];
  const withRows = new Set(rows.map((r) => r.demo_id));
  return Object.fromEntries(
    list
      .filter((d) => withRows.has(d.id))
      .map((d) => {
        const r = rollupDemo(d.id, d.agency_id, rows);
        return [d.id, { score: r.score, classification: r.classification, external: r.external_visitors, internal: r.internal_visitors, quality: r.score_data_quality }];
      }),
  );
}

/** Everything about one agency's demos: visitors with their breakdown and the events behind them. */
export async function agencyDetail(agencyId: string) {
  const db = adminClient();
  const [agency, demos] = await Promise.all([
    db.from("agencies").select("id,name").eq("id", agencyId).maybeSingle(),
    demoInfos().then((all) => all.filter((d) => d.agency_id === agencyId)),
  ]);
  const a = check(agency, "LEAD_AGENCIES_FAILED") as { id: string; name: string } | null;
  if (!a) return null;
  const ids = demos.map((d) => d.id);
  if (!ids.length) return { agency: a, demos: [], visitors: [], events: [], internal: [], rollup: rollupAgency(agencyId, [], []) };
  const [visitors, events, internal] = await Promise.all([
    db.from("lead_visitor_scores").select("*").in("demo_id", ids).order("score", { ascending: false }).limit(2000),
    db.from("lead_events").select(EVENT_FIELDS).in("demo_id", ids).neq("event_name", "demo_active_time").order("occurred_at", { ascending: false }).limit(400),
    db.from("lead_internal_visitors").select("visitor_id,reason,note,marked_by,marked_at").limit(5000),
  ]);
  const rows = (check(visitors, "LEAD_SCORES_FAILED") as (ScoreRow & Record<string, unknown>)[]).map((r) => ({ ...r, agency_id: agencyId }));
  // Visitors seen on other agencies' demos too (possible team traffic) need every agency's rows.
  const shared = sharedVisitors(await allScoreRows());
  return {
    agency: a,
    rollup: rollupAgency(agencyId, ids, rows, shared),
    demos: demos.map((d) => ({ ...rollupDemo(d.id, agencyId, rows), title: d.title ?? "Demo", status: d.status, sent_at: d.sent_at })),
    visitors: rows.map((r) => ({ ...r, shared: shared.has(r.visitor_id) })),
    events: (check(events, "LEAD_EVENTS_FAILED") as LeadEvent[]).map((e) => ({ ...e, value: e.value == null ? null : Number(e.value) })),
    internal: check(internal, "LEAD_INTERNAL_FAILED") as { visitor_id: string; reason: string; note: string | null; marked_by: string | null; marked_at: string }[],
  };
}
export type AgencyDetail = NonNullable<Awaited<ReturnType<typeof agencyDetail>>>;

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
/** The published demo behind a public link: only its ids, one light read. */
export async function demoByToken(token: string) {
  if (!TOKEN.test(token)) return null;
  const row = check(
    await adminClient().from("demos").select("id,agency_id").eq("token", token).eq("status", "published").maybeSingle(),
    "LEAD_DEMO_LOOKUP_FAILED",
  ) as { id: string; agency_id: string } | null;
  return row;
}

/** Whether a signed-in account works for this agency (verified identity of the visitor). */
export async function memberOf(userId: string, agencyId: string) {
  const { data, error } = await adminClient().from("agency_members").select("agency_id").eq("user_id", userId).eq("agency_id", agencyId).maybeSingle();
  return !error && Boolean(data);
}

// Backfill of the Lead Engagement Score from PostHog history and the
// database's confirmed generations. Dry-run by default: it reads, maps and
// scores, and prints what it would store. Paged and resumable (--state), and
// idempotent: every event keeps its PostHog uuid (b:<uuid>) or the same id the
// live server writes, so running it again stores nothing new.
//
//   node --experimental-strip-types scripts/lead-backfill.ts            # dry-run
//   node --experimental-strip-types scripts/lead-backfill.ts --apply    # store + recalculate
//
// Options: --until=ISO (default: the first event of the new instrumentation, so
// nothing is counted twice), --since=ISO, --state=.lead-backfill.json,
// --posthog-file=events.json (a HogQL export instead of the API).
// Needs POSTHOG_HOST (https://us.posthog.com), POSTHOG_PROJECT_ID,
// POSTHOG_PERSONAL_API_KEY (query:read), SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY. Never prints keys or visitor data.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { internalDevicesOf, mapAll, stagingEvents, type PostHogRow, type StagingRow } from "../src/lib/leads/backfill.ts";
import { rollupAgency, sharedVisitors, type ScoreRow } from "../src/lib/leads/rollup.ts";
import { scoreDemoEvents, scoreRow, type LeadEvent, type VisitorScore } from "../src/lib/leads/score.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = args.includes("--apply");
const statePath = flag("state") ?? ".lead-backfill.json";
const since = flag("since") ?? "2026-10-01T00:00:00Z";
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Falta ${k}`);
  return v;
};

type State = { cursor: { ts: string; uuid: string } | null; rows: PostHogRow[]; done: boolean; recorded: number };
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { cursor: null, rows: [], done: false, recorded: 0 };
const save = () => writeFileSync(statePath, JSON.stringify(state));

async function supabase<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status} en ${path.split("?")[0]}`);
  return (await r.json()) as T;
}
async function rpc(name: string, body: object) {
  return supabase(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
}

async function hogql<T>(query: string): Promise<T[]> {
  const r = await fetch(`${env("POSTHOG_HOST")}/api/projects/${env("POSTHOG_PROJECT_ID")}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("POSTHOG_PERSONAL_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!r.ok) throw new Error(`PostHog ${r.status}`);
  const data = (await r.json()) as { results: unknown[][]; columns: string[] };
  return data.results.map((row) => Object.fromEntries(data.columns.map((c, i) => [c, row[i]])) as T);
}

const EVENTS = [
  "demo_vista", "demo_estilo", "demo_photo_changed", "comparison_slider_used", "demo_active_time",
  "demo_agency_cta_clicked", "demo_owner_precios", "signup_form_started", "demo_owner_generar",
  "demo_style_viewed", "agency_signup_started", "demo_generation_completed",
];
const iso = (v: string) => (/^\d{4}-\d{2}-\d{2}T/.test(v) ? v : (() => { throw new Error(`Fecha inválida: ${v}`); })());

/** Pages of 1000 by (timestamp, uuid); the cursor is saved after each page, so an interruption resumes there. */
async function fetchPostHog(until: string) {
  const file = flag("posthog-file");
  if (file) {
    state.rows = (JSON.parse(readFileSync(file, "utf8")) as PostHogRow[]).filter((r) => r.timestamp >= since && r.timestamp < until);
    state.done = true;
    return;
  }
  const list = EVENTS.map((e) => `'${e}'`).join(",");
  while (!state.done) {
    const c = state.cursor;
    const after = c ? `AND (timestamp > toDateTime('${iso(c.ts)}') OR (timestamp = toDateTime('${iso(c.ts)}') AND toString(uuid) > '${c.uuid.replace(/[^0-9a-f-]/gi, "")}'))` : "";
    const page = await hogql<{ uuid: string; event: string; timestamp: string; distinct_id: string; properties: string; person_internal: boolean | null }>(
      `SELECT toString(uuid) AS uuid, event, timestamp, distinct_id, properties, person.properties.is_internal AS person_internal
       FROM events WHERE event IN (${list}) AND timestamp >= toDateTime('${iso(since)}') AND timestamp < toDateTime('${iso(until)}') ${after}
       ORDER BY timestamp, uuid LIMIT 1000`,
    );
    for (const p of page)
      state.rows.push({ ...p, properties: typeof p.properties === "string" ? JSON.parse(p.properties) : p.properties, person_internal: p.person_internal === true });
    if (page.length) state.cursor = { ts: page[page.length - 1].timestamp, uuid: page[page.length - 1].uuid };
    if (page.length < 1000) state.done = true;
    save();
    console.log(`PostHog: ${state.rows.length} eventos leídos`);
  }
}

/** Devices the team used at any time, from every event (not only the ones read). */
async function teamDevices(rows: PostHogRow[]) {
  const out = internalDevicesOf(rows);
  if (flag("posthog-file")) return out;
  const extra = await hogql<{ device: string }>(
    `SELECT DISTINCT coalesce(properties.$device_id, distinct_id) AS device FROM events
     WHERE properties.is_internal = true OR person.properties.is_internal = true LIMIT 10000`,
  );
  for (const e of extra) out.add(e.device);
  return out;
}

async function main() {
  const demos = await supabase<{ id: string; agency_id: string }[]>("demos?select=id,agency_id&limit=5000");
  const agencies = await supabase<{ id: string; name: string }[]>("agencies?select=id,name&limit=5000");
  let until = flag("until");
  if (!until) {
    const first = await supabase<{ occurred_at: string }[]>("lead_events?select=occurred_at&source=eq.client&order=occurred_at.asc&limit=1");
    until = first[0]?.occurred_at ?? new Date().toISOString();
  }
  console.log(`Ventana: ${since} → ${until} (los eventos nuevos se miden en vivo desde ahí)`);
  await fetchPostHog(until);

  const internalDevices = await teamDevices(state.rows);
  const ctx = { demos: new Map(demos.map((d) => [d.id, d.agency_id])), internalDevices };
  const { events, report } = mapAll(state.rows, ctx);
  const stagings = await supabase<Omit<StagingRow, "generation_id" | "status" | "result_path" | "finished_at">[]>(
    `demo_public_stagings?select=key,demo_id,visitor,photo_id,style,created_at&created_at=lt.${encodeURIComponent(until)}&limit=5000`,
  );
  const gens = stagings.length
    ? await supabase<{ id: string; request_key: string; status: string; result_path: string | null; finished_at: string | null }[]>(
        `generations?select=id,request_key,status,result_path,finished_at&request_key=in.(${stagings.map((s) => s.key).join(",")})`,
      )
    : [];
  const byKey = new Map(gens.map((g) => [g.request_key, g]));
  const generated = stagingEvents(
    stagings.map((s) => {
      const g = byKey.get(s.key);
      return { ...s, generation_id: g?.id ?? null, status: g?.status ?? null, result_path: g?.result_path ?? null, finished_at: g?.finished_at ?? null };
    }),
    state.rows,
    ctx,
  );
  const all: LeadEvent[] = [...events, ...generated];

  const marked = new Set((await supabase<{ visitor_id: string }[]>("lead_internal_visitors?select=visitor_id&limit=5000").catch(() => [])).map((r) => r.visitor_id));
  const byDemo = new Map<string, LeadEvent[]>();
  for (const e of all) byDemo.set(e.demo_id, [...(byDemo.get(e.demo_id) ?? []), e]);
  const scores: VisitorScore[] = [...byDemo.entries()].flatMap(([id, evs]) => scoreDemoEvents(evs, marked, id));
  const rows: ScoreRow[] = scores.map((s) => ({
    demo_id: s.demo_id, agency_id: s.agency_id, visitor_id: s.visitor_id, score: s.score, classification: s.classification,
    commercial_score: s.breakdown.commercial, activation_score: s.breakdown.activation, signals: s.signals, explanation: s.explanation,
    last_event_at: s.last_event_at, attribution_confidence: s.attribution_confidence, visitor_type: s.visitor_type,
    is_internal: s.is_internal, score_data_quality: s.score_data_quality,
  }));
  const shared = sharedVisitors(rows);
  const name = new Map(agencies.map((a) => [a.id, a.name]));
  const byAgency = new Map<string, string[]>();
  for (const d of demos) byAgency.set(d.agency_id, [...(byAgency.get(d.agency_id) ?? []), d.id]);
  const ranked = [...byAgency.entries()].map(([id, ids]) => ({ name: name.get(id) ?? id, ...rollupAgency(id, ids, rows, shared) })).filter((a) => a.score !== null).sort((a, b) => b.score! - a.score!);
  const scoredDemos = new Set(rows.filter((r) => !r.is_internal).map((r) => r.demo_id));

  console.log(JSON.stringify({
    modo: apply ? "apply" : "dry-run",
    eventos_posthog: report.rows,
    eventos_mapeados: report.mapped,
    generaciones_confirmadas: generated.filter((e) => e.event_name === "demo_generation_completed").length,
    omitidos: report.skipped,
    primer_evento_completo: report.first_complete_at,
    demos_con_score: scoredDemos.size,
    demos_parciales: new Set(rows.filter((r) => !r.is_internal && r.score_data_quality === "partial").map((r) => r.demo_id)).size,
    visitantes_externos: rows.filter((r) => !r.is_internal).length,
    visitantes_internos_excluidos: rows.filter((r) => r.is_internal).length,
    inmobiliarias_con_senal_comercial: ranked.filter((a) => a.has_commercial_signal).length,
    top10: ranked.slice(0, 10).map((a) => ({ inmobiliaria: a.name, score: a.score, calidad: a.score_data_quality, externos: a.external_visitors, senal: a.main_signal })),
  }, null, 2));

  if (!apply) return console.log("Dry-run: no se escribió nada. Repetí con --apply para guardar.");
  for (let i = state.recorded; i < all.length; i += 200) {
    await rpc("habita_lead_record", { p_events: all.slice(i, i + 200) });
    state.recorded = Math.min(all.length, i + 200);
    save();
  }
  // Recalculate from everything stored (live events included), demo by demo.
  for (const id of [...byDemo.keys()].sort()) {
    const stored = await supabase<LeadEvent[]>(`lead_events?select=*&demo_id=eq.${id}&order=occurred_at&limit=10000`);
    await rpc("habita_lead_replace_scores", { p_demo: id, p_rows: scoreDemoEvents(stored.map((e) => ({ ...e, value: e.value == null ? null : Number(e.value) })), marked, id).map(scoreRow) });
  }
  console.log(`Guardado: ${all.length} eventos, ${byDemo.size} demos recalculadas.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Falló el backfill");
  process.exitCode = 1;
});

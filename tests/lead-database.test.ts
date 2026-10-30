import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// lead_events and lead_visitor_scores on the real migrations (PGlite). See 202611140001_lead_engagement.sql.
let db: PGlite;
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(700000000000 + ++n).padStart(12, "0")}`;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
   create table auth.users(id uuid primary key, is_anonymous boolean not null default false);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   grant usage on schema public to authenticated;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}, 60000);
afterAll(async () => await db?.close());

async function demo() {
  const agency = (await one<{ id: string }>("insert into agencies(name) values('Sur') returning id"))!.id;
  const property = (await one<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Depto') returning id", [agency]))!.id;
  const row = (await one<{ id: string }>("insert into demos(agency_id,property_id,token) values($1,$2,$3) returning id", [agency, property, `tok_${id().replace(/-/g, "")}`]))!;
  return { agency, demo: row.id };
}
const record = (events: object[]) => db.query("select habita_lead_record($1::jsonb)", [JSON.stringify(events)]);
const event = (demoId: string, over: Record<string, unknown>) => ({
  event_id: `ev-${++n}`,
  event_name: "demo_style_selected",
  occurred_at: "2026-10-30T15:00:00Z",
  demo_id: demoId,
  visitor_id: "visitante-1",
  source: "client",
  ...over,
});

describe("lead events", () => {
  it("stores an event once, however many times it is delivered (same batch or a retry)", async () => {
    const { demo: d } = await demo();
    const e = event(d, { event_id: "same-1", style_id: "modern" });
    await record([e, e]);
    await record([{ ...e, style_id: "nordic", occurred_at: "2026-10-30T18:00:00Z" }]);
    const rows = (await db.query<{ style_id: string }>("select style_id from lead_events where demo_id=$1", [d])).rows;
    expect(rows).toEqual([{ style_id: "modern" }]);
  });

  it("keeps the largest active time of a page view, whatever the order it arrives in", async () => {
    const { demo: d } = await demo();
    const base = event(d, { event_id: "view-x:active", event_name: "demo_active_time" });
    await record([{ ...base, value: 20000 }]);
    await record([{ ...base, value: 50000 }]);
    await record([{ ...base, value: 10000 }]);
    expect(Number((await one<{ value: string | number }>("select value from lead_events where event_id='view-x:active'"))!.value)).toBe(50000);
  });

  it("refuses unknown event names and keeps the browser out", async () => {
    const { demo: d } = await demo();
    await expect(record([event(d, { event_name: "demo_style_viewed" })])).rejects.toThrow();
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from lead_events")).rejects.toThrow();
      await expect(db.query("select * from lead_visitor_scores")).rejects.toThrow();
      await expect(db.query("select habita_lead_record('[]'::jsonb)")).rejects.toThrow();
    } finally {
      await db.exec("reset role");
    }
  });
});

describe("lead scores", () => {
  it("replaces a demo's scores whole and leaves other demos alone", async () => {
    const a = await demo();
    const b = await demo();
    const row = (visitor: string, agency: string, score: number) => ({
      visitor_id: visitor,
      agency_id: agency,
      score,
      classification: "cold",
      score_version: "lead_score_v1",
      visual_score: score,
      signals: ["Eligió un estilo"],
      attribution_confidence: "linked",
      visitor_type: "agency",
      score_data_quality: "complete",
    });
    const replace = (demoId: string, rows: object[]) => db.query("select habita_lead_replace_scores($1,$2::jsonb)", [demoId, JSON.stringify(rows)]);
    await replace(a.demo, [row("v1", a.agency, 20), row("v2", a.agency, 4)]);
    await replace(b.demo, [row("v9", b.agency, 8)]);
    await replace(a.demo, [row("v1", a.agency, 24)]);
    const rows = (await db.query<{ demo_id: string; visitor_id: string; score: number; signals: string[] }>(
      "select demo_id, visitor_id, score, signals from lead_visitor_scores where demo_id in ($1,$2) order by visitor_id",
      [a.demo, b.demo],
    )).rows;
    expect(rows.map((r) => [r.demo_id === a.demo ? "a" : "b", r.visitor_id, r.score])).toEqual([
      ["a", "v1", 24],
      ["b", "v9", 8],
    ]);
    expect(rows[0].signals).toEqual(["Eligió un estilo"]);
  });

  it("refuses a score out of 0–100", async () => {
    const { demo: d, agency } = await demo();
    await expect(
      db.query("select habita_lead_replace_scores($1,$2::jsonb)", [
        d,
        JSON.stringify([{ visitor_id: "v", agency_id: agency, score: 101, classification: "x", score_version: "lead_score_v1", attribution_confidence: "linked", visitor_type: "agency", score_data_quality: "complete" }]),
      ]),
    ).rejects.toThrow();
  });
});

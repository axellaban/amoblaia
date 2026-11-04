import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Internal traffic on the real migrations (PGlite). See 202611230001_internal_traffic.sql.
let db: PGlite;
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(500000000000 + ++n).padStart(12, "0")}`;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const all = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

beforeAll(async () => {
  db = new PGlite();
  // auth.users with e-mail, like Supabase's: the registry resolves accounts by address.
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
   create table auth.users(id uuid primary key, is_anonymous boolean not null default false, email text);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   grant usage on schema public to authenticated;`);
  for (const file of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}, 60000);
afterAll(async () => await db?.close());

async function demo() {
  const agency = (await one<{ id: string }>("insert into agencies(name) values('Inmobiliaria Norte') returning id"))!.id;
  const property = (await one<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Casa') returning id", [agency]))!.id;
  const row = (await one<{ id: string }>("insert into demos(agency_id,property_id,token) values($1,$2,$3) returning id", [agency, property, `tok_${id().replace(/-/g, "")}`]))!;
  return { agency, demo: row.id };
}
const summary = (d: string) => one<{ activity_level: number; activity_visitors: number }>("select activity_level, activity_visitors from demos where id=$1", [d]);
const record = (d: string, visitor: string, kind: string, internal = false) =>
  db.query("select habita_record_demo_activity($1,$2,$3,$4,$5)", [d, visitor, kind, internal, internal ? "team_session" : null]);
const internalIds = async () => new Set((await all<{ visitor_id: string }>("select visitor_id from internal_visitor_ids")).map((r) => r.visitor_id));

describe("registry", () => {
  it("starts with the three team accounts under one person, re-runnable", async () => {
    const emails = (await all<{ value: string }>("select value from internal_identities where kind='email' order by value")).map((r) => r.value);
    expect(emails).toEqual(["descstartups@gmail.com", "facundogregorini@gmail.com", "growthlabs86@gmail.com"]);
    await db.exec(readFileSync("supabase/migrations/202611230001_internal_traffic.sql", "utf8"));
    expect(Number((await one<{ c: number }>("select count(*)::int c from internal_identities"))!.c)).toBe(3);
  });

  it("resolves the accounts of the team by e-mail, any case, and only of active people", async () => {
    const team = id();
    const outsider = id();
    await db.query("insert into auth.users(id,email) values($1,'GrowthLabs86@gmail.com'),($2,'cliente@inmobiliaria.com')", [team, outsider]);
    const ids = (await all<{ u: string }>("select habita_internal_user_ids() u")).map((r) => r.u);
    expect(ids).toContain(team);
    expect(ids).not.toContain(outsider);
    await db.query("update internal_people set active=false");
    expect((await all<{ u: string }>("select habita_internal_user_ids() u")).map((r) => r.u)).not.toContain(team);
    await db.query("update internal_people set active=true");
  });

  it("keeps the e-mails out of reach of the browser roles", async () => {
    const grants = await all<{ grantee: string }>(
      "select grantee from information_schema.role_table_grants where table_name in ('internal_people','internal_identities','internal_devices','internal_fingerprints','internal_device_links') and grantee in ('anon','authenticated')",
    );
    expect(grants).toEqual([]);
  });
});

describe("demo activity", () => {
  it("stores the team's steps for QA without moving the demo's summary", async () => {
    const { demo: d } = await demo();
    await record(d, "equipo-aaaa-0001", "visita", true);
    await record(d, "equipo-aaaa-0001", "interaccion", true);
    expect(await summary(d)).toEqual({ activity_level: 0, activity_visitors: 0 });
    // The team opening its own demo does not make it «Enviada».
    expect((await one<{ sent_at: string | null }>("select sent_at from demos where id=$1", [d]))!.sent_at).toBeNull();
    await record(d, "cliente-bbbb-0001", "visita");
    expect(await summary(d)).toEqual({ activity_level: 1, activity_visitors: 1 });
    expect((await one<{ sent_at: string | null }>("select sent_at from demos where id=$1", [d]))!.sent_at).not.toBeNull();
    const rows = await all<{ visitor: string; is_internal: boolean }>("select visitor,is_internal from demo_activity where demo_id=$1 order by visitor", [d]);
    expect(rows.filter((r) => r.is_internal)).toHaveLength(2);
  });

  it("a browser of an internal device never counts, even if it reports itself as external", async () => {
    const { demo: d } = await demo();
    await db.query("insert into internal_devices(status,source,visitor_ids) values('internal','login',array['equipo-cccc-0002'])");
    await record(d, "equipo-cccc-0002", "visita");
    expect(await summary(d)).toEqual({ activity_level: 0, activity_visitors: 0 });
  });

  it("recalculates history without touching the original rows (non-destructive)", async () => {
    const { demo: d } = await demo();
    await record(d, "viejo-dddd-0003", "visita");
    await record(d, "viejo-dddd-0003", "interaccion");
    await record(d, "cliente-eeee-0003", "visita");
    expect(await summary(d)).toEqual({ activity_level: 2, activity_visitors: 2 });
    const before = await all("select * from demo_activity where demo_id=$1 order by visitor, kind", [d]);
    // Later, the team recognizes that browser as its own.
    await db.query("insert into internal_devices(status,source,visitor_ids) values('internal','backfill',array['viejo-dddd-0003'])");
    await db.query("select habita_recompute_demo_activity($1)", [d]);
    expect(await summary(d)).toEqual({ activity_level: 1, activity_visitors: 1 });
    expect(await all("select * from demo_activity where demo_id=$1 order by visitor, kind", [d])).toEqual(before);
    // Revoked (or confirmed a client): it counts again.
    await db.query("update internal_devices set status='external' where 'viejo-dddd-0003' = any(visitor_ids)");
    await db.query("select habita_recompute_demo_activity($1)", [d]);
    expect(await summary(d)).toEqual({ activity_level: 2, activity_visitors: 2 });
  });

  it("an agency claimed by a team account (QA) is not «Cuenta creada»", async () => {
    const { agency, demo: d } = await demo();
    const qa = id();
    await db.query("insert into auth.users(id,email) values($1,'descstartups@gmail.com')", [qa]);
    await db.query("insert into profiles(id) values($1) on conflict do nothing", [qa]).catch(() => undefined);
    await db.query("update agencies set owner_id=$1 where id=$2", [qa, agency]);
    await db.query("select habita_record_agency_activity($1)", [agency]);
    // Recorded as external by an older caller: the commercial view still leaves it out.
    const commercial = await all("select * from demo_activity_commercial where demo_id=$1", [d]);
    expect(commercial).toEqual([]);
    await db.query("select habita_recompute_demo_activity($1)", [d]);
    expect((await summary(d))!.activity_level).toBe(0);
  });

  it("the agency functions still work with one argument (existing callers)", async () => {
    const { agency, demo: d } = await demo();
    await db.query("select habita_record_agency_purchase($1)", [agency]);
    expect((await summary(d))!.activity_level).toBe(5);
    await db.query("select habita_record_agency_purchase($1, true)", [agency]);
  });
});

describe("internal browser ids (the definition every report shares)", () => {
  it("includes manual marks, device aliases, PostHog devices and the browsers linked to them by the lead events", async () => {
    const { demo: d } = await demo();
    await db.query("insert into lead_internal_visitors(visitor_id) values('manual-ffff-0004')");
    await db.query("insert into internal_devices(status,source,visitor_ids,ph_device_ids) values('internal','login',array['alias-gggg-0004'],array['01a1-device-0004'])");
    await db.query(
      `select habita_lead_record($1::jsonb)`,
      [JSON.stringify([{ event_id: "c:ev-int-1", event_name: "demo_opened", occurred_at: "2026-11-01T12:00:00Z", demo_id: d, visitor_id: "linked-hhhh-0004", ph_device_id: "01a1-device-0004", source: "client" }])],
    );
    const ids = await internalIds();
    for (const v of ["manual-ffff-0004", "alias-gggg-0004", "ph:01a1-device-0004", "linked-hhhh-0004"]) expect(ids.has(v)).toBe(true);
  });

  it("leaves out unknown, external and revoked devices", async () => {
    await db.query(
      "insert into internal_devices(status,source,visitor_ids) values('unknown','backfill',array['dudoso-iiii-0005']),('external','backfill',array['cliente-jjjj-0005']),('revoked','login',array['revocado-kkkk-0005'])",
    );
    const ids = await internalIds();
    expect(ids.has("dudoso-iiii-0005")).toBe(false);
    expect(ids.has("cliente-jjjj-0005")).toBe(false);
    expect(ids.has("revocado-kkkk-0005")).toBe(false);
  });
});

describe("historical reclassification", () => {
  it("registers the 56 audited devices once (all confirmed internal by the team) and is re-runnable", async () => {
    const count = async () =>
      Object.fromEntries((await all<{ status: string; c: number }>("select status, count(*)::int c from internal_devices where source='backfill' and status_reason='auditoria_2026_11_03' group by status")).map((r) => [r.status, r.c]));
    expect(await count()).toEqual({ internal: 56 });
    await db.exec(readFileSync("supabase/migrations/202611230002_internal_history.sql", "utf8"));
    expect(await count()).toEqual({ internal: 56 });
    const ids = await internalIds();
    expect(ids.has("ph:01a16fbc-616a-7399-a44a-53b8d28a39f1")).toBe(true);
    expect(ids.has("ph:01a199d2-2efc-7462-bee3-6155ec28659a")).toBe(true);
  });

  it("never deletes nor edits events: only the registry and the derived summary", () => {
    const sql = readFileSync("supabase/migrations/202611230002_internal_history.sql", "utf8").toLowerCase();
    expect(sql).not.toMatch(/\bdelete\b|\btruncate\b|update public\.(lead_events|demo_activity)/);
  });
});

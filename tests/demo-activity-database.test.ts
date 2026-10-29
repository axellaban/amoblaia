import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The activity steps of a demo, on the real migrations (PGlite). See 202611060001_demo_activity.sql.
let db: PGlite;
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(900000000000 + ++n).padStart(12, "0")}`;
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

async function demo(agencyName = "Inmobiliaria Sur") {
  const agency = (await one<{ id: string }>("insert into agencies(name) values($1) returning id", [agencyName]))!.id;
  const property = (await one<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Depto') returning id", [agency]))!.id;
  const row = (await one<{ id: string }>("insert into demos(agency_id,property_id,token) values($1,$2,$3) returning id", [agency, property, `tok_${id().replace(/-/g, "")}`]))!;
  return { agency, demo: row.id };
}
const summary = (demoId: string) =>
  one<{ activity_level: number; activity_visitors: number; activity_at: string | null }>(
    "select activity_level, activity_visitors, activity_at from demos where id=$1",
    [demoId],
  );
const record = (demoId: string, visitor: string, kind: string) =>
  db.query("select habita_record_demo_activity($1,$2,$3)", [demoId, visitor, kind]);

describe("demo activity", () => {
  it("counts a visitor once, however many times the page is reloaded", async () => {
    const { demo: d } = await demo();
    await record(d, "visitante-aaaa-1", "visita");
    await record(d, "visitante-aaaa-1", "visita");
    await record(d, "visitante-bbbb-2", "visita");
    const s = (await summary(d))!;
    expect(s.activity_level).toBe(1);
    expect(s.activity_visitors).toBe(2);
    expect(s.activity_at).not.toBeNull();
  });

  it("raises the level to the highest step reached and never lowers it", async () => {
    const { demo: d } = await demo();
    await record(d, "visitante-cccc-3", "interaccion");
    expect((await summary(d))!.activity_level).toBe(2);
    await record(d, "visitante-dddd-4", "visita");
    expect((await summary(d))!.activity_level).toBe(2);
    await record(d, "visitante-cccc-3", "descarga");
    expect((await summary(d))!.activity_level).toBe(2);
  });

  it("a download is step 2, and the agency taking its demos into its account is step 3", async () => {
    const { agency, demo: d } = await demo();
    await record(d, "visitante-eeee-5", "descarga");
    expect((await summary(d))!.activity_level).toBe(2);
    await db.query("select habita_record_agency_activity($1)", [agency]);
    const s = (await summary(d))!;
    expect(s.activity_level).toBe(3);
    // The agency's step does not count as a visitor.
    expect(s.activity_visitors).toBe(0);
  });

  it("only moves the demos of that agency to step 3", async () => {
    const a = await demo("Inmobiliaria Norte");
    const b = await demo("Inmobiliaria Oeste");
    await db.query("select habita_record_agency_activity($1)", [a.agency]);
    expect((await summary(a.demo))!.activity_level).toBe(3);
    expect((await summary(b.demo))!.activity_level).toBe(0);
  });

  it("refuses an unknown step and a visitor id out of range", async () => {
    const { demo: d } = await demo();
    await expect(record(d, "visitante-ffff-6", "compra")).rejects.toThrow();
    await expect(record(d, "", "visita")).rejects.toThrow();
    expect((await summary(d))!.activity_level).toBe(0);
  });

  it("is private: anon and authenticated cannot read the events", async () => {
    const { demo: d } = await demo();
    await record(d, "visitante-gggg-7", "visita");
    await db.exec("set role anon");
    await expect(db.query("select * from demo_activity")).rejects.toThrow();
    await db.exec("reset role");
    await db.exec("set role authenticated");
    await expect(db.query("select * from demo_activity")).rejects.toThrow();
    await db.exec("reset role");
    await expect(db.query("select * from demo_activity")).resolves.toBeDefined();
  });
});

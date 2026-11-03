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

  it("a download is step 2, and the agency taking its demos into its account is step 4", async () => {
    const { agency, demo: d } = await demo();
    await record(d, "visitante-eeee-5", "descarga");
    expect((await summary(d))!.activity_level).toBe(2);
    await db.query("select habita_record_agency_activity($1)", [agency]);
    const s = (await summary(d))!;
    expect(s.activity_level).toBe(4);
    // The agency's step does not count as a visitor.
    expect(s.activity_visitors).toBe(0);
  });

  it("only moves the demos of that agency to step 4", async () => {
    const a = await demo("Inmobiliaria Norte");
    const b = await demo("Inmobiliaria Oeste");
    await db.query("select habita_record_agency_activity($1)", [a.agency]);
    expect((await summary(a.demo))!.activity_level).toBe(4);
    expect((await summary(b.demo))!.activity_level).toBe(0);
  });

  it("refuses an unknown step and a visitor id out of range", async () => {
    const { demo: d } = await demo();
    await expect(record(d, "visitante-ffff-6", "pago")).rejects.toThrow();
    await expect(record(d, "", "visita")).rejects.toThrow();
    expect((await summary(d))!.activity_level).toBe(0);
  });

  it("generating an image is step 3, between interacting and the agency's panel", async () => {
    const { agency, demo: d } = await demo();
    await record(d, "visitante-iiii-9", "interaccion");
    await record(d, "visitante-jjjj-1", "generacion");
    expect((await summary(d))!.activity_level).toBe(3);
    await db.query("select habita_record_agency_activity($1)", [agency]);
    expect((await summary(d))!.activity_level).toBe(4);
  });

  it("a purchase of credits is step 5, the highest one", async () => {
    const { agency, demo: d } = await demo();
    await record(d, "visitante-hhhh-8", "panel");
    await db.query("select habita_record_agency_purchase($1)", [agency]);
    const s = (await summary(d))!;
    expect(s.activity_level).toBe(5);
    expect(s.activity_visitors).toBe(0);
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

// The follow-up: "Sin enviar" → "Enviada" (sent by hand or on WhatsApp) → "Ingresó" (a visit).
describe("demo sent stage", () => {
  const sentAt = (demoId: string) => one<{ sent_at: string | null }>("select sent_at from demos where id=$1", [demoId]);

  it("a new demo is not sent", async () => {
    const { demo: d } = await demo();
    expect((await sentAt(d))!.sent_at).toBeNull();
  });

  it("a visit marks it as sent when nobody did", async () => {
    const { demo: d } = await demo();
    await record(d, "visitante-eeee-5", "visita");
    expect((await sentAt(d))!.sent_at).not.toBeNull();
  });

  it("a visit keeps the date of the earlier send", async () => {
    const { demo: d } = await demo();
    await db.query("update demos set sent_at = '2026-10-01T10:00:00Z' where id=$1", [d]);
    await record(d, "visitante-ffff-6", "visita");
    expect(new Date((await sentAt(d))!.sent_at!).toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });

  it("an interaction without a visit does not mark it as sent", async () => {
    const { demo: d } = await demo();
    await record(d, "visitante-gggg-7", "interaccion");
    expect((await sentAt(d))!.sent_at).toBeNull();
  });

  it("the migration backfills visited demos as sent on their first visit, and leaves the rest unsent", async () => {
    const visited = await demo();
    const untouched = await demo();
    await record(visited.demo, "visitante-hhhh-8", "visita");
    await db.query("update demos set sent_at = null where id = any($1)", [[visited.demo, untouched.demo]]);
    await db.exec(readFileSync("supabase/migrations/202611130001_demo_sent_stage.sql", "utf8"));
    const first = (await one<{ created_at: string }>("select min(created_at) as created_at from demo_activity where demo_id=$1", [visited.demo]))!;
    expect(new Date((await sentAt(visited.demo))!.sent_at!).toISOString()).toBe(new Date(first.created_at).toISOString());
    expect((await sentAt(untouched.demo))!.sent_at).toBeNull();
  });

  it("the agency's WhatsApp is digits only and hidden from members", async () => {
    const { agency } = await demo();
    await db.query("update agencies set contact_whatsapp='5492236337191' where id=$1", [agency]);
    await expect(db.query("update agencies set contact_whatsapp='+54 9 223' where id=$1", [agency])).rejects.toThrow();
    await db.exec("set role authenticated");
    await expect(db.query("select contact_whatsapp from agencies")).rejects.toThrow();
    await db.exec("reset role");
  });
});

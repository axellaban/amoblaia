import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The gift credits a visitor spends on a demo's staging, on the real migrations (PGlite).
// See 202611070001_public_staging.sql.
let db: PGlite;
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(950000000000 + ++n).padStart(12, "0")}`;
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

/** A published demo of an agency without an account, with one photo. */
async function demo(status = "published") {
  const admin = id();
  await db.query("insert into auth.users(id) values($1)", [admin]);
  await db.query("select amobla_account($1,false)", [admin]);
  const agency = (await one<{ id: string }>("insert into agencies(name) values('Inmobiliaria Sur') returning id"))!.id;
  const property = (await one<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Depto') returning id", [agency]))!.id;
  const d = (await one<{ id: string }>("insert into demos(agency_id,property_id,token,status) values($1,$2,$3,$4) returning id", [agency, property, `tok_${id().replace(/-/g, "")}`, status]))!.id;
  const project = id();
  await db.query(
    "insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values($1,$2,$3,'a/demos/x.jpg','Foto',100)",
    [project, admin, `demo:${id()}`],
  );
  const photo = (await one<{ id: string }>("insert into demo_photos(property_id,project_id) values($1,$2) returning id", [property, project]))!.id;
  return { agency, demo: d, photo };
}
const gift = async (agency: string) => (await one<{ free_credits_pending: number }>("select free_credits_pending from agencies where id=$1", [agency]))!.free_credits_pending;
const claim = (d: string, photo: string, key: string, visitor = "visitante-aaaa-1") =>
  db.query("select habita_public_staging_claim($1,$2,$3,$4,'modern') as r", [d, visitor, key, photo]);

describe("public staging with the agency's gift credits", () => {
  it("spends one gift credit per try and reports what is left", async () => {
    const { agency, demo: d, photo } = await demo();
    const before = await gift(agency);
    const r = (await claim(d, photo, id())).rows[0] as { r: { replay: boolean; remaining: number } };
    expect(r.r).toEqual({ replay: false, remaining: before - 1 });
    expect(await gift(agency)).toBe(before - 1);
  });

  it("a repeated try with the same key spends nothing more", async () => {
    const { agency, demo: d, photo } = await demo();
    const key = id();
    await claim(d, photo, key);
    const after = await gift(agency);
    const again = (await claim(d, photo, key)).rows[0] as { r: { replay: boolean } };
    expect(again.r.replay).toBe(true);
    expect(await gift(agency)).toBe(after);
  });

  it("refuses when the gift credits are used up", async () => {
    const { agency, demo: d, photo } = await demo();
    await db.query("update agencies set free_credits_pending = 0 where id=$1", [agency]);
    await expect(claim(d, photo, id())).rejects.toThrow("NO_GIFT_CREDITS");
  });

  it("refuses once the agency has its account: its owner's credits pay from then on", async () => {
    const { agency, demo: d, photo } = await demo();
    const owner = id();
    await db.query("insert into auth.users(id) values($1)", [owner]);
    await db.query("select amobla_account($1,false)", [owner]);
    await db.query("update agencies set owner_id=$1 where id=$2", [owner, agency]);
    await expect(claim(d, photo, id())).rejects.toThrow("AGENCY_CLAIMED");
  });

  it("refuses a demo that is not published", async () => {
    const { demo: d, photo } = await demo("draft");
    await expect(claim(d, photo, id())).rejects.toThrow("DEMO_NOT_PUBLISHED");
  });

  it("refunds the credit of a try that could not start, once", async () => {
    const { agency, demo: d, photo } = await demo();
    const key = id();
    const before = await gift(agency);
    await claim(d, photo, key);
    await db.query("select habita_public_staging_refund($1)", [key]);
    await db.query("select habita_public_staging_refund($1)", [key]);
    expect(await gift(agency)).toBe(before);
  });
});

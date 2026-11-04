import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const credits = async (user: string) =>
  (await one<{ credits: number }>("select (amobla_account($1,false)->>'credits')::int as credits", [user]))!.credits;
async function user() {
  const u = id();
  await db.query("insert into auth.users(id) values($1)", [u]);
  await db.query("select amobla_account($1,false)", [u]);
  return u;
}
const monthly = async (u: string) =>
  (await db.query<{ total: number; remaining: number; expires_at: string }>(
    "select total,remaining,expires_at from credit_grants where user_id=$1 and source_key like 'free-month:%'",
    [u],
  )).rows;

describe("Simplified credit packs", () => {
  it("sells exactly four packs, with server-side prices", async () => {
    const rows = (await db.query<{ sku: string; photos: number; price_cents: string; valid_days: number }>(
      "select sku,photos,price_cents,valid_days from products where active order by photos",
    )).rows;
    expect(rows.map((r) => [r.sku, r.photos, Number(r.price_cents)])).toEqual([
      ["pack-10", 10, 990000],
      ["pack-25", 25, 1990000],
      ["pack-50", 50, 3490000],
      ["pack-100", 100, 5990000],
    ]);
    expect(rows.every((r) => r.valid_days === 365)).toBe(true);
  });
  it("keeps the retired plans in the catalog, inactive, so their history survives", async () => {
    const row = await one<{ active: boolean }>("select active from products where sku='professional-month'");
    expect(row?.active).toBe(false);
  });
  it("does not let an order be created for a retired plan", async () => {
    const u = await user();
    await expect(db.query("select amobla_create_order($1,$2,'basic-month')", [u, id()])).rejects.toThrow();
  });
  it("creates an order for a pack with the catalog price snapshot", async () => {
    const u = await user();
    const r = await one<{ o: { order: { snapshot: { price_cents: number; photos: number } } } }>(
      "select amobla_create_order($1,$2,'pack-25') as o",
      [u, id()],
    );
    expect(r!.o.order.snapshot.price_cents).toBe(1990000);
    expect(r!.o.order.snapshot.photos).toBe(25);
  });
});

describe("Plan Gratis: 10 créditos por mes", () => {
  it("gives a verified agency owner 10 credits once per month, expiring at month end", async () => {
    const owner = await user();
    await db.query("select habita_create_agency($1,'Sur Propiedades','sur-propiedades')", [owner]);
    const before = await credits(owner);
    await credits(owner);
    await credits(owner);
    const grants = await monthly(owner);
    expect(grants).toHaveLength(1);
    expect(grants[0].total).toBe(10);
    expect(new Date(grants[0].expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(grants[0].expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 32 * 86400e3);
    // Welcome credits (10) + this month's (10).
    expect(before).toBe(20);
    const ledger = await one<{ c: string }>("select count(*) c from credit_ledger where user_id=$1 and reason='free_monthly'", [owner]);
    expect(Number(ledger!.c)).toBe(1);
  });
  it("gives nothing to accounts without a verified agency", async () => {
    const u = await user();
    expect(await credits(u)).toBe(0);
    expect(await monthly(u)).toHaveLength(0);
  });
  it("waits while the agency's claim is under review", async () => {
    const owner = await user();
    const agency = (await one<{ id: string }>("insert into agencies(name,owner_id,claimed_at,claim_review) values('Norte',$1,now(),'mismatch') returning id", [owner]))!.id;
    await credits(owner);
    expect(await monthly(owner)).toHaveLength(0);
    await db.query("update agencies set claim_review='confirmed' where id=$1", [agency]);
    await credits(owner);
    expect(await monthly(owner)).toHaveLength(1);
  });
  it("is spent before purchased credits, which last longer", async () => {
    const owner = await user();
    await db.query("insert into agencies(name,owner_id,claimed_at) values('Oeste',$1,now())", [owner]);
    await credits(owner);
    await db.query(
      "insert into credit_grants(user_id,source_key,total,remaining,starts_at,expires_at) values($1,$2,25,25,now(),now()+interval '365 days')",
      [owner, `test:${id()}`],
    );
    const next = await one<{ source_key: string }>(
      "select source_key from credit_grants where user_id=$1 and remaining>0 and not revoked and starts_at<=now() and (expires_at is null or expires_at>now()) order by expires_at nulls last,created_at limit 1",
      [owner],
    );
    expect(next!.source_key.startsWith("free-month:")).toBe(true);
    expect(await credits(owner)).toBe(35);
  });
  it("does not accumulate: last month's grant no longer counts", async () => {
    const owner = await user();
    await db.query("insert into agencies(name,owner_id,claimed_at) values('Este',$1,now())", [owner]);
    await db.query(
      "insert into credit_grants(user_id,source_key,total,remaining,starts_at,expires_at) values($1,$2,10,10,now()-interval '40 days',now()-interval '1 day')",
      [owner, `free-month:${owner}:2000-01`],
    );
    expect(await credits(owner)).toBe(10);
  });
});

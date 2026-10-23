import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
let db: PGlite;
let next = 0;
const id = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];
async function buyer() {
  const user = id();
  await db.exec(`insert into auth.users values('${user}')`);
  await db.query("select amobla_account($1,false)", [user]);
  return user;
}
async function order(user: string, sku: string, key = id()) {
  const r = await one<{
    o: { order: { id: string }; dispatch: boolean };
  }>("select amobla_create_order($1,$2,$3) as o", [user, key, sku]);
  return { id: r!.o.order.id, dispatch: r!.o.dispatch };
}
const apply = (
  payment: string,
  o: string,
  status: string,
  amount: number,
  sub: string | null,
  at = "now()",
) =>
  db.query(`select amobla_apply_payment($1,$2,$3,$4,${at},$5)`, [
    payment,
    o,
    status,
    amount,
    sub,
  ]);
const status = async (payment: string) =>
  (await one<{ s: string }>("select status as s from payments where id=$1", [
    payment,
  ]))!.s;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage;
 create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid,name text,bucket_id text); alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}, 30000);
afterAll(async () => await db?.close());

it("re-running the launch pricing keeps the window, prices and plans", async () => {
  await db.exec(
    "update products set promo_ends_at='2026-10-25', price_cents=4000000, active=false where sku='basic-month'",
  );
  await db.exec(
    readFileSync("supabase/migrations/202610230001_launch_pricing.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/202610230002_billing_audit.sql", "utf8"),
  );
  const row = await one<{ e: string; p: number; a: boolean }>(
    "select promo_ends_at::date::text as e, price_cents::int as p, active as a from products where sku='basic-month'",
  );
  expect(row).toEqual({ e: "2026-10-25", p: 4000000, a: false });
  await db.exec(
    "update products set promo_ends_at=now()+interval '72 hours', price_cents=3890000, active=true where sku='basic-month'",
  );
});

it("reuses an open checkout of a one-per-account pack", async () => {
  const user = await buyer();
  const first = await order(user, "pack-first");
  // A second tab while the first is still being created waits for it.
  expect(await order(user, "pack-first")).toEqual({
    id: first.id,
    dispatch: false,
  });
  await db.exec(
    `update orders set status='checkout_ready', checkout_url='https://www.mercadopago.com.ar/checkout/x' where id='${first.id}'`,
  );
  const second = await order(user, "pack-first");
  expect(second).toEqual({ id: first.id, dispatch: false });
});

it("does not grant a second one-per-account pack paid through another order", async () => {
  const user = await buyer();
  // An old checkout that never became ready, a new one, then both paid.
  const a = await order(user, "pack-first");
  await db.exec(
    `update orders set created_at=now()-interval '10 minutes' where id='${a.id}'`,
  );
  const b = await order(user, "pack-first");
  expect(a.id).not.toBe(b.id);
  await apply("first-a", a.id, "approved", 499000, null);
  await apply("first-b", b.id, "approved", 499000, null);
  expect(await status("first-b")).toBe("duplicate");
  const photos = await one<{ n: number }>(
    "select coalesce(sum(total),0)::int as n from credit_grants where user_id=$1",
    [user],
  );
  expect(photos!.n).toBe(5);
  // The extra order is closed, so the account never offers to pay it again.
  const closed = await one<{ s: string }>(
    "select status as s from orders where id=$1",
    [b.id],
  );
  expect(closed!.s).toBe("cancelled");
  // The app refunds it; the refund notice records that it was given back.
  await apply("first-b", b.id, "refunded", 499000, null);
  expect(await status("first-b")).toBe("duplicate_refunded");
  const still = await one<{ n: number }>(
    "select coalesce(sum(total),0)::int as n from credit_grants where user_id=$1 and not revoked",
    [user],
  );
  expect(still!.n).toBe(5);
});

it("a refunded charge gives back the period it paid for", async () => {
  const user = await buyer();
  const o = await order(user, "standard-month");
  await db.exec(
    `update orders set provider_subscription_id='sub-audit' where id='${o.id}'`,
  );
  await apply("ren-1", o.id, "approved", 5390000, "sub-audit", "'2026-09-01'");
  await apply("ren-2", o.id, "approved", 5390000, "sub-audit", "'2026-10-01'");
  const until = async () =>
    (await one<{ d: string }>(
      "select paid_until::date::text as d from subscriptions where id='sub-audit'",
    ))!.d;
  expect(await until()).toBe("2026-11-01");
  // Refunding the older charge does not shorten the current period.
  await apply("ren-1", o.id, "refunded", 5390000, "sub-audit");
  expect(await until()).toBe("2026-11-01");
  // Refunding the latest one ends the period where it started.
  await apply("ren-2", o.id, "refunded", 5390000, "sub-audit");
  expect(await until()).toBe("2026-10-01");
  const reversed = await db.query<{ r: string }>(
    "select r from amobla_reversed_subscriptions(50) r",
  );
  expect(reversed.rows.map((r) => r.r)).toContain("sub-audit");
});

it("keeps granting the months of a partially refunded annual plan", async () => {
  const user = await buyer();
  const o = await order(user, "basic-year");
  await db.exec(
    `update orders set provider_subscription_id='sub-year' where id='${o.id}'`,
  );
  await apply(
    "year-1",
    o.id,
    "approved",
    29690000,
    "sub-year",
    "now()-interval '40 days'",
  );
  await apply("year-1", o.id, "partially_refunded", 29690000, "sub-year");
  // As if this month had not been granted yet when the refund arrived.
  await db.exec(
    "delete from credit_ledger where grant_id in (select id from credit_grants where payment_id='year-1'); delete from credit_grants where payment_id='year-1'",
  );
  await db.query("select amobla_refresh_annual($1)", [user]);
  const live = await one<{ n: number }>(
    "select count(*)::int as n from credit_grants where payment_id='year-1' and starts_at<=now() and expires_at>now()",
  );
  expect(live!.n).toBe(1);
});

it("lists launch-price subscriptions once due, until their list price is confirmed", async () => {
  const user = await buyer();
  const o = await order(user, "basic-month");
  await db.exec(
    `update orders set provider_subscription_id='sub-promo' where id='${o.id}'`,
  );
  const listed = async () =>
    (
      await db.query<{ id: string }>(
        "select id from amobla_promo_subscriptions(50)",
      )
    ).rows.map((r) => r.id);
  await apply("promo-1", o.id, "approved", 1990000, "sub-promo");
  // Not due while launch-price charges remain.
  expect(await listed()).not.toContain("sub-promo");
  await apply("promo-2", o.id, "approved", 1990000, "sub-promo");
  await apply("promo-3", o.id, "approved", 1990000, "sub-promo");
  expect(await listed()).toContain("sub-promo");
  await db.exec(
    "update subscriptions set list_price_restored_at=now() where id='sub-promo'",
  );
  expect(await listed()).not.toContain("sub-promo");
});

it("a refund of the first of two charges of one renewal keeps the month paid once", async () => {
  const user = await buyer();
  const o = await order(user, "standard-month");
  await db.exec(
    `update orders set provider_subscription_id='sub-twin' where id='${o.id}'`,
  );
  await apply(
    "twin-a",
    o.id,
    "approved",
    5390000,
    "sub-twin",
    "now()-interval '5 days'",
  );
  await apply(
    "twin-b",
    o.id,
    "approved",
    5390000,
    "sub-twin",
    "now()-interval '5 days'+interval '1 hour'",
  );
  // Photos of the first charge were used, and a project relies on its grant.
  await db.exec(
    "update credit_grants set remaining=remaining-3 where payment_id='twin-a'",
  );
  const project = id();
  await db.query(
    "insert into projects(id,user_id,original_hash,original_path,name,original_bytes,grant_id) select $1,$2,'h','p','n',1,id from credit_grants where payment_id='twin-a'",
    [project, user],
  );
  await apply("twin-a", o.id, "refunded", 5390000, "sub-twin");
  const live = await one<{ n: number; r: number }>(
    "select count(*)::int as n, sum(remaining)::int as r from credit_grants where user_id=$1 and not revoked and starts_at<=now() and expires_at>now()",
    [user],
  );
  // One month of photos, with the three already used carried over.
  expect(live).toEqual({ n: 1, r: 17 });
  const blocked = await one<{ b: boolean }>(
    "select blocked as b from profiles where id=$1",
    [user],
  );
  expect(blocked!.b).toBe(false);
  const grant = await one<{ p: string }>(
    "select g.payment_id as p from projects j join credit_grants g on g.id=j.grant_id where j.id=$1",
    [project],
  );
  expect(grant!.p).toBe("twin-b");
  const until = await one<{ ok: boolean }>(
    "select abs(extract(epoch from paid_until-(now()-interval '5 days'+interval '1 month')))<60 as ok from subscriptions where id='sub-twin'",
  );
  expect(until!.ok).toBe(true);
});

it("the daily sweep lists a plan whose latest charge was refunded", async () => {
  const user = await buyer();
  const o = await order(user, "standard-month");
  await db.exec(
    `update orders set provider_subscription_id='sub-late' where id='${o.id}'`,
  );
  await apply("late-1", o.id, "approved", 5390000, "sub-late", "'2026-08-01'");
  await apply("late-2", o.id, "approved", 5390000, "sub-late", "'2026-09-01'");
  await apply("late-2", o.id, "refunded", 5390000, "sub-late");
  const ids = (
    await db.query<{ r: string }>(
      "select r from amobla_reversed_subscriptions(50) r",
    )
  ).rows.map((r) => r.r);
  expect(ids).toContain("sub-late");
});

it("a chargeback of a duplicate records the money as given back", async () => {
  const user = await buyer();
  const a = await order(user, "pack-first");
  await db.exec(
    `update orders set created_at=now()-interval '10 minutes' where id='${a.id}'`,
  );
  const b = await order(user, "pack-first");
  await apply("cb-a", a.id, "approved", 499000, null);
  await apply("cb-b", b.id, "approved", 499000, null);
  await apply("cb-b", b.id, "charged_back", 499000, null);
  expect(await status("cb-b")).toBe("duplicate_refunded");
});

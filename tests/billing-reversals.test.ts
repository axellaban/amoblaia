import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
let db: PGlite;
const user = "00000000-0000-4000-8000-000000000071",
  sub = "00000000-0000-4000-8000-000000000072",
  pack = "00000000-0000-4000-8000-000000000073";
const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];
const apply = (id: string, status: string, order = sub, s = "sub-r") =>
  db.query("select amobla_apply_payment($1,$2,$3,2000000,now(),$4)", [
    id,
    order,
    status,
    s,
  ]);
const blocked = async () =>
  (await one<{ b: boolean }>("select blocked as b from profiles where id=$1", [
    user,
  ]))!.b;
const liveGrants = async (payment: string) =>
  (await one<{ n: number }>(
    "select count(*)::int as n from credit_grants where payment_id=$1 and not revoked",
    [payment],
  ))!.n;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage;
 create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid,name text,bucket_id text); alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 insert into auth.users values('${user}');`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("select amobla_account($1,false)", [user]);
  await db.query("select amobla_create_order($1,$2,'basic-month')", [
    user,
    sub,
  ]);
  await db.exec(
    `update orders set provider_subscription_id='sub-r' where id='${sub}'`,
  );
}, 30000);
afterAll(async () => await db?.close());

it("blocks during a mediation and restores everything when the seller wins it", async () => {
  await apply("pay-m", "approved");
  await apply("pay-m", "in_mediation");
  expect(await blocked()).toBe(true);
  // The photos are kept while the dispute is open.
  expect(await liveGrants("pay-m")).toBe(1);
  await apply("pay-m", "approved");
  expect(await blocked()).toBe(false);
  expect(
    (await one<{ s: string }>(
      "select status as s from payments where id='pay-m'",
    ))!.s,
  ).toBe("approved");
});

it("keeps photos and access after a goodwill partial refund", async () => {
  await apply("pay-m", "partially_refunded");
  expect(await blocked()).toBe(false);
  expect(await liveGrants("pay-m")).toBe(1);
  // An older 'approved' notification does not undo the partial refund.
  await apply("pay-m", "approved");
  expect(
    (await one<{ s: string }>(
      "select status as s from payments where id='pay-m'",
    ))!.s,
  ).toBe("partially_refunded");
});

it("still revokes and blocks on a chargeback, for good", async () => {
  await apply("pay-m", "charged_back");
  expect(await blocked()).toBe(true);
  expect(await liveGrants("pay-m")).toBe(0);
  await apply("pay-m", "approved");
  expect(await blocked()).toBe(true);
});

it("records a second payment on the same pack instead of losing it", async () => {
  await db.exec(
    `update profiles set blocked=false where id='${user}'; update products set active=true,price_cents=2000000 where sku='pack-10'`,
  );
  await db.query("select amobla_create_order($1,$2,'pack-10')", [user, pack]);
  await apply("pay-p1", "approved", pack, null as unknown as string);
  await apply("pay-p2", "approved", pack, null as unknown as string);
  const rows = (
    await db.query<{ id: string; status: string }>(
      "select id,status from payments where order_id=$1 order by id",
      [pack],
    )
  ).rows;
  expect(rows).toEqual([
    { id: "pay-p1", status: "approved" },
    { id: "pay-p2", status: "duplicate" },
  ]);
  expect(await liveGrants("pay-p2")).toBe(0);
});

it("counts failed notification attempts", async () => {
  await db.exec(
    "insert into webhook_events(event_key,topic,resource_id) values('k','payment','1')",
  );
  await db.query("select amobla_inbox_failed('k','MERCADOPAGO_500')");
  await db.query("select amobla_inbox_failed('k','MERCADOPAGO_500')");
  expect(
    await one(
      "select attempts,last_error from webhook_events where event_key='k'",
    ),
  ).toEqual({ attempts: 2, last_error: "MERCADOPAGO_500" });
});

it("credits a payment whose first notification was a partial refund", async () => {
  const order = "00000000-0000-4000-8000-000000000074";
  await db.exec(
    `update profiles set blocked=false where id='${user}'; update subscriptions set status='cancelled' where user_id='${user}'`,
  );
  await db.query("select amobla_create_order($1,$2,'basic-month')", [
    user,
    order,
  ]);
  await db.exec(
    `update orders set provider_subscription_id='sub-p' where id='${order}'`,
  );
  await apply("pay-first-partial", "partially_refunded", order, "sub-p");
  expect(await liveGrants("pay-first-partial")).toBe(1);
  await apply("pay-first-partial", "approved", order, "sub-p");
  expect(await liveGrants("pay-first-partial")).toBe(1);
});

it("unblocks when a mediation that came first is resolved for the seller", async () => {
  // A separate account: the one above keeps an old chargeback on purpose.
  const buyer = "00000000-0000-4000-8000-000000000076",
    order = "00000000-0000-4000-8000-000000000075";
  await db.exec(`insert into auth.users values('${buyer}')`);
  await db.query("select amobla_account($1,false)", [buyer]);
  await db.query("select amobla_create_order($1,$2,'basic-month')", [
    buyer,
    order,
  ]);
  await db.exec(
    `update orders set provider_subscription_id='sub-q' where id='${order}'`,
  );
  const isBlocked = async () =>
    (await one<{ b: boolean }>(
      "select blocked as b from profiles where id=$1",
      [buyer],
    ))!.b;
  await apply("pay-first-mediation", "in_mediation", order, "sub-q");
  expect(await isBlocked()).toBe(true);
  await apply("pay-first-mediation", "approved", order, "sub-q");
  expect(await isBlocked()).toBe(false);
  expect(await liveGrants("pay-first-mediation")).toBe(1);
});

async function buyer(n: number, sku = "basic-month") {
  const person = `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
    order = `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
  await db.exec(`insert into auth.users values('${person}')`);
  await db.query("select amobla_account($1,false)", [person]);
  await db.query("select amobla_create_order($1,$2,$3)", [person, order, sku]);
  await db.exec(
    `update orders set provider_subscription_id='sub-${n}' where id='${order}'`,
  );
  const price = (await one<{ p: string }>(
    "select snapshot->>'price_cents' as p from orders where id=$1",
    [order],
  ))!.p;
  const pay = (id: string, status: string) =>
    db.query("select amobla_apply_payment($1,$2,$3,$4,now(),$5)", [
      id,
      order,
      status,
      price,
      `sub-${n}`,
    ]);
  const isBlocked = async () =>
    (await one<{ b: boolean }>(
      "select blocked as b from profiles where id=$1",
      [person],
    ))!.b;
  return { person, order, pay, isBlocked };
}

it("keeps granting an annual plan's monthly photos after a partial refund", async () => {
  const { person, pay } = await buyer(1, "basic-year");
  await pay("pay-year", "approved");
  await pay("pay-year", "partially_refunded");
  // A month later the second month's photos still arrive.
  await db.exec(
    "update payments set coverage_start=now()-interval '32 days',coverage_end=now()+interval '330 days' where id='pay-year'",
  );
  await db.query("select amobla_refresh_annual($1)", [person]);
  expect(
    await one(
      "select count(*)::int as n from credit_grants where source_key='pay-year:1' and not revoked",
    ),
  ).toEqual({ n: 1 });
});

it("ignores a stale 'in_process' that arrives after the approval", async () => {
  const { pay } = await buyer(2);
  await pay("pay-late", "approved");
  await pay("pay-late", "in_process");
  expect(
    (await one<{ s: string }>(
      "select status as s from payments where id='pay-late'",
    ))!.s,
  ).toBe("approved");
  expect(await liveGrants("pay-late")).toBe(1);
});

it("unblocks when a mediation ends in a partial refund", async () => {
  const { pay, isBlocked } = await buyer(3);
  await pay("pay-mp", "approved");
  await pay("pay-mp", "in_mediation");
  expect(await isBlocked()).toBe(true);
  await pay("pay-mp", "partially_refunded");
  expect(await isBlocked()).toBe(false);
  expect(await liveGrants("pay-mp")).toBe(1);
});

it("unblocks when a mediation ends in a full refund of unused photos", async () => {
  const { pay, isBlocked } = await buyer(4);
  await pay("pay-mr", "approved");
  await pay("pay-mr", "in_mediation");
  await pay("pay-mr", "refunded");
  expect(await isBlocked()).toBe(false);
  expect(await liveGrants("pay-mr")).toBe(0);
});

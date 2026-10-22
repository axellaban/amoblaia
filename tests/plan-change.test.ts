import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
let db: PGlite;
const user = "00000000-0000-4000-8000-000000000061",
  current = "00000000-0000-4000-8000-000000000062";
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
    current,
  ]);
  await db.exec(
    `update orders set status='checkout_ready',provider_subscription_id='sub-basic' where id='${current}';
     insert into subscriptions(id,order_id,user_id,status) values('sub-basic','${current}','${user}','authorized');`,
  );
}, 30000);
afterAll(async () => await db?.close());
const order = (id: string, replace?: boolean) =>
  db.query<{ r: { dispatch: boolean } }>(
    replace === undefined
      ? "select amobla_create_order($1,$2,'professional-month') as r"
      : "select amobla_create_order($1,$2,'professional-month',$3) as r",
    replace === undefined ? [user, id] : [user, id, replace],
  );
it("keeps blocking a second subscription unless the order replaces the current one", async () => {
  await expect(order("00000000-0000-4000-8000-000000000063")).rejects.toThrow(
    "SUBSCRIPTION_EXISTS",
  );
  const r = await order("00000000-0000-4000-8000-000000000064", true);
  expect(r.rows[0].r.dispatch).toBe(true);
});
it("never runs two plan changes at once", async () => {
  // The previous change is still being created.
  await expect(
    order("00000000-0000-4000-8000-000000000065", true),
  ).rejects.toThrow("SUBSCRIPTION_EXISTS");
});
it("is not callable by browser roles", async () => {
  const r = await db.query<{ allowed: boolean }>(
    "select has_function_privilege('authenticated','amobla_create_order(uuid,uuid,text,boolean)','execute') as allowed",
  );
  expect(r.rows[0].allowed).toBe(false);
});
it("binds the replacement atomically and keeps the current plan during an abandoned checkout", async () => {
  const changed = "00000000-0000-4000-8000-000000000064";
  const rows = await db.query<{ replaces_subscription_id: string }>(
    "select replaces_subscription_id from orders where id=$1",
    [changed],
  );
  expect(rows.rows[0].replaces_subscription_id).toBe("sub-basic");
  await db.query(
    "update orders set status='checkout_ready',provider_subscription_id='sub-new' where id=$1",
    [changed],
  );
  await expect(
    order("00000000-0000-4000-8000-000000000066", true),
  ).rejects.toThrow("SUBSCRIPTION_EXISTS");
  const active = await db.query<{ status: string }>(
    "select status from subscriptions where id='sub-basic'",
  );
  expect(active.rows[0].status).toBe("authorized");
});

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
let db: PGlite;
let next = 0;
const id = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
async function buyer() {
  const user = id();
  await db.exec(`insert into auth.users values('${user}')`);
  await db.query("select amobla_account($1,false)", [user]);
  return user;
}
async function order(user: string, sku: string) {
  const o = id();
  const { rows } = await db.query<{
    amobla_create_order: { order: { snapshot: Record<string, unknown> } };
  }>("select amobla_create_order($1,$2,$3)", [user, o, sku]);
  return { id: o, snapshot: rows[0].amobla_create_order.order.snapshot };
}
const pay = (payment: string, o: string, amount: number, sub: string | null) =>
  db.query("select amobla_apply_payment($1,$2,'approved',$3,now(),$4)", [
    payment,
    o,
    amount,
    sub,
  ]);
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

describe("Launch price on monthly plans", () => {
  it("keeps the launch price in an order created while the window is open", async () => {
    const { snapshot } = await order(await buyer(), "standard-month");
    expect(snapshot).toMatchObject({
      price_cents: 5390000,
      promo_price_cents: 2690000,
      promo_months: 3,
    });
  });

  it("credits charges at the launch or the list amount, and nothing else", async () => {
    const user = await buyer();
    const o = await order(user, "basic-month");
    await db.query(
      "update orders set provider_subscription_id='sub-launch' where id=$1",
      [o.id],
    );
    await pay("launch-1", o.id, 1990000, "sub-launch");
    await pay("launch-4", o.id, 3890000, "sub-launch");
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from credit_grants where user_id=$1",
      [user],
    );
    expect(rows[0].n).toBe(2);
    await expect(pay("launch-x", o.id, 2000000, "sub-launch")).rejects.toThrow(
      /AMOUNT_MISMATCH/,
    );
  });

  it("never offers it on annual plans or after the window closes", async () => {
    const annual = await order(await buyer(), "standard-year");
    expect(annual.snapshot).not.toHaveProperty("promo_price_cents");
    await db.exec(
      "update products set promo_ends_at=now()-interval '1 minute' where sku='professional-month'",
    );
    const late = await order(await buyer(), "professional-month");
    expect(late.snapshot).not.toHaveProperty("promo_price_cents");
    await db.query(
      "update orders set provider_subscription_id='sub-late' where id=$1",
      [late.id],
    );
    await expect(pay("late-1", late.id, 5990000, "sub-late")).rejects.toThrow(
      /AMOUNT_MISMATCH/,
    );
  });

  it("rejects a launch price that is not below the list price", async () => {
    await expect(
      db.exec(
        "update products set promo_price_cents=price_cents where sku='enterprise-month'",
      ),
    ).rejects.toThrow(/products_promo_below_price/);
  });
});

describe("Primera propiedad pack", () => {
  it("is sold once per account and its photos last 30 days", async () => {
    const user = await buyer();
    const abandoned = await order(user, "pack-first");
    // An unpaid checkout does not use up the offer.
    const first = await order(user, "pack-first");
    expect(abandoned.id).not.toBe(first.id);
    await pay("first-1", first.id, 499000, null);
    const { rows } = await db.query<{ total: number; days: number }>(
      "select total, round(extract(epoch from expires_at-starts_at)/86400)::int as days from credit_grants where payment_id='first-1'",
    );
    expect(rows[0]).toEqual({ total: 5, days: 30 });
    await expect(order(user, "pack-first")).rejects.toThrow(/PURCHASE_LIMIT/);
  });

  it("keeps older packs without an expiry", async () => {
    const user = await buyer();
    await db.exec(
      "update products set active=true,price_cents=1000000 where sku='pack-10'",
    );
    const pack = await order(user, "pack-10");
    await pay("ten-1", pack.id, 1000000, null);
    const { rows } = await db.query<{ expires_at: string | null }>(
      "select expires_at from credit_grants where payment_id='ten-1'",
    );
    expect(rows[0].expires_at).toBeNull();
  });
});

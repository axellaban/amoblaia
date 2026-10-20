import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
let db: PGlite;
const user = "00000000-0000-4000-8000-000000000003";
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
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("Launch catalog", () => {
  it("publishes every plan with a price and keeps packs unpublished", async () => {
    const { rows } = await db.query<{
      sku: string;
      kind: string;
      photos: number;
      price_cents: string;
      active: boolean;
    }>("select sku,kind,photos,price_cents,active from products");
    expect(rows).toHaveLength(10);
    for (const p of rows) {
      expect(p.active).toBe(p.kind !== "pack");
      if (p.active) expect(Number(p.price_cents)).toBeGreaterThanOrEqual(100);
    }
    const price = (sku: string) =>
      Number(rows.find((p) => p.sku === sku)!.price_cents);
    for (const tier of ["basic", "standard", "professional", "enterprise"]) {
      // The annual plan must always be cheaper than twelve monthly charges.
      expect(price(`${tier}-year`)).toBeLessThan(price(`${tier}-month`) * 12);
    }
  });
  it("lets checkout create an order for a published plan", async () => {
    await db.query("select amobla_account($1,false)", [user]);
    const order = await db.query<{ amobla_create_order: unknown }>(
      "select amobla_create_order($1,$2,$3)",
      [user, "00000000-0000-4000-8000-0000000000aa", "standard-month"],
    );
    expect(JSON.stringify(order.rows[0])).toContain("2700000");
  });
  it("grants each plan's monthly quota without stacking renewals", async () => {
    const buyer = "00000000-0000-4000-8000-000000000004";
    const order = "00000000-0000-4000-8000-0000000000bb";
    await db.exec(`insert into auth.users values('${buyer}')`);
    await db.query("select amobla_account($1,false)", [buyer]);
    await db.query("select amobla_create_order($1,$2,$3)", [
      buyer,
      order,
      "professional-month",
    ]);
    await db.query(
      "update orders set provider_subscription_id='sub-pro' where id=$1",
      [order],
    );
    const credits = async () =>
      (
        await db.query<{ amobla_account: { credits: number } }>(
          "select amobla_account($1,false)",
          [buyer],
        )
      ).rows[0].amobla_account.credits;
    const pay = (id: string) =>
      db.query(
        "select amobla_apply_payment($1,$2,'approved',6000000,now(),'sub-pro')",
        [id, order],
      );
    await pay("pay-1");
    expect(await credits()).toBe(60);
    // An early renewal covers the next month instead of adding photos now.
    await pay("pay-2");
    expect(await credits()).toBe(60);
    await pay("pay-2");
    expect(await credits()).toBe(60);
    // A renewal for another amount is rejected.
    await expect(
      db.query(
        "select amobla_apply_payment('pay-3',$1,'approved',100,now(),'sub-pro')",
        [order],
      ),
    ).rejects.toThrow(/AMOUNT_MISMATCH/);
  });
});

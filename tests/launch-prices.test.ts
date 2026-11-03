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
  it("publishes every plan with a price and every pack but the old 25", async () => {
    const { rows } = await db.query<{
      sku: string;
      kind: string;
      photos: number;
      price_cents: string;
      active: boolean;
    }>("select sku,kind,photos,price_cents,active from products");
    expect(rows).toHaveLength(19);
    for (const p of rows) {
      expect(p.active).toBe(p.sku !== "pack-25");
      if (p.active) expect(Number(p.price_cents)).toBeGreaterThanOrEqual(100);
    }
    const price = (sku: string) =>
      Number(rows.find((p) => p.sku === sku)!.price_cents);
    for (const tier of ["basic", "standard", "professional", "enterprise"]) {
      // The annual plan must always be cheaper than twelve monthly charges.
      expect(price(`${tier}-year`)).toBeLessThan(price(`${tier}-month`) * 12);
    }
    // Credits get cheaper with volume, reach $900 each from 250 on, and always
    // cost more per photo than the monthly plan with the same allowance.
    const credits = rows
      .filter((p) => p.kind === "pack" && p.active && p.sku !== "pack-first")
      .sort((a, b) => a.photos - b.photos);
    const unit = (p: (typeof rows)[number]) => Number(p.price_cents) / p.photos;
    for (let i = 1; i < credits.length; i++) {
      expect(unit(credits[i])).toBeLessThanOrEqual(unit(credits[i - 1]));
      expect(Number(credits[i].price_cents)).toBeGreaterThan(
        Number(credits[i - 1].price_cents),
      );
    }
    expect(unit(credits.find((p) => p.photos === 250)!)).toBe(90000);
    for (const [tier, photos] of [["standard", 20], ["professional", 60], ["enterprise", 150]] as const)
      expect(price(`${tier}-month`) / photos).toBeLessThan(
        unit(credits.find((p) => p.photos === photos)!),
      );
  });
  it("lets checkout create an order for a published plan", async () => {
    await db.query("select amobla_account($1,false)", [user]);
    const order = await db.query<{ amobla_create_order: unknown }>(
      "select amobla_create_order($1,$2,$3)",
      [user, "00000000-0000-4000-8000-0000000000aa", "standard-month"],
    );
    expect(JSON.stringify(order.rows[0])).toContain("4890000");
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
        "select amobla_apply_payment($1,$2,'approved',8690000,now(),'sub-pro')",
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
  it("spends paid photos before the free one", async () => {
    const buyer = "00000000-0000-4000-8000-000000000005";
    const order = "00000000-0000-4000-8000-0000000000cc";
    const project = "00000000-0000-4000-8000-0000000000dd";
    await db.exec(`insert into auth.users values('${buyer}')`);
    await db.query("select amobla_account($1,true)", [buyer]);
    await db.query("select amobla_create_order($1,$2,'basic-month')", [
      buyer,
      order,
    ]);
    await db.query(
      "update orders set provider_subscription_id='sub-basic' where id=$1",
      [order],
    );
    await db.query(
      "select amobla_apply_payment('pay-basic',$1,'approved',2590000,now(),'sub-basic')",
      [order],
    );
    await db.query(
      "insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values($1,$2,'h','p','n',1)",
      [project, buyer],
    );
    await db.query(
      "select amobla_reserve_generation($1,$2,gen_random_uuid(),'living','modern','furnish','','prompt')",
      [buyer, project],
    );
    const { rows } = await db.query<{ source_key: string }>(
      "select g.source_key from projects p join credit_grants g on g.id=p.grant_id where p.id=$1",
      [project],
    );
    expect(rows[0].source_key).not.toMatch(/^trial:/);
  });
});

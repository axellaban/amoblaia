import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
let db: PGlite;
const user = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
async function scalar<T>(sql: string, params: unknown[] = []) {
  return (await db.query<Record<string, T>>(sql, params)).rows[0];
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage;
 create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid,name text,bucket_id text); alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 insert into auth.users values('${user}'),('${other}');`);
  await db.exec(
    readFileSync("supabase/migrations/202610200001_commerce.sql", "utf8"),
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("Transactional credits and payment lifecycle", () => {
  it("grants the verified-account trial at most once", async () => {
    await db.query("select amobla_account($1,true)", [user]);
    await db.query("select amobla_account($1,true)", [user]);
    expect(
      (
        await scalar<number>(
          "select sum(remaining)::int as balance from credit_grants where user_id=$1",
          [user],
        )
      ).balance,
    ).toBe(1);
    await db.query("select amobla_account($1,false)", [other]);
  });
  it("reserves once, deduplicates a retry, and restores a definitive failure exactly once", async () => {
    const p = (
      await scalar<string>(
        "insert into projects(user_id,original_hash,original_path,name,original_bytes) values($1,'hash','path','Living',100) returning id",
        [user],
      )
    ).id;
    const key = crypto.randomUUID();
    const args = [user, p, key, "living", "modern", "furnish", "", "prompt"];
    const j = (
      await scalar<string>(
        "select amobla_reserve_generation($1,$2,$3,$4,$5,$6,$7,$8) as id",
        args,
      )
    ).id;
    expect(
      (
        await scalar<string>(
          "select amobla_reserve_generation($1,$2,$3,$4,$5,$6,$7,$8) as id",
          args,
        )
      ).id,
    ).toBe(j);
    expect(
      (
        await scalar<number>(
          "select sum(remaining)::int as balance from credit_grants where user_id=$1",
          [user],
        )
      ).balance,
    ).toBe(0);
    await db.query("select amobla_claim_generation($1)", [j]);
    await db.query("select amobla_finish_generation($1,'failed')", [j]);
    await db.query("select amobla_finish_generation($1,'failed')", [j]);
    expect(
      (
        await scalar<number>(
          "select sum(remaining)::int as balance from credit_grants where user_id=$1",
          [user],
        )
      ).balance,
    ).toBe(1);
  });
  it("never releases uncertain work or starts the same provider job twice", async () => {
    const p = (
      await scalar<string>("select id from projects where user_id=$1", [user])
    ).id;
    const j = (
      await scalar<string>(
        "select amobla_reserve_generation($1,$2,$3,'living','modern','furnish','','prompt') as id",
        [user, p, crypto.randomUUID()],
      )
    ).id;
    expect(
      (await scalar<unknown>("select amobla_claim_generation($1) as job", [j]))
        .job,
    ).not.toBeNull();
    expect(
      (await scalar<unknown>("select amobla_claim_generation($1) as job", [j]))
        .job,
    ).toBeNull();
    await db.query("select amobla_finish_generation($1,'needs_review')", [j]);
    expect(
      (
        await scalar<number>(
          "select sum(remaining)::int as balance from credit_grants where user_id=$1",
          [user],
        )
      ).balance,
    ).toBe(0);
    await db.query("select amobla_finish_generation($1,'failed')", [j]);
  });
  it("grants an annual payment monthly, even after cancellation, and deduplicates notifications", async () => {
    const o = (
      await scalar<string>(
        "insert into orders(user_id,sku,snapshot,provider_subscription_id) values($1,'standard-year',$2,'sub-1') returning id",
        [
          other,
          JSON.stringify({ kind: "year", photos: 20, price_cents: 10000 }),
        ],
      )
    ).id;
    const paid = new Date();
    paid.setUTCMonth(paid.getUTCMonth() - 2);
    paid.setUTCDate(1);
    await db.query(
      "select amobla_apply_payment('pay-1',$1,'approved',10000,$2,'sub-1')",
      [o, paid.toISOString()],
    );
    await db.query(
      "select amobla_apply_payment('pay-1',$1,'approved',10000,$2,'sub-1')",
      [o, paid.toISOString()],
    );
    expect(
      (
        await scalar<number>(
          "select count(*)::int as n from credit_grants where payment_id='pay-1'",
        )
      ).n,
    ).toBe(1);
    expect(
      (
        await scalar<number>(
          "select sum(remaining)::int as n from credit_grants where user_id=$1 and expires_at>now()",
          [other],
        )
      ).n,
    ).toBe(20);
    await db.exec(
      "update subscriptions set status='cancelled' where id='sub-1'",
    );
    await db.query("select amobla_refresh_annual($1)", [other]);
    expect(
      (
        await scalar<number>(
          "select count(*)::int as n from credit_grants where payment_id='pay-1'",
        )
      ).n,
    ).toBe(1);
    await db.query(
      "select amobla_apply_payment('pay-1',$1,'refunded',10000,$2,'sub-1')",
      [o, paid.toISOString()],
    );
    await db.query(
      "select amobla_apply_payment('pay-1',$1,'approved',10000,$2,'sub-1')",
      [o, paid.toISOString()],
    );
    expect(
      (await scalar<string>("select status from payments where id='pay-1'"))
        .status,
    ).toBe("refunded");
    expect(
      (
        await scalar<number>(
          "select count(*)::int as n from credit_grants where payment_id='pay-1' and not revoked",
        )
      ).n,
    ).toBe(0);
  });
  it("snapshots checkout prices and serializes competing subscription purchases", async () => {
    await db.exec(
      "update products set price_cents=10000,active=true where sku='basic-month'",
    );
    const first = crypto.randomUUID();
    const a = (
      await scalar<{
        dispatch: boolean;
        order: { snapshot: { price_cents: number } };
      }>("select amobla_create_order($1,$2,'basic-month') as value", [
        user,
        first,
      ])
    ).value;
    expect(a.dispatch).toBe(true);
    await db.exec(
      "update products set price_cents=20000 where sku='basic-month'",
    );
    const retry = (
      await scalar<{
        dispatch: boolean;
        order: { snapshot: { price_cents: number } };
      }>("select amobla_create_order($1,$2,'basic-month') as value", [
        user,
        first,
      ])
    ).value;
    expect(retry.dispatch).toBe(false);
    expect(retry.order.snapshot.price_cents).toBe(10000);
    await expect(
      db.query("select amobla_create_order($1,$2,'basic-month')", [
        user,
        crypto.randomUUID(),
      ]),
    ).rejects.toThrow("SUBSCRIPTION_EXISTS");
  });
  it("caps successful variants per original and requires credits for a new photo", async () => {
    const p = (
      await scalar<string>("select id from projects where user_id=$1", [user])
    ).id;
    for (let i = 0; i < 3; i++) {
      const id = (
        await scalar<string>(
          "select amobla_reserve_generation($1,$2,$3,'living','eclectic','furnish','','prompt') as id",
          [user, p, crypto.randomUUID()],
        )
      ).id;
      await db.query("select amobla_claim_generation($1)", [id]);
      await db.query(
        "select amobla_finish_generation($1,'succeeded','result',100)",
        [id],
      );
    }
    await expect(
      db.query(
        "select amobla_reserve_generation($1,$2,$3,'living','modern','furnish','','prompt')",
        [user, p, crypto.randomUUID()],
      ),
    ).rejects.toThrow("VERSION_LIMIT");
    expect(
      (
        await scalar<number>(
          "select sum(remaining)::int as balance from credit_grants where user_id=$1",
          [user],
        )
      ).balance,
    ).toBe(0);
  });
  it("prevents browser mutations and cross-user reads", async () => {
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${other}',false);`,
    );
    expect(
      (await scalar<number>("select count(*)::int as n from projects")).n,
    ).toBe(0);
    await expect(
      db.exec("update credit_grants set remaining=100"),
    ).rejects.toThrow();
    await expect(
      db.query("select amobla_account($1,true)", [other]),
    ).rejects.toThrow();
    await db.exec("reset role;");
  });
});

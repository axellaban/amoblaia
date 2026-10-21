import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
let db: PGlite;
let n = 0;
const id = () =>
  `00000000-0000-4000-8000-${String(900000000000 + ++n).padStart(12, "0")}`;
const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) =>
  (await one<{ n: number }>(sql, params))!.n;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
   create table auth.users(id uuid primary key, is_anonymous boolean not null default false);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}, 30000);
afterAll(async () => await db?.close());

async function account(opts: { trial?: boolean; anonymous?: boolean } = {}) {
  const user = id();
  await db.query("insert into auth.users(id,is_anonymous) values($1,$2)", [
    user,
    opts.anonymous ?? false,
  ]);
  await db.query("select amobla_account($1,$2)", [user, opts.trial ?? false]);
  return user;
}
async function paid(
  user: string,
  photos = 1,
  expires = "now()+interval '1 month'",
) {
  await db.query(
    `insert into credit_grants(user_id,source_key,total,remaining,starts_at,expires_at) values($1,$2,$3,$3,now(),${expires})`,
    [user, `test:${id()}`, photos],
  );
}
async function project(user: string) {
  const p = id();
  await db.query(
    "insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values($1,$2,$3,'x.jpg','Foto',100)",
    [p, user, `hash-${p}`],
  );
  return p;
}
const batch = (user: string, p: string, prompts = 3) =>
  db.query<{ ids: string[] }>(
    "select amobla_reserve_batch($1,$2,$3,'living','modern','furnish','',$4,100) as ids",
    [user, p, id(), Array.from({ length: prompts }, (_, i) => `p${i}`)],
  );
const finish = async (job: string, status: string) => {
  await db.query("select amobla_claim_generation($1)", [job]);
  await (status === "succeeded"
    ? db.query("select amobla_finish_generation($1,'succeeded','r.jpg',10)", [
        job,
      ])
    : db.query("select amobla_finish_generation($1,$2)", [job, status]));
};
const balance = (user: string) =>
  count(
    "select coalesce(sum(remaining),0)::int as n from credit_grants where user_id=$1 and not revoked and source_key not like 'trial:%' and (expires_at is null or expires_at>now())",
    [user],
  );

it("does not lock the account behind a job whose worker died", async () => {
  const user = await account();
  await paid(user, 2);
  const p = await project(user);
  const [job] = (await batch(user, p, 1)).rows[0].ids;
  await db.query(
    "update generations set status='running',started_at=now()-interval '11 minutes' where id=$1",
    [job],
  );
  await expect(batch(user, p, 1)).resolves.toBeTruthy();
  expect(
    (await one<{ s: string }>(
      "select status as s from generations where id=$1",
      [job],
    ))!.s,
  ).toBe("needs_review");
});

it("fails and refunds a job that never started", async () => {
  const user = await account();
  await paid(user, 1);
  const p = await project(user);
  const [job] = (await batch(user, p, 1)).rows[0].ids;
  await db.query(
    "update generations set created_at=now()-interval '20 minutes' where id=$1",
    [job],
  );
  await db.query("select amobla_sweep_stale($1)", [user]);
  expect(
    (await one<{ s: string }>(
      "select status as s from generations where id=$1",
      [job],
    ))!.s,
  ).toBe("failed");
  expect(await balance(user)).toBe(1);
});

it("keeps the photo paid when another proposal of it was delivered", async () => {
  const user = await account();
  await paid(user, 1);
  const p = await project(user);
  const [first, second, third] = (await batch(user, p, 3)).rows[0].ids;
  await finish(second, "succeeded");
  await finish(third, "succeeded");
  await finish(first, "failed");
  expect(await balance(user)).toBe(0);
});

it("moves the reservation to a proposal still running, and refunds only if all fail", async () => {
  const user = await account();
  await paid(user, 1);
  const p = await project(user);
  const [first, second, third] = (await batch(user, p, 3)).rows[0].ids;
  await finish(first, "failed");
  expect(await balance(user)).toBe(0);
  await finish(second, "failed");
  await finish(third, "failed");
  expect(await balance(user)).toBe(1);
});

it("returns a refund as a fresh photo when the original grant expired meanwhile", async () => {
  const user = await account();
  await paid(user, 1);
  const p = await project(user);
  const [job] = (await batch(user, p, 1)).rows[0].ids;
  await finish(job, "needs_review");
  await db.query(
    "update credit_grants set expires_at=now()-interval '1 day' where user_id=$1",
    [user],
  );
  await db.query("select amobla_finish_generation($1,'failed')", [job]);
  expect(await balance(user)).toBe(1);
});

it("lets a photo with a job under review go to the trash", async () => {
  const user = await account();
  await paid(user, 1);
  const p = await project(user);
  const [job] = (await batch(user, p, 1)).rows[0].ids;
  await finish(job, "needs_review");
  await expect(
    db.query("select amobla_manage_project($1,$2,'trash')", [user, p]),
  ).resolves.toBeTruthy();
});

it("says there are no photos, not that the free trial ran out, without a trial", async () => {
  const user = await account({ trial: false });
  const p = await project(user);
  await expect(batch(user, p)).rejects.toThrow("NO_CREDITS");
});

it("refuses the free trial to an anonymous session that skipped guest registration", async () => {
  const user = await account({ anonymous: true, trial: true });
  const p = await project(user);
  await expect(batch(user, p)).rejects.toThrow("GUEST_REQUIRED");
});

it("caps one account's results per day so it cannot use up everyone's", async () => {
  const user = await account();
  await paid(user, 1);
  const p = await project(user);
  for (let i = 0; i < 11; i++) {
    const ids = (await batch(user, p, 3)).rows[0].ids;
    for (const j of ids) await finish(j, "succeeded");
  }
  await expect(batch(user, p, 1)).rejects.toThrow("USER_DAILY_LIMIT");
});

it("does not treat an exhausted pack as a live plan for regenerations", async () => {
  const user = await account();
  await paid(user, 1, "now()+interval '1 month'");
  const p = await project(user);
  const [job] = (await batch(user, p, 1)).rows[0].ids;
  await finish(job, "succeeded");
  await db.query(
    "insert into credit_grants(user_id,source_key,total,remaining,starts_at,expires_at) values($1,'pack:used',10,0,now(),null)",
    [user],
  );
  await db.query(
    "update credit_grants set expires_at=now()-interval '1 day' where user_id=$1 and source_key like 'test:%'",
    [user],
  );
  await expect(batch(user, p, 1)).rejects.toThrow("ENTITLEMENT_EXPIRED");
});

it("gives nothing back from a purchase refunded while its job was under review", async () => {
  const user = await account();
  await paid(user, 1);
  const p = await project(user);
  const [job] = (await batch(user, p, 1)).rows[0].ids;
  await finish(job, "needs_review");
  await db.query("update credit_grants set revoked=true where user_id=$1", [
    user,
  ]);
  await db.query("select amobla_finish_generation($1,'failed')", [job]);
  expect(
    await count(
      "select count(*)::int as n from credit_grants where user_id=$1 and not revoked and source_key not like 'trial:%'",
      [user],
    ),
  ).toBe(0);
});

it("refunds a paid batch that failed even if the photo had a free result", async () => {
  const user = await account({ trial: true });
  const p = await project(user);
  const [free] = (await batch(user, p, 1)).rows[0].ids;
  await finish(free, "succeeded");
  await paid(user, 1);
  const jobs = (await batch(user, p, 3)).rows[0].ids;
  for (const j of jobs) await finish(j, "failed");
  expect(await balance(user)).toBe(1);
});

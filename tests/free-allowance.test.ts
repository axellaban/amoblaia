import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { freeBatchSize } from "../src/lib/free-tier";
let db: PGlite;
const user = "00000000-0000-4000-8000-000000000099";
const project = "00000000-0000-4000-8000-000000000088";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;insert into auth.users values('${user}');`,
  );
  for (const f of readdirSync("supabase/migrations").sort()) {
    if (f.startsWith("202610200006")) {
      const legacy = "00000000-0000-4000-8000-000000000077";
      await db.query("insert into auth.users values($1)", [legacy]);
      await db.query("select amobla_account($1,true)", [legacy]);
      const p = (
        await db.query<{ id: string }>(
          "insert into projects(user_id,original_hash,original_path,name,original_bytes) values($1,'legacy','old.jpg','Old',100) returning id",
          [legacy],
        )
      ).rows[0].id;
      for (let i = 0; i < 3; i++) {
        const id = (
          await db.query<{ id: string }>(
            "select amobla_reserve_generation($1,$2,gen_random_uuid(),'living','modern','furnish','','prompt',1000) as id",
            [legacy, p],
          )
        ).rows[0].id;
        await db.query("select amobla_claim_generation($1)", [id]);
        await db.query(
          "select amobla_finish_generation($1,'succeeded','old-result.jpg',100)",
          [id],
        );
      }
    }
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  }
  await db.query("select amobla_account($1,true)", [user]);
  await db.query(
    "insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values($1,$2,'free-photo','original.jpg','Living',100)",
    [project, user],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
const account = async () =>
  (
    await db.query<{
      v: { credits: number; freeRemaining: number; freeUsed: number };
    }>("select amobla_account($1,true) as v", [user])
  ).rows[0].v;
const reserve = async (p = project, key = crypto.randomUUID()) =>
  (
    await db.query<{ id: string }>(
      "select amobla_reserve_generation($1,$2,$3,'living','modern','furnish','','prompt',1000) as id",
      [user, p, key],
    )
  ).rows[0].id;
const finish = async (id: string, status = "succeeded") => {
  await db.query("select amobla_claim_generation($1)", [id]);
  await db.query("select amobla_finish_generation($1,$2,'result.jpg',100)", [
    id,
    status,
  ]);
};
describe("Lifetime 25-result allowance enforced in SQL", () => {
  it("counts the three results delivered before the migration", async () => {
    const legacy = "00000000-0000-4000-8000-000000000077";
    const r = (
      await db.query<{ v: { freeRemaining: number; freeUsed: number } }>(
        "select amobla_account($1,true) as v",
        [legacy],
      )
    ).rows[0].v;
    expect(r).toMatchObject({ freeRemaining: 22, freeUsed: 3 });
  });
  it("grants 25 outputs once, independently of paid photo credits", async () => {
    expect(await account()).toMatchObject({
      credits: 0,
      freeRemaining: 25,
      freeUsed: 0,
    });
    expect(await account()).toMatchObject({ freeRemaining: 25 });
  });
  it("charges one output per job, deduplicates retries, and releases a confirmed failure", async () => {
    const key = crypto.randomUUID();
    const id = await reserve(project, key);
    expect(await reserve(project, key)).toBe(id);
    expect((await account()).freeRemaining).toBe(24);
    await finish(id, "failed");
    await finish(id, "failed");
    expect((await account()).freeRemaining).toBe(25);
  });
  it("keeps uncertain results reserved until the operator resolves them", async () => {
    const id = await reserve();
    await finish(id, "needs_review");
    expect((await account()).freeRemaining).toBe(24);
    await finish(id, "failed");
    expect((await account()).freeRemaining).toBe(25);
  });
  it("allows more than three outputs on the same photo but stops at 25 account-wide", async () => {
    for (let i = 0; i < 25; i++) await finish(await reserve());
    expect((await account()).freeRemaining).toBe(0);
    await expect(reserve()).rejects.toThrow("FREE_LIMIT");
  });
  it("does not reset after deleting a project or requesting the trial again", async () => {
    await db.query("update projects set deleted_at=now() where id=$1", [
      project,
    ]);
    const p = crypto.randomUUID();
    await db.query(
      "insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values($1,$2,'other-photo','another.jpg','Bedroom',100)",
      [p, user],
    );
    expect((await account()).freeRemaining).toBe(0);
    await expect(reserve(p)).rejects.toThrow("FREE_LIMIT");
  });
  it("caps the final batch at one instead of generating a 26th output", () => {
    expect([25, 4, 2, 1, 0].map(freeBatchSize)).toEqual([3, 3, 2, 1, 0]);
  });
});

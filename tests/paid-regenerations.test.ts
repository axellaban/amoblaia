import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const u = "00000000-0000-4000-8000-000000000021",
  p = "00000000-0000-4000-8000-000000000022",
  grant = "00000000-0000-4000-8000-000000000023";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;insert into auth.users values('${u}');`,
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("select amobla_account($1,false)", [u]);
  await db.exec(
    `insert into credit_grants(id,user_id,source_key,total,remaining,expires_at) values('${grant}','${u}','paid:test',6,6,now()+interval '1 month');insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values('${p}','${u}','hash','image.jpg','Foto',100);`,
  );
}, 30000);
afterAll(async () => await db?.close());
const reserve = async () =>
  (
    await db.query<{ id: string }>(
      "select amobla_reserve_generation($1,$2,gen_random_uuid(),'living','modern','furnish','','prompt') as id",
      [u, p],
    )
  ).rows[0].id;
it("creates further paid proposals beyond three while spending only one original photo", async () => {
  for (let i = 0; i < 5; i++) {
    const id = await reserve();
    await db.query("select amobla_claim_generation($1)", [id]);
    await db.query(
      "select amobla_finish_generation($1,'succeeded','paid.jpg',100)",
      [id],
    );
  }
  const { rows } = await db.query<{ remaining: number }>(
    "select remaining from credit_grants where id=$1",
    [grant],
  );
  expect(rows[0].remaining).toBe(5);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int as n from generations where is_free",
      )
    ).rows[0].n,
  ).toBe(0);
});
it("stops paid regeneration after coverage expires", async () => {
  await db.query(
    "update credit_grants set expires_at=now()-interval '1 hour' where id=$1",
    [grant],
  );
  await expect(reserve()).rejects.toThrow("ENTITLEMENT_EXPIRED");
});

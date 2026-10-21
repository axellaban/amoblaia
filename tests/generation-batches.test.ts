import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const u = "00000000-0000-4000-8000-000000000041",
  v = "00000000-0000-4000-8000-000000000042",
  p = "00000000-0000-4000-8000-000000000043",
  q = "00000000-0000-4000-8000-000000000044",
  key = "00000000-0000-4000-8000-000000000045";
let ids: string[] = [];
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;insert into auth.users values('${u}'),('${v}');`,
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("select amobla_account($1,true),amobla_account($2,true)", [
    u,
    v,
  ]);
  await db.exec(
    `insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values('${p}','${u}','hash','image.jpg','Foto',100),('${q}','${v}','hash','image2.jpg','Foto 2',100);`,
  );
}, 30000);
afterAll(async () => await db?.close());
async function reserve(
  user = u,
  project = p,
  batch = crypto.randomUUID(),
  limit = 100,
) {
  return (
    await db.query<{ ids: string[] }>(
      "select amobla_reserve_batch($1,$2,$3,'living','modern','furnish','',array['option1','option2','option3'],$4) as ids",
      [user, project, batch, limit],
    )
  ).rows[0].ids;
}
it("reserves all three before dispatch and rejects an overlapping batch", async () => {
  ids = await reserve(u, p, key);
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(3);
  const r = await db.query<{ n: number; b: number }>(
    "select count(*)::int n,count(distinct batch_id)::int b from generations where user_id=$1 and status='queued'",
    [u],
  );
  expect(r.rows[0]).toEqual({ n: 3, b: 1 });
  await expect(reserve()).rejects.toThrow("BUSY");
  await expect(
    db.query(
      "select amobla_reserve_generation($1,$2,gen_random_uuid(),'living','modern','furnish','','prompt')",
      [u, p],
    ),
  ).rejects.toThrow("BUSY");
});
it("dispatches each proposal only once; a retry returns the same jobs", async () => {
  expect(new Set(await reserve(u, p, key))).toEqual(new Set(ids));
  for (const id of ids) {
    await db.query("select amobla_claim_generation($1)", [id]);
    const r = await db.query<{ j: unknown }>(
      "select amobla_claim_generation($1) j",
      [id],
    );
    expect(r.rows[0].j).toBeNull();
  }
});
it("preserves successful outputs when a sibling fails and restores only the definite failure", async () => {
  await db.query(
    "select amobla_finish_generation($1,'succeeded','result.jpg',100)",
    [ids[0]],
  );
  await db.query("select amobla_finish_generation($1,'failed')", [ids[1]]);
  await db.query("select amobla_finish_generation($1,'needs_review')", [
    ids[2],
  ]);
  const r = await db.query<{ a: { freeRemaining: number; freeUsed: number } }>(
    "select amobla_account($1,true) a",
    [u],
  );
  expect(r.rows[0].a.freeUsed).toBe(2);
  expect(r.rows[0].a.freeRemaining).toBe(23);
  expect(new Set(await reserve(u, p, key))).toEqual(new Set(ids));
});
it("clamps the final batch to two and stops exactly at 25", async () => {
  await db.query(
    "insert into generations(user_id,project_id,request_key,room,style,mode,prompt,status,is_free) select $1,$2,gen_random_uuid(),'living','modern','furnish','prompt','succeeded',true from generate_series(1,21)",
    [u, p],
  );
  const final = await reserve();
  expect(final).toHaveLength(2);
  for (const id of final) {
    await db.query("select amobla_claim_generation($1)", [id]);
    await db.query(
      "select amobla_finish_generation($1,'succeeded','result.jpg',100)",
      [id],
    );
  }
  await expect(reserve()).rejects.toThrow("FREE_LIMIT");
});
it("rolls back the entire batch if daily capacity runs out midway", async () => {
  const count = (
    await db.query<{ n: number }>("select count(*)::int n from generations")
  ).rows[0].n;
  await expect(reserve(v, q, crypto.randomUUID(), count + 2)).rejects.toThrow(
    "DAILY_LIMIT",
  );
  const r = await db.query<{ n: number }>(
    "select count(*)::int n from generations where user_id=$1",
    [v],
  );
  expect(r.rows[0].n).toBe(0);
});

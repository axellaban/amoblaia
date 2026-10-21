import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const guest = "00000000-0000-4000-8000-000000000051",
  user = "00000000-0000-4000-8000-000000000052",
  kept = "00000000-0000-4000-8000-000000000053",
  duplicate = "00000000-0000-4000-8000-000000000054",
  unique = "00000000-0000-4000-8000-000000000055";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;insert into auth.users values('${guest}'),('${user}');`,
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query(
    "select amobla_register_guest($1,'qa-orphans'),amobla_account($2,true)",
    [guest, user],
  );
  await db.exec(
    `insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values
     ('${kept}','${user}','same','${user}/same/original.jpg','Cuenta',100),
     ('${duplicate}','${guest}','same','${guest}/same/original.jpg','Invitado',100),
     ('${unique}','${guest}','other','${guest}/other/original.jpg','Única',100);`,
  );
}, 30000);
afterAll(async () => await db?.close());
it("returns only the guest originals merged into an identical photo", async () => {
  const r = await db.query<{ orphans: string[] }>(
    "select amobla_claim_guest($1,$2) as orphans",
    [guest, user],
  );
  expect(r.rows[0].orphans).toEqual([`${guest}/same/original.jpg`]);
  const projects = await db.query<{ id: string; deleted: boolean }>(
    "select id,deleted_at is not null as deleted from projects where user_id=$1 order by name",
    [user],
  );
  expect(projects.rows).toEqual([
    { id: kept, deleted: false },
    { id: duplicate, deleted: true },
    { id: unique, deleted: false },
  ]);
  const again = await db.query<{ orphans: string[] }>(
    "select amobla_claim_guest($1,$2) as orphans",
    [guest, user],
  );
  expect(again.rows[0].orphans).toEqual([]);
});

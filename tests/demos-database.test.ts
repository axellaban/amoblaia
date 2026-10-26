import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
let db: PGlite;
let n = 0;
const id = () =>
  `00000000-0000-4000-8000-${String(700000000000 + ++n).padStart(12, "0")}`;
const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];
const MIGRATION = "supabase/migrations/202610260001_commercial_demos.sql";

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

async function account() {
  const user = id();
  await db.query("insert into auth.users(id) values($1)", [user]);
  await db.query("select amobla_account($1,false)", [user]);
  return user;
}
async function paid(user: string, photos: number) {
  await db.query(
    "insert into credit_grants(user_id,source_key,total,remaining,starts_at,expires_at) values($1,$2,$3,$3,now(),now()+interval '1 month')",
    [user, `test:${id()}`, photos],
  );
}
const credits = async (user: string) =>
  (await one<{ credits: number }>("select (amobla_account($1,false)->>'credits')::int as credits", [user]))!
    .credits;

/** Agency, property, draft demo and one photo backed by a project of `owner`. */
async function demoPhoto(owner: string, hash = `demo:${id()}`) {
  const agency = (await one<{ id: string }>(
    "insert into agencies(name,notes) values('Inmobiliaria Sur','nota interna') returning id",
  ))!.id;
  const property = (await one<{ id: string }>(
    "insert into demo_properties(agency_id,title) values($1,'Depto 3 ambientes') returning id",
    [agency],
  ))!.id;
  await db.query("insert into demos(agency_id,property_id,token) values($1,$2,$3)", [
    agency,
    property,
    `tok_${id().replace(/-/g, "")}`,
  ]);
  const project = id();
  await db.query(
    "insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values($1,$2,$3,'x.jpg','Foto',100)",
    [project, owner, hash],
  );
  const photo = (await one<{ id: string }>(
    "insert into demo_photos(property_id,project_id) values($1,$2) returning id",
    [property, project],
  ))!.id;
  return { agency, property, project, photo };
}
const reserve = (actor: string, photo: string, key = id(), mode = "furnish") =>
  db.query<{ ids: string[] }>(
    "select amobla_reserve_demo_generation($1,$2,$3,'living','modern',$4,'','prompt',100) as ids",
    [actor, photo, key, mode],
  );
async function finish(job: string) {
  await db.query("select amobla_claim_generation($1)", [job]);
  await db.query("select amobla_finish_generation($1,'succeeded','r.jpg',10)", [job]);
}

describe("Demo generations", () => {
  it("stage a demo photo without any credit, at full quality, through the regular reservation", async () => {
    const admin = await account();
    expect(await credits(admin)).toBe(0);
    const { photo, project } = await demoPhoto(admin);
    const [job] = (await reserve(admin, photo)).rows[0].ids;
    const row = (await one<{ is_free: boolean; reserved_credit: boolean; status: string; user_id: string }>(
      "select is_free,reserved_credit,status,user_id from generations where id=$1",
      [job],
    ))!;
    expect(row).toEqual({ is_free: false, reserved_credit: false, status: "queued", user_id: admin });
    expect(
      (await one<{ source_key: string; remaining: number }>(
        "select g.source_key,g.remaining from projects p join credit_grants g on g.id=p.grant_id where p.id=$1",
        [project],
      ))!,
    ).toEqual({ source_key: `demo:${admin}`, remaining: 0 });
    expect(await credits(admin)).toBe(0);
    // Regenerating works the same way once the first proposal ends.
    await finish(job);
    const [again] = (await reserve(admin, photo)).rows[0].ids;
    expect(again).not.toBe(job);
    expect(
      (await one<{ n: number }>(
        "select count(*)::int as n from admin_audit where action='demo_generation' and subject_id=$1",
        [photo],
      ))!.n,
    ).toBe(2);
  });

  it("never touches paid credits of the account and is idempotent by key", async () => {
    const admin = await account();
    await paid(admin, 5);
    const { photo } = await demoPhoto(admin);
    const key = id();
    const first = (await reserve(admin, photo, key)).rows[0].ids;
    const retry = (await reserve(admin, photo, key)).rows[0].ids;
    expect(retry).toEqual(first);
    expect(await credits(admin)).toBe(5);
    expect(
      (await one<{ n: number }>("select count(*)::int as n from credit_ledger where user_id=$1 and generation_id is not null", [admin]))!.n,
    ).toBe(0);
  });

  it("keeps the one-live-batch rule of the account", async () => {
    const admin = await account();
    const { photo } = await demoPhoto(admin);
    await reserve(admin, photo);
    await expect(reserve(admin, photo)).rejects.toThrow(/BUSY/);
  });

  it("refuses photos outside demos, invalid modes and unknown photos", async () => {
    const admin = await account();
    const library = await demoPhoto(admin, `library-${id()}`);
    await expect(reserve(admin, library.photo)).rejects.toThrow(/DEMO_PHOTO_NOT_FOUND/);
    const { photo } = await demoPhoto(admin);
    await expect(reserve(admin, photo, id(), "dusk")).rejects.toThrow(/INVALID_DEMO_MODE/);
    await expect(reserve(admin, id())).rejects.toThrow(/DEMO_PHOTO_NOT_FOUND/);
  });

  it("leaves regular generations unchanged: an account without credits still gets NO_CREDITS", async () => {
    const user = await account();
    const project = id();
    await db.query(
      "insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values($1,$2,$3,'y.jpg','Foto',100)",
      [project, user, `hash-${project}`],
    );
    await expect(
      db.query("select amobla_reserve_batch($1,$2,$3,'living','modern','furnish','',array['p'],100)", [user, project, id()]),
    ).rejects.toThrow(/NO_CREDITS/);
  });

  it("keeps the agency of a demo equal to the agency of its property", async () => {
    const admin = await account();
    const { property } = await demoPhoto(admin);
    const other = (await one<{ id: string }>("insert into agencies(name) values('Otra') returning id"))!.id;
    await db.query("delete from demos where property_id=$1", [property]);
    await expect(
      db.query("insert into demos(agency_id,property_id,token) values($1,$2,$3)", [other, property, "abcdefghijklmnopqrstuvwx"]),
    ).rejects.toThrow();
  });

  it("rejects short or malformed public tokens", async () => {
    const admin = await account();
    const { agency, property } = await demoPhoto(admin);
    await db.query("delete from demos where property_id=$1", [property]);
    await expect(
      db.query("insert into demos(agency_id,property_id,token) values($1,$2,'abc')", [agency, property]),
    ).rejects.toThrow();
  });
});

describe("Access control of the demo tables", () => {
  it("gives browsers no access to demo data and no access to the demo RPC", async () => {
    for (const table of ["agencies", "demo_properties", "demo_photos", "demos"])
      for (const role of ["anon", "authenticated"])
        for (const privilege of ["select", "insert", "update", "delete"])
          expect(
            (await one<{ ok: boolean }>("select has_table_privilege($1,$2,$3) as ok", [role, `public.${table}`, privilege]))!.ok,
          ).toBe(false);
    const fn = "public.amobla_reserve_demo_generation(uuid,uuid,uuid,text,text,text,text,text,integer)";
    for (const role of ["anon", "authenticated"])
      expect((await one<{ ok: boolean }>("select has_function_privilege($1,$2,'execute') as ok", [role, fn]))!.ok).toBe(false);
    expect((await one<{ ok: boolean }>("select has_function_privilege('service_role',$1,'execute') as ok", [fn]))!.ok).toBe(true);
    for (const table of ["agencies", "demo_properties", "demo_photos", "demos"])
      expect(
        (await one<{ rls: boolean }>("select relrowsecurity as rls from pg_class where oid=$1::regclass", [`public.${table}`]))!.rls,
      ).toBe(true);
  });

  it("can be applied again without errors", async () => {
    await expect(db.exec(readFileSync(MIGRATION, "utf8"))).resolves.toBeTruthy();
  });
});

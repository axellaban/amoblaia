import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
let db: PGlite;
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(800000000000 + ++n).padStart(12, "0")}`;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const MIGRATION = "supabase/migrations/202610280001_agency_accounts.sql";
const RELIABILITY = "supabase/migrations/202610290001_panel_reliability.sql";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
   create table auth.users(id uuid primary key, is_anonymous boolean not null default false);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   grant usage on schema public to authenticated;`);
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
const credits = async (user: string) =>
  (await one<{ credits: number }>("select (amobla_account($1,false)->>'credits')::int as credits", [user]))!.credits;
async function paid(user: string, photos: number) {
  await db.query(
    "insert into credit_grants(user_id,source_key,total,remaining,starts_at,expires_at) values($1,$2,$3,$3,now(),now()+interval '1 month')",
    [user, `test:${id()}`, photos],
  );
}
const createAgency = async (user: string, name = "Inmobiliaria Sur", slug = "inmobiliaria-sur") =>
  (await one<{ id: string }>("select habita_create_agency($1,$2,$3) as id", [user, name, slug]))!.id;

/** An agency the team prepared a demo for, with one photo staged by the admin. */
async function prospect(admin: string) {
  const agency = (await one<{ id: string }>(
    "insert into agencies(name,notes,contact_name) values('Russillo','Le interesa el plan Agente','Ana') returning id",
  ))!.id;
  const property = (await one<{ id: string }>(
    "insert into demo_properties(agency_id,title) values($1,'Departamento en La Perla') returning id",
    [agency],
  ))!.id;
  await db.query("insert into demos(agency_id,property_id,token) values($1,$2,$3)", [agency, property, `tok_${id().replace(/-/g, "")}`]);
  const project = id();
  await db.query(
    "insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values($1,$2,$3,'a/demos/x.jpg','Foto',100)",
    [project, admin, `demo:${id()}`],
  );
  const photo = (await one<{ id: string }>("insert into demo_photos(property_id,project_id) values($1,$2) returning id", [property, project]))!.id;
  const [job] = (await one<{ ids: string[] }>(
    "select amobla_reserve_demo_generation($1,$2,$3,'living','modern','furnish','','prompt',100) as ids",
    [admin, photo, id()],
  ))!.ids;
  await db.query("select amobla_claim_generation($1)", [job]);
  await db.query("select amobla_finish_generation($1,'succeeded','r.jpg',10)", [job]);
  return { agency, property, project, photo, job };
}
async function claimCode(agency: string, admin: string, expires = "now()+interval '30 days'") {
  const code = `code-${id()}`;
  const hash = createHash("sha256").update(code).digest("hex");
  await db.query(`insert into agency_claims(agency_id,code_hash,created_by,expires_at) values($1,$2,$3,${expires})`, [agency, hash, admin]);
  return hash;
}
const claim = (user: string, hash: string, slug = "russillo") =>
  db.query<{ id: string }>("select habita_claim_agency($1,$2,$3) as id", [user, hash, slug]);

describe("Agency accounts", () => {
  it("creates an agency with its owner and a free slug; one agency per account", async () => {
    const a = await account();
    const b = await account();
    const first = await createAgency(a, "Inmobiliaria Sur", "sur-propiedades");
    const second = await createAgency(b, "Sur Propiedades", "sur-propiedades");
    const rows = (await db.query<{ id: string; slug: string; owner_id: string }>(
      "select id,slug,owner_id from agencies where id=any($1) order by slug",
      [[first, second]],
    )).rows;
    expect(rows.map((r) => r.slug)).toEqual(["sur-propiedades", "sur-propiedades-2"]);
    expect((await one<{ role: string }>("select role from agency_members where user_id=$1", [a]))!.role).toBe("owner");
    await expect(createAgency(a, "Otra", "otra")).rejects.toThrow(/AGENCY_EXISTS/);
    await expect(createAgency(await account(), " ", "vacia")).rejects.toThrow(/INVALID_AGENCY_NAME/);
    await expect(createAgency(await account(), "Mal", "Con Espacios")).rejects.toThrow(/INVALID_SLUG/);
  });
});

describe("Taking over a demo with a code", () => {
  it("moves the demo photos and their stagings to the owner, and clears the team's free grant", async () => {
    const admin = await account();
    const { agency, project, job, photo } = await prospect(admin);
    const owner = await account();
    const hash = await claimCode(agency, admin);
    expect((await claim(owner, hash)).rows[0].id).toBe(agency);
    expect(await one("select owner_id,slug from agencies where id=$1", [agency])).toEqual({ owner_id: owner, slug: "russillo" });
    expect(await one("select user_id,grant_id from projects where id=$1", [project])).toEqual({ user_id: owner, grant_id: null });
    expect((await one<{ user_id: string }>("select user_id from generations where id=$1", [job]))!.user_id).toBe(owner);
    // The team can no longer stage it for free; the owner's credits pay a new version.
    await expect(
      db.query("select amobla_reserve_demo_generation($1,$2,$3,'living','modern','furnish','','p',100)", [admin, photo, id()]),
    ).rejects.toThrow(/AGENCY_HAS_ACCOUNT/);
    await paid(owner, 2);
    await db.query("select amobla_reserve_batch($1,$2,$3,'living','nordic','furnish','',array['p'],100)", [owner, project, id()]);
    expect(await credits(owner)).toBe(1);
  });

  it("refuses used, expired, unknown codes and agencies that already have an owner", async () => {
    const admin = await account();
    const { agency } = await prospect(admin);
    const hash = await claimCode(agency, admin);
    await claim(await account(), hash);
    await expect(claim(await account(), hash)).rejects.toThrow(/CLAIM_INVALID/);
    const other = await prospect(admin);
    const expired = await claimCode(other.agency, admin, "now()-interval '1 minute'");
    await expect(claim(await account(), expired)).rejects.toThrow(/CLAIM_INVALID/);
    await expect(claim(await account(), "0".repeat(64))).rejects.toThrow(/CLAIM_INVALID/);
    // A second valid code of an agency that was already taken.
    const again = await claimCode(agency, admin);
    await expect(claim(await account(), again)).rejects.toThrow(/CLAIM_INVALID/);
  });

  it("does not let an account that already has an agency take another one", async () => {
    const admin = await account();
    const { agency } = await prospect(admin);
    const user = await account();
    await createAgency(user, "Mía", "mia");
    await expect(claim(user, await claimCode(agency, admin))).rejects.toThrow(/AGENCY_EXISTS/);
  });

  it("waits while a staging of the demo is still running", async () => {
    const admin = await account();
    const { agency, photo } = await prospect(admin);
    await db.query("select amobla_reserve_demo_generation($1,$2,$3,'living','boho','furnish','','p',100)", [admin, photo, id()]);
    await expect(claim(await account(), await claimCode(agency, admin))).rejects.toThrow(/BUSY/);
  });
});

describe("Imports and invitations that reflect what happened", () => {
  it("records partial imports, refuses a second concurrent import of the same URL and repeats a request once", async () => {
    const owner = await account();
    const agency = await createAgency(owner, "Concurrente", "concurrente");
    const start = (url: string, key: string | null = null) =>
      db.query("insert into property_imports(agency_id,user_id,url,status,request_key) values($1,$2,$3,'started',$4) returning id", [agency, owner, url, key]);
    const first = (await start("https://x.test/p/1", id())).rows[0] as { id: string };
    await expect(start("https://x.test/p/1")).rejects.toThrow(/property_imports_running/);
    // Another URL can run at the same time.
    await start("https://x.test/p/2");
    await db.query(
      "update property_imports set status='partial',photos_total=12,photos_done=8,pending_images=$2 where id=$1",
      [first.id, JSON.stringify(["https://x.test/a.jpg"])],
    );
    // Once finished, the URL can be imported again (the duplicate check is the server's).
    await start("https://x.test/p/1");
    const key = id();
    await start("https://x.test/p/3", key);
    await db.query("update property_imports set status='completed' where request_key=$1", [key]);
    await expect(start("https://x.test/p/4", key)).rejects.toThrow(/property_imports_request/);
    await expect(db.query("update property_imports set status='lost' where id=$1", [first.id])).rejects.toThrow();
  });

  it("counts an agency's properties without any list limit", async () => {
    const admin = await account();
    const { agency, property } = await prospect(admin);
    for (let i = 0; i < 320; i++) {
      const pr = (await one<{ id: string }>("insert into demo_properties(agency_id,title) values($1,$2) returning id", [agency, `P${i}`]))!.id;
      await db.query("insert into demos(agency_id,property_id,token,status,settings) values($1,$2,$3,$4,$5)", [
        agency,
        pr,
        `tok_${id().replace(/-/g, "")}`,
        i % 2 ? "published" : "draft",
        JSON.stringify({ operation: i % 3 ? "Venta" : "Alquiler" }),
      ]);
    }
    void property;
    const counts = (await one<{ c: { total: number; published: number; staged: number; operations: string[] } }>("select habita_agency_counts($1) as c", [agency]))!.c;
    expect(counts).toMatchObject({ total: 321, published: 160, staged: 1 });
    expect(counts.operations.sort()).toEqual(["Alquiler", "Venta"]);
  });

  it("refuses a revoked invitation", async () => {
    const admin = await account();
    const { agency } = await prospect(admin);
    const hash = await claimCode(agency, admin);
    await db.query("update agency_claims set revoked_at=now() where code_hash=$1", [hash]);
    await expect(claim(await account(), hash)).rejects.toThrow(/CLAIM_INVALID/);
  });

  it("lists agencies for the team with the facts of their stage", async () => {
    const admin = await account();
    const waiting = await prospect(admin);
    await db.query("update agencies set name='Lista Espera' where id=$1", [waiting.agency]);
    await claimCode(waiting.agency, admin);
    const expired = await prospect(admin);
    await db.query("update agencies set name='Lista Vencida' where id=$1", [expired.agency]);
    await claimCode(expired.agency, admin, "now()-interval '1 day'");
    const owner = await account();
    const claimed = await prospect(admin);
    await db.query("update agencies set name='Lista Reclamada' where id=$1", [claimed.agency]);
    await claim(owner, await claimCode(claimed.agency, admin), "lista-reclamada");
    await db.query("update demos set status='published' where agency_id=$1", [claimed.agency]);
    await db.query("insert into property_imports(agency_id,url,status) values($1,'https://x.test/1','partial')", [claimed.agency]);
    type Row = { name: string; owner_id: string | null; properties: number; published: number; partial_imports: number; live_claim_expires: string | null; total: number };
    const rows = (await db.query<Row>("select * from habita_admin_agencies('lista',10,0)")).rows;
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(rows).toHaveLength(3);
    expect(Number(rows[0].total)).toBe(3);
    expect(by["Lista Espera"].live_claim_expires).not.toBeNull();
    expect(by["Lista Vencida"].live_claim_expires).toBeNull();
    expect(by["Lista Reclamada"]).toMatchObject({ owner_id: owner });
    expect(Number(by["Lista Reclamada"].published)).toBe(1);
    expect(Number(by["Lista Reclamada"].partial_imports)).toBe(1);
    // A search with wildcard characters is taken literally.
    expect((await db.query("select * from habita_admin_agencies('%',10,0)")).rows).toEqual([]);
  });
});

describe("Isolation between agencies (RLS)", () => {
  const as = async <T>(user: string, sql: string) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    try {
      return (await db.query<T>(sql)).rows;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };

  it("lets members read only their own agency, never the team's notes, and never write", async () => {
    const admin = await account();
    const mine = await prospect(admin);
    const owner = await account();
    await claim(owner, await claimCode(mine.agency, admin), "russillo-rls");
    const theirs = await prospect(admin);
    expect((await as<{ id: string }>(owner, "select id from agencies")).map((r) => r.id)).toEqual([mine.agency]);
    expect((await as<{ id: string }>(owner, "select id from demo_properties")).map((r) => r.id)).toEqual([mine.property]);
    expect((await as<{ id: string }>(owner, "select id from demo_photos")).map((r) => r.id)).toEqual([mine.photo]);
    expect(await as(owner, "select id from demos")).toHaveLength(1);
    await expect(as(owner, "select notes from agencies")).rejects.toThrow(/permission denied/);
    await expect(as(owner, "select contact_name from agencies")).rejects.toThrow(/permission denied/);
    await expect(as(owner, `update demo_properties set title='x' where id='${mine.property}'`)).rejects.toThrow(/permission denied/);
    await expect(as(owner, "select * from agency_claims")).rejects.toThrow(/permission denied/);
    // A stranger sees nothing of either agency.
    const stranger = await account();
    expect(await as(stranger, "select id from agencies")).toEqual([]);
    expect(await as(stranger, "select id from demo_properties")).toEqual([]);
    void theirs;
  });

  it("keeps the agency RPCs for the server only", async () => {
    for (const fn of [
      "public.habita_create_agency(uuid,text,text)",
      "public.habita_claim_agency(uuid,text,text)",
      "public.habita_free_slug(text,uuid)",
      "public.habita_agency_counts(uuid)",
      "public.habita_admin_agencies(text,integer,integer)",
    ])
      for (const role of ["anon", "authenticated"])
        expect((await one<{ ok: boolean }>("select has_function_privilege($1,$2,'execute') as ok", [role, fn]))!.ok).toBe(false);
  });

  it("can be applied again without errors, and keeps refusing revoked invitations", async () => {
    await expect(db.exec(readFileSync(MIGRATION, "utf8"))).resolves.toBeTruthy();
    await expect(db.exec(readFileSync(RELIABILITY, "utf8"))).resolves.toBeTruthy();
    const admin = await account();
    const { agency } = await prospect(admin);
    const hash = await claimCode(agency, admin);
    await db.query("update agency_claims set revoked_at=now() where code_hash=$1", [hash]);
    await expect(claim(await account(), hash)).rejects.toThrow(/CLAIM_INVALID/);
  });
});

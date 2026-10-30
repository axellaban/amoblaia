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

describe("Free credits for an agency", () => {
  const give = (actor: string, agency: string, photos: number, reason = "Regalo de bienvenida") =>
    one<{ r: { applied: string; pending: number } }>("select habita_agency_credit($1,$2,$3,$4) as r", [actor, agency, photos, reason]);

  it("waits for an agency without an account and moves to its owner when claimed", async () => {
    const admin = await account();
    const { agency } = await prospect(admin);
    // A new agency already carries its 10 welcome credits.
    expect((await give(admin, agency, 5))!.r).toEqual({ applied: "pending", pending: 15 });
    expect((await give(admin, agency, 3))!.r).toEqual({ applied: "pending", pending: 18 });
    const owner = await account();
    const before = await credits(owner);
    await claim(owner, await claimCode(agency, admin), `free-${id().slice(-6)}`);
    expect((await one<{ n: number }>("select habita_apply_agency_credits($1) as n", [agency]))!.n).toBe(18);
    expect(await credits(owner)).toBe(before + 18);
    // Applied once: calling again moves nothing.
    expect((await one<{ n: number }>("select habita_apply_agency_credits($1) as n", [agency]))!.n).toBe(0);
    expect(await credits(owner)).toBe(before + 18);
  });

  it("goes to the owner at once when the agency has an account, and is audited", async () => {
    const admin = await account();
    const owner = await account();
    const agency = await createAgency(owner, "Con Cuenta", `con-cuenta-${id().slice(-6)}`);
    const before = await credits(owner);
    expect((await give(admin, agency, 4))!.r).toMatchObject({ applied: "owner" });
    expect(await credits(owner)).toBe(before + 4);
    const audit = await one<{ n: number }>("select count(*)::int as n from admin_audit where action='agency_credit' and subject_id=$1", [agency]);
    expect(audit!.n).toBe(1);
  });

  it("gives every new agency 10 welcome credits: reserved until claimed, or to its owner at once", async () => {
    const admin = await account();
    const { agency } = await prospect(admin);
    expect((await one<{ n: number }>("select free_credits_pending as n from agencies where id=$1", [agency]))!.n).toBe(10);
    const owner = await account();
    const before = await credits(owner);
    const own = await createAgency(owner, "Recién Creada", `recien-${id().slice(-6)}`);
    expect(await credits(owner)).toBe(before + 10);
    expect((await one<{ n: number }>("select free_credits_pending as n from agencies where id=$1", [own]))!.n).toBe(0);
  });

  it("refuses invalid amounts, missing reasons and unknown agencies", async () => {
    const admin = await account();
    const { agency } = await prospect(admin);
    await expect(give(admin, agency, 0)).rejects.toThrow(/INVALID_ADJUSTMENT/);
    await expect(give(admin, agency, 1001)).rejects.toThrow(/INVALID_ADJUSTMENT/);
    await expect(give(admin, agency, 2, "x")).rejects.toThrow(/INVALID_ADJUSTMENT/);
    await expect(give(admin, id(), 2)).rejects.toThrow(/AGENCY_NOT_FOUND/);
  });
});

describe("Spaces of a property", () => {
  const space = async (property: string, name: string, room = "bedroom", position = 0) =>
    (await one<{ id: string }>("insert into property_spaces(property_id,name,room_type,position) values($1,$2,$3,$4) returning id", [property, name, room, position]))!.id;

  it("keeps two bedrooms apart, leaves old photos unassigned and keeps everything when a space goes", async () => {
    const admin = await account();
    const { property, photo, project, job } = await prospect(admin);
    const before = await one<{ position: number; room: string; visible: boolean; project_id: string; space_id: string | null }>(
      "select position,room,visible,project_id,space_id from demo_photos where id=$1",
      [photo],
    );
    // Existing photos start in "Sin organizar".
    expect(before!.space_id).toBeNull();
    const main = await space(property, "Dormitorio principal");
    const second = await space(property, "Dormitorio 2", "bedroom", 1);
    expect(main).not.toBe(second);
    await db.query("update demo_photos set space_id=$1 where id=$2", [second, photo]);
    // Deleting the space keeps the photo, its project and its generation; it goes back to unassigned.
    await db.query("delete from property_spaces where id=$1", [second]);
    const after = await one<typeof before>("select position,room,visible,project_id,space_id from demo_photos where id=$1", [photo]);
    expect(after).toEqual({ ...before });
    expect((await one<{ n: number }>("select count(*)::int as n from projects where id=$1", [project]))!.n).toBe(1);
    expect((await one<{ n: number }>("select count(*)::int as n from generations where id=$1", [job]))!.n).toBe(1);
  });

  it("refuses a space of another property", async () => {
    const admin = await account();
    const a = await prospect(admin);
    const b = await prospect(admin);
    const other = await space(b.property, "Living", "living");
    await expect(db.query("update demo_photos set space_id=$1 where id=$2", [other, a.photo])).rejects.toThrow(/foreign key/);
  });
});

describe("Idempotent free credits and balances for the team", () => {
  const give = (key: string, actor: string, agency: string, photos: number) =>
    one<{ r: { applied: string; replay: boolean } }>("select habita_agency_credit_once($1,$2,$3,$4,'Regalo de bienvenida') as r", [key, actor, agency, photos]);

  it("credits once per request key, and refuses the key for another grant", async () => {
    const admin = await account();
    const owner = await account();
    const agency = await createAgency(owner, "Una Vez", `una-vez-${id().slice(-6)}`);
    const start = await credits(owner);
    const key = id();
    expect((await give(key, admin, agency, 3))!.r).toMatchObject({ applied: "owner", replay: false });
    expect((await give(key, admin, agency, 3))!.r).toMatchObject({ applied: "owner", replay: true });
    expect(await credits(owner)).toBe(start + 3);
    await expect(give(key, admin, agency, 4)).rejects.toThrow(/KEY_REUSED/);
    // A new intentional grant is a new key.
    await give(id(), admin, agency, 3);
    expect(await credits(owner)).toBe(start + 6);
  });

  it("reads available and reserved credits apart, and unknown without an owner", async () => {
    const admin = await account();
    const { agency: prospectAgency } = await prospect(admin);
    await give(id(), admin, prospectAgency, 2);
    const owner = await account();
    const owned = await createAgency(owner, "Con Saldo", `con-saldo-${id().slice(-6)}`);
    await paid(owner, 7);
    const rows = (await db.query<{ agency_id: string; available: number | null; reserved: number }>(
      "select * from habita_admin_agency_balances($1)",
      [[prospectAgency, owned]],
    )).rows;
    const by = Object.fromEntries(rows.map((r) => [r.agency_id, r]));
    expect(by[prospectAgency]).toMatchObject({ available: null, reserved: 12 });
    expect(by[owned].available).toBe(await credits(owner));
    expect(by[owned].reserved).toBe(0);
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
    await db.query("insert into property_spaces(property_id,name) values($1,'Living')", [mine.property]);
    expect(await as<{ name: string }>(owner, "select name from property_spaces")).toEqual([{ name: "Living" }]);
    expect(await as(stranger, "select id from property_spaces")).toEqual([]);
    await expect(as(owner, `insert into property_spaces(property_id,name) values('${mine.property}','X')`)).rejects.toThrow(/permission denied/);
    void theirs;
  });

  it("keeps the agency RPCs for the server only", async () => {
    for (const fn of [
      "public.habita_create_agency(uuid,text,text)",
      "public.habita_claim_agency(uuid,text,text)",
      "public.habita_free_slug(text,uuid)",
      "public.habita_agency_counts(uuid)",
      "public.habita_admin_agencies(text,integer,integer)",
      "public.habita_agency_credit(uuid,uuid,integer,text)",
      "public.habita_apply_agency_credits(uuid)",
      "public.habita_agency_credit_once(uuid,uuid,uuid,integer,text)",
      "public.habita_admin_agency_balances(uuid[])",
    ])
      for (const role of ["anon", "authenticated"])
        expect((await one<{ ok: boolean }>("select has_function_privilege($1,$2,'execute') as ok", [role, fn]))!.ok).toBe(false);
  });

  it("can be applied again without errors, and keeps refusing revoked invitations", async () => {
    await expect(db.exec(readFileSync(MIGRATION, "utf8"))).resolves.toBeTruthy();
    await expect(db.exec(readFileSync(RELIABILITY, "utf8"))).resolves.toBeTruthy();
    await expect(db.exec(readFileSync("supabase/migrations/202610300001_agency_free_credits.sql", "utf8"))).resolves.toBeTruthy();
    await expect(db.exec(readFileSync("supabase/migrations/202610310001_property_spaces.sql", "utf8"))).resolves.toBeTruthy();
    const admin = await account();
    const { agency } = await prospect(admin);
    const hash = await claimCode(agency, admin);
    await db.query("update agency_claims set revoked_at=now() where code_hash=$1", [hash]);
    await expect(claim(await account(), hash)).rejects.toThrow(/CLAIM_INVALID/);
  });
});

describe("Administrative editing (202611030001)", () => {
  const as = async <T>(user: string, sql: string) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec("set role authenticated");
    try {
      return (await db.query<T>(sql)).rows;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };

  it("keeps the agency's contact e-mail private to the team, like its notes", async () => {
    const admin = await account();
    const { agency } = await prospect(admin);
    await db.query("update agencies set contact_email='ana@russillo.test' where id=$1", [agency]);
    const owner = await account();
    await claim(owner, await claimCode(agency, admin), `russillo-${n}`);
    expect(await as<{ id: string }>(owner, "select id from agencies")).toEqual([{ id: agency }]);
    await expect(as(owner, "select contact_email from agencies")).rejects.toThrow(/permission denied/);
  });

  it("creates one agency per request key and one manual property per agency and key", async () => {
    const key = id();
    await db.query("insert into agencies(name,request_key) values('Martín Propiedades',$1)", [key]);
    await expect(db.query("insert into agencies(name,request_key) values('Martín Propiedades',$1)", [key])).rejects.toThrow(/duplicate key/);
    const agency = (await one<{ id: string }>("select id from agencies where request_key=$1", [key]))!.id;
    const other = (await one<{ id: string }>("insert into agencies(name) values('Otra') returning id"))!.id;
    const pkey = id();
    await db.query("insert into demo_properties(agency_id,title,request_key) values($1,'PH',$2)", [agency, pkey]);
    await expect(db.query("insert into demo_properties(agency_id,title,request_key) values($1,'PH',$2)", [agency, pkey])).rejects.toThrow(/duplicate key/);
    // The same key in another agency is another request.
    await expect(db.query("insert into demo_properties(agency_id,title,request_key) values($1,'PH',$2)", [other, pkey])).resolves.toBeTruthy();
    // Rows without a key (every earlier one) are unaffected.
    await db.query("insert into agencies(name) values('Sin clave'),('Sin clave')");
  });

  it("can be applied again without errors", async () => {
    await expect(db.exec(readFileSync("supabase/migrations/202611030001_admin_editing.sql", "utf8"))).resolves.toBeTruthy();
  });
});

describe("Photo groups without a ficha (202611040001)", () => {
  it("counts only fichas: a group is neither a property nor published", async () => {
    // Earlier tests re-apply older migrations, which redefine the counts: apply this one again first.
    await db.exec(readFileSync("supabase/migrations/202611040001_photo_groups.sql", "utf8"));
    const admin = await account();
    const agency = await createAgency(admin, "Grupos Sur", "grupos-sur");
    const ficha = (await one<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Casa') returning id", [agency]))!.id;
    const group = (await one<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Fotos') returning id", [agency]))!.id;
    await db.query("insert into demos(agency_id,property_id,token,status,kind) values($1,$2,$3,'draft','ficha')", [agency, ficha, `tok_${id().replace(/-/g, "")}`]);
    await db.query("insert into demos(agency_id,property_id,token,status,kind) values($1,$2,$3,'draft','fotos')", [agency, group, `tok_${id().replace(/-/g, "")}`]);
    const counts = (await one<{ c: { total: number; published: number } }>("select habita_agency_counts($1) as c", [agency]))!.c;
    expect(counts).toMatchObject({ total: 1, published: 0 });
  });

  it("defaults existing and new demos to fichas, and refuses any other kind", async () => {
    const admin = await account();
    const agency = await createAgency(admin, "Tipos Sur", "tipos-sur");
    const property = (await one<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Casa') returning id", [agency]))!.id;
    await db.query("insert into demos(agency_id,property_id,token,status) values($1,$2,$3,'draft')", [agency, property, `tok_${id().replace(/-/g, "")}`]);
    const kinds = await db.query<{ kind: string }>("select kind from demos where agency_id=$1", [agency]);
    expect(kinds.rows.map((r) => r.kind)).toEqual(["ficha"]);
    const other = (await one<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Otra') returning id", [agency]))!.id;
    await expect(
      db.query("insert into demos(agency_id,property_id,token,status,kind) values($1,$2,$3,'draft','otro')", [agency, other, `tok_${id().replace(/-/g, "")}`]),
    ).rejects.toThrow();
  });

  it("can be applied again without errors", async () => {
    await expect(db.exec(readFileSync("supabase/migrations/202611040001_photo_groups.sql", "utf8"))).resolves.toBeTruthy();
  });
});

describe("Users of an agency (202611110001)", () => {
  const TEAM = "supabase/migrations/202611110001_agency_team.sql";
  async function invite(agency: string, owner: string, email: string, role: string, props: string[] | null = null, expires = "now()+interval '14 days'") {
    const hash = createHash("sha256").update(`join-${id()}`).digest("hex");
    await db.query(
      `insert into agency_invites(agency_id,email,role,property_ids,code_hash,created_by,expires_at) values($1,$2,$3,$4,$5,$6,${expires})`,
      [agency, email, role, props, hash, owner],
    );
    return hash;
  }
  const join = (user: string, email: string, hash: string) => db.query("select habita_join_agency($1,$2,$3) as id", [user, email, hash]);

  it("joins the invited e-mail once, with its role and only the agency's own properties", async () => {
    const owner = await account();
    const agency = await createAgency(owner, "Equipo Norte", "equipo-norte");
    const other = await createAgency(await account(), "Otra", "otra-inmo");
    const mine = (await one<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Casa') returning id", [agency]))!.id;
    const theirs = (await one<{ id: string }>("insert into demo_properties(agency_id,title) values($1,'Ajena') returning id", [other]))!.id;
    const hash = await invite(agency, owner, "laura@norte.test", "viewer", [mine, theirs]);
    const employee = await account();
    await expect(join(employee, "otra@norte.test", hash)).rejects.toThrow(/INVITE_EMAIL/);
    await join(employee, "Laura@Norte.test", hash);
    expect(await one("select role,property_ids from agency_members where user_id=$1", [employee])).toEqual({ role: "viewer", property_ids: [mine] });
    await expect(join(await account(), "laura@norte.test", hash)).rejects.toThrow(/INVITE_INVALID/);
  });

  it("refuses expired links, accounts of another agency and limits for administrators", async () => {
    const owner = await account();
    const agency = await createAgency(owner, "Equipo Sur", "equipo-sur");
    const expired = await invite(agency, owner, "a@sur.test", "editor", null, "now()-interval '1 minute'");
    await expect(join(await account(), "a@sur.test", expired)).rejects.toThrow(/INVITE_INVALID/);
    const busy = await invite(agency, owner, "b@sur.test", "editor");
    await expect(join(owner, "b@sur.test", busy)).rejects.toThrow(/INVITE_EMAIL|AGENCY_EXISTS/);
    const outsider = await account();
    await createAgency(outsider, "Propia", "propia-inmo");
    await expect(join(outsider, "b@sur.test", busy)).rejects.toThrow(/AGENCY_EXISTS/);
    await expect(invite(agency, owner, "c@sur.test", "admin", [id()])).rejects.toThrow();
    await expect(invite(agency, owner, "d@sur.test", "owner")).rejects.toThrow();
  });

  it("keeps one open access per e-mail and agency, and the RPC for the server only", async () => {
    const owner = await account();
    const agency = await createAgency(owner, "Equipo Oeste", "equipo-oeste");
    await invite(agency, owner, "e@oeste.test", "editor");
    await expect(invite(agency, owner, "e@oeste.test", "viewer")).rejects.toThrow();
    const grants = await one<{ ok: boolean }>("select has_function_privilege('authenticated','public.habita_join_agency(uuid,text,text)','execute') as ok");
    expect(grants!.ok).toBe(false);
  });

  it("turns old collaborators into editors and can be applied again", async () => {
    await db.exec(readFileSync(TEAM, "utf8"));
    await expect(db.query("insert into agency_members(agency_id,user_id,role) values($1,$2,'collaborator')", [await createAgency(await account(), "X", "equipo-x"), await account()])).rejects.toThrow();
  });
});

describe("Releasing a test claim (202611150001)", () => {
  const release = (agency: string, actor: string) =>
    db.query<{ r: { photos: number; properties: number; credits: number } }>("select habita_release_agency($1,$2) as r", [agency, actor]);

  it("leaves the agency as before the claim: demo photos back to the team, test properties gone, unused gift credits reserved again", async () => {
    const admin = await account();
    const { agency, property, project, job } = await prospect(admin);
    await db.query("update demos set created_by=$1 where property_id=$2", [admin, property]);
    await db.query("update agencies set free_credits_pending=10 where id=$1", [agency]);
    const pending = await claimCode(agency, admin);
    const tester = await account();
    await claim(tester, await claimCode(agency, admin));
    await db.query("select habita_apply_agency_credits($1)", [agency]);
    await db.query("select habita_record_agency_activity($1)", [agency]);
    expect(await credits(tester)).toBe(10);
    // The tester's own property, with a photo.
    const own = (await one<{ id: string }>("insert into demo_properties(agency_id,title,created_by) values($1,'Prueba',$2) returning id", [agency, tester]))!.id;
    await db.query("insert into demos(agency_id,property_id,token,created_by) values($1,$2,$3,$4)", [agency, own, `tok_${id().replace(/-/g, "")}`, tester]);
    const ownProject = id();
    await db.query("insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values($1,$2,$3,'a/x.jpg','Foto',100)", [ownProject, tester, `demo:${id()}`]);
    await db.query("insert into demo_photos(property_id,project_id) values($1,$2)", [own, ownProject]);

    const other = await account();
    expect((await release(agency, other)).rows[0].r).toEqual({ photos: 1, properties: 1, credits: 10 });
    expect(await one("select owner_id,claimed_at,free_credits_pending from agencies where id=$1", [agency])).toEqual({ owner_id: null, claimed_at: null, free_credits_pending: 10 });
    expect((await one<{ n: number }>("select count(*)::int as n from agency_members where agency_id=$1", [agency]))!.n).toBe(0);
    // Back to the demo's creator, not to whoever released it.
    expect((await one<{ user_id: string }>("select user_id from projects where id=$1", [project]))!.user_id).toBe(admin);
    expect((await one<{ user_id: string }>("select user_id from generations where id=$1", [job]))!.user_id).toBe(admin);
    expect(await one("select count(*)::int as n from demo_properties where id=$1", [own])).toEqual({ n: 0 });
    expect((await one<{ gone: boolean }>("select deleted_at is not null as gone from projects where id=$1", [ownProject]))!.gone).toBe(true);
    expect(await credits(tester)).toBe(0);
    expect(await one("select activity_level from demos where property_id=$1", [property])).toEqual({ activity_level: 0 });
    // The invitation links not used yet work again; the team can stage the demo for free again.
    const real = await account();
    expect((await claim(real, pending)).rows[0].id).toBe(agency);
    await db.query("select habita_apply_agency_credits($1)", [agency]);
    expect(await credits(real)).toBe(10);
  });

  it("refuses an agency without an account or whose account paid", async () => {
    const admin = await account();
    const { agency } = await prospect(admin);
    await expect(release(agency, admin)).rejects.toThrow(/NO_OWNER/);
    const owner = await account();
    await claim(owner, await claimCode(agency, admin));
    const order = (await one<{ id: string }>("insert into orders(user_id,sku,snapshot) select $1,sku,'{}' from products limit 1 returning id", [owner]))!.id;
    const pay = `pay-${id()}`;
    await db.query("insert into payments(id,order_id,user_id,status,amount_cents,paid_at) values($1,$2,$3,'approved',100,now())", [pay, order, owner]);
    await db.query("insert into credit_grants(user_id,source_key,payment_id,total,remaining) values($1,$2,$3,5,5)", [owner, `pay:${pay}`, pay]);
    await expect(release(agency, admin)).rejects.toThrow(/AGENCY_PAID/);
  });

  it("is for the server only", async () => {
    for (const role of ["anon", "authenticated"])
      expect((await one<{ ok: boolean }>("select has_function_privilege($1,'public.habita_release_agency(uuid,uuid)','execute') as ok", [role]))!.ok).toBe(false);
  });
});

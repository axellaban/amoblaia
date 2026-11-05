import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Equipo y accesos (202611260001_workspace_access.sql), on a real Postgres:
// principal administrator, requests to join, transfers and their concurrency.
let db: PGlite;
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(700000000000 + ++n).padStart(12, "0")}`;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
   create table auth.users(id uuid primary key, is_anonymous boolean not null default false);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   grant usage on schema public to authenticated;`);
  for (const file of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}, 60000);
afterAll(async () => await db?.close());

async function account() {
  const user = id();
  await db.query("insert into auth.users(id) values($1)", [user]);
  await db.query("select amobla_account($1,false)", [user]);
  return user;
}
const fails = async (sql: string, params: unknown[], code: string) => {
  await expect(db.query(sql, params)).rejects.toThrow(code);
};
const principal = async (agency: string) => (await one<{ p: string | null }>("select habita_principal($1) as p", [agency]))!.p;
const role = async (agency: string, user: string) =>
  (await one<{ role: string }>("select role from agency_members where agency_id=$1 and user_id=$2", [agency, user]))?.role ?? null;
const balance = async (user: string) => (await one<{ c: number }>("select (amobla_account($1,false)->>'credits')::int as c", [user]))!.c;

/** An agency with its owner (principal by default) and one member of each extra role. */
async function agency() {
  const owner = await account();
  const a = (await one<{ id: string }>("select habita_create_agency($1,'Frejo Gustavo',$2) as id", [owner, `frejo-${n}`]))!.id;
  const join = async (r: string) => {
    const u = await account();
    await db.query("insert into agency_members(agency_id,user_id,role) values($1,$2,$3)", [a, u, r]);
    return u;
  };
  return { a, owner, join };
}

describe("Administración principal", () => {
  it("an agency created or claimed gets its owner as principal; existing ones are backfilled", async () => {
    const { a, owner } = await agency();
    expect((await one<{ principal_id: string }>("select principal_id from agencies where id=$1", [a]))!.principal_id).toBe(owner);
    expect(await principal(a)).toBe(owner);
    // Claimed through the team's one-time code: the trigger sets it too.
    const admin = await account();
    const prospect = (await one<{ id: string }>("insert into agencies(name) values('Russillo') returning id"))!.id;
    const hash = createHash("sha256").update(`c-${n}`).digest("hex");
    await db.query("insert into agency_claims(agency_id,code_hash,created_by,expires_at) values($1,$2,$3,now()+interval '1 day')", [prospect, hash, admin]);
    const agent = await account();
    await db.query("select habita_claim_agency($1,$2,'russillo')", [agent, hash]);
    expect(await principal(prospect)).toBe(agent);
  });

  it("the principal cannot be cleared: an agency with an owner always has one", async () => {
    const { a, owner } = await agency();
    await db.query("update agencies set principal_id=null where id=$1", [a]);
    expect(await principal(a)).toBe(owner);
  });
});

describe("Solicitudes de acceso (Journey C)", () => {
  it("asks once, approves as Miembro, never duplicates and never grants by itself", async () => {
    const { a, owner } = await agency();
    const visitor = await account();
    const first = (await one<{ r: { id: string; created: boolean } }>("select habita_request_access($1,$2,'Visita@Mail.test','demo',null) as r", [visitor, a]))!.r;
    expect(first.created).toBe(true);
    const again = (await one<{ r: { id: string; created: boolean } }>("select habita_request_access($1,$2,'visita@mail.test','demo',null) as r", [visitor, a]))!.r;
    expect(again).toMatchObject({ id: first.id, created: false });
    expect(await role(a, visitor)).toBeNull();
    expect((await one<{ email: string }>("select email from agency_access_requests where id=$1", [first.id]))!.email).toBe("visita@mail.test");

    await db.query("select habita_resolve_access_request($1,$2,$3,true)", [owner, a, first.id]);
    expect(await role(a, visitor)).toBe("editor");
    // Answered once: a second answer is refused.
    await fails("select habita_resolve_access_request($1,$2,$3,false)", [owner, a, first.id], "REQUEST_CLOSED");
    // Already in: asking again says so.
    await fails("select habita_request_access($1,$2,'','demo',null)", [visitor, a], "ALREADY_MEMBER");
  });

  it("only administrators answer; a rejected request leaves no access", async () => {
    const { a, owner, join } = await agency();
    const member = await join("editor");
    const visitor = await account();
    const req = (await one<{ r: { id: string } }>("select habita_request_access($1,$2,'','link',null) as r", [visitor, a]))!.r;
    await fails("select habita_resolve_access_request($1,$2,$3,true)", [member, a, req.id], "NOT_ADMIN");
    await db.query("select habita_resolve_access_request($1,$2,$3,false)", [owner, a, req.id]);
    expect(await role(a, visitor)).toBeNull();
    expect((await one<{ status: string }>("select status from agency_access_requests where id=$1", [req.id]))!.status).toBe("rejected");
    // An administrator of another agency cannot answer this one's requests.
    const other = await agency();
    const req2 = (await one<{ r: { id: string } }>("select habita_request_access($1,$2,'','link',null) as r", [visitor, a]))!.r;
    await fails("select habita_resolve_access_request($1,$2,$3,true)", [other.owner, other.a, req2.id], "NOT_ADMIN");
    await fails("select habita_resolve_access_request($1,$2,$3,true)", [other.owner, a, req2.id], "NOT_ADMIN");
  });

  it("an account of another agency cannot ask (one agency per account), nor approved into a second one", async () => {
    const { a, owner } = await agency();
    const other = await agency();
    await fails("select habita_request_access($1,$2,'','demo',null)", [other.owner, a], "AGENCY_EXISTS");
    const visitor = await account();
    const req = (await one<{ r: { id: string } }>("select habita_request_access($1,$2,'','demo',null) as r", [visitor, a]))!.r;
    await db.query("insert into agency_members(agency_id,user_id,role) values($1,$2,'editor')", [other.a, visitor]);
    await fails("select habita_resolve_access_request($1,$2,$3,true)", [owner, a, req.id], "AGENCY_EXISTS");
  });

  it("caps the open requests of one account", async () => {
    const visitor = await account();
    for (let i = 0; i < 5; i++) {
      const { a } = await agency();
      await db.query("select habita_request_access($1,$2,'','demo',null)", [visitor, a]);
    }
    const { a } = await agency();
    await fails("select habita_request_access($1,$2,'','demo',null)", [visitor, a], "TOO_MANY_REQUESTS");
  });
});

describe("Transferencia de la administración (Journey D)", () => {
  it("a member asks, the principal approves: the requester becomes principal and administrator; credits and owner stay", async () => {
    const { a, owner, join } = await agency();
    const titular = await join("editor");
    const before = await balance(owner);
    const t = (await one<{ r: { id: string; created: boolean } }>("select habita_request_admin_transfer($1,$2) as r", [titular, a]))!.r;
    expect(t.created).toBe(true);
    // Asking again answers the same request.
    expect((await one<{ r: { id: string } }>("select habita_request_admin_transfer($1,$2) as r", [titular, a]))!.r.id).toBe(t.id);
    await db.query("select habita_resolve_admin_transfer($1,$2,$3,true,false)", [owner, a, t.id]);
    expect(await principal(a)).toBe(titular);
    expect(await role(a, titular)).toBe("admin");
    // The previous principal keeps its access; the billing account and its balance do not move.
    expect(await role(a, owner)).toBe("owner");
    expect((await one<{ owner_id: string }>("select owner_id from agencies where id=$1", [a]))!.owner_id).toBe(owner);
    expect(await balance(owner)).toBe(before);
    const audit = await one<{ c: number }>("select count(*)::int as c from admin_audit where subject_id=$1 and action like 'agency_admin_transfer%'", [a]);
    expect(audit!.c).toBe(2);
  });

  it("only the principal approves; any member asking is not enough; rejecting changes nothing", async () => {
    const { a, owner, join } = await agency();
    const admin = await join("admin");
    const member = await join("editor");
    const t = (await one<{ r: { id: string } }>("select habita_request_admin_transfer($1,$2) as r", [member, a]))!.r;
    await fails("select habita_resolve_admin_transfer($1,$2,$3,true,false)", [admin, a, t.id], "NOT_PRINCIPAL");
    await fails("select habita_resolve_admin_transfer($1,$2,$3,true,false)", [member, a, t.id], "NOT_PRINCIPAL");
    await db.query("select habita_resolve_admin_transfer($1,$2,$3,false,false)", [owner, a, t.id]);
    expect(await principal(a)).toBe(owner);
    expect(await role(a, member)).toBe("editor");
    await fails("select habita_resolve_admin_transfer($1,$2,$3,true,false)", [owner, a, t.id], "TRANSFER_CLOSED");
    // Outsiders and the principal itself cannot ask.
    const outsider = await account();
    await fails("select habita_request_admin_transfer($1,$2)", [outsider, a], "NOT_MEMBER");
    await fails("select habita_request_admin_transfer($1,$2)", [owner, a], "ALREADY_PRINCIPAL");
  });

  it("two requests at once: approving one supersedes the other, which can no longer be approved", async () => {
    const { a, owner, join } = await agency();
    const x = await join("editor");
    const y = await join("admin");
    const tx = (await one<{ r: { id: string } }>("select habita_request_admin_transfer($1,$2) as r", [x, a]))!.r;
    const ty = (await one<{ r: { id: string } }>("select habita_request_admin_transfer($1,$2) as r", [y, a]))!.r;
    await db.query("select habita_resolve_admin_transfer($1,$2,$3,true,false)", [owner, a, tx.id]);
    expect((await one<{ status: string }>("select status from agency_admin_transfers where id=$1", [ty.id]))!.status).toBe("superseded");
    await fails("select habita_resolve_admin_transfer($1,$2,$3,true,false)", [owner, a, ty.id], "TRANSFER_CLOSED");
    expect(await principal(a)).toBe(x);
  });

  it("the team approves after verifying ownership when the principal does not answer", async () => {
    const { a, join } = await agency();
    const titular = await join("viewer");
    const team = await account();
    const t = (await one<{ r: { id: string } }>("select habita_request_admin_transfer($1,$2) as r", [titular, a]))!.r;
    await db.query("select habita_resolve_admin_transfer($1,$2,$3,true,true)", [team, a, t.id]);
    expect(await principal(a)).toBe(titular);
    expect(await role(a, titular)).toBe("admin");
    expect((await one<{ resolution: string }>("select resolution from agency_admin_transfers where id=$1", [t.id]))!.resolution).toBe("support");
  });

  it("the principal hands the role directly; a removed principal falls back to the owner", async () => {
    const { a, owner, join } = await agency();
    const admin = await join("admin");
    await fails("select habita_transfer_principal($1,$2,$3)", [admin, a, admin], "NOT_PRINCIPAL");
    await db.query("select habita_transfer_principal($1,$2,$3)", [owner, a, admin]);
    expect(await principal(a)).toBe(admin);
    await fails("select habita_transfer_principal($1,$2,$3)", [admin, a, await account()], "NOT_MEMBER");
    // If that account leaves the agency, the owner is the principal again: never none.
    await db.query("delete from agency_members where agency_id=$1 and user_id=$2", [a, admin]);
    expect(await principal(a)).toBe(owner);
  });

  it("browsers cannot call the functions nor read the new tables", async () => {
    const rows = await db.query<{ fn: string; ok: boolean }>(
      `select p.proname as fn, has_function_privilege('authenticated', p.oid, 'execute') as ok
       from pg_proc p join pg_namespace s on s.oid=p.pronamespace
       where s.nspname='public' and p.proname in ('habita_request_access','habita_resolve_access_request','habita_request_admin_transfer','habita_resolve_admin_transfer','habita_transfer_principal','habita_set_principal','habita_principal')`,
    );
    expect(rows.rows.length).toBe(7);
    expect(rows.rows.every((r) => !r.ok)).toBe(true);
    for (const t of ["agency_access_requests", "agency_admin_transfers"])
      expect((await one<{ ok: boolean }>(`select has_table_privilege('authenticated','public.${t}','select') as ok`))!.ok).toBe(false);
  });
});

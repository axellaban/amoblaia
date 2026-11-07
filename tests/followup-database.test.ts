import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const fails = async (sql: string, params: unknown[] = []) => {
  try {
    await db.query(sql, params);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

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

const active = async (stage: string) => (await one<{ id: string; version: number }>("select id, version from followup_versions where stage = $1 and status = 'active'", [stage]))!;
const agency = async () => (await one<{ id: string }>("insert into agencies(name) values('Ribera Propiedades') returning id"))!.id;

describe("followup migration", () => {
  it("starts every stage with an active V1", async () => {
    const rows = (await db.query<{ stage: string }>("select stage from followup_versions where status = 'active' and version = 1")).rows;
    expect(rows).toHaveLength(9);
  });

  it("is idempotent", async () => {
    await db.exec(readFileSync("supabase/migrations/202611300001_followup.sql", "utf8"));
    expect((await one<{ n: number }>("select count(*)::int as n from followup_versions"))!.n).toBe(9);
  });

  it("never edits or deletes a saved version: only its status changes", async () => {
    const v = await active("no-responde");
    expect(await fails("update followup_versions set body = 'otro' where id = $1", [v.id])).toContain("FOLLOWUP_VERSION_FROZEN");
    expect(await fails("delete from followup_versions where id = $1", [v.id])).toContain("FOLLOWUP_VERSION_FROZEN");
  });

  it("creates the next version: active archives the previous active, test leaves it", async () => {
    const before = await active("no-abrio");
    const v2 = (await one<{ version: number; status: string }>("select * from habita_followup_create(null, 'no-abrio', 'whatsapp', ' 2 días ', 'Nuevo {{demo}}', '{whatsapp,demo}', 'active')"))!;
    expect(v2).toMatchObject({ version: 2, status: "active" });
    expect((await one<{ status: string }>("select status from followup_versions where id = $1", [before.id]))!.status).toBe("archived");
    const v3 = (await one<{ id: string; version: number; status: string }>("select * from habita_followup_create(null, 'no-abrio', 'whatsapp', '', 'Prueba', '{whatsapp}', 'test')"))!;
    expect(v3).toMatchObject({ version: 3, status: "test" });
    expect((await active("no-abrio")).version).toBe(2);
    // Only one active and one test per stage.
    expect(await fails("insert into followup_versions(stage, version, channel, body, status) values('no-abrio', 9, 'whatsapp', 'x', 'test')")).not.toBeNull();
    // Promoting the test archives the active.
    await db.query("select habita_followup_set_status($1, 'active')", [v3.id]);
    expect((await active("no-abrio")).version).toBe(3);
    expect((await one<{ n: number }>("select count(*)::int as n from followup_versions where stage = 'no-abrio' and status <> 'archived'"))!.n).toBe(1);
  });

  it("does not archive the active version on its own", async () => {
    const v = await active("sin-uso");
    expect(await fails("select habita_followup_set_status($1, 'archived')", [v.id])).toContain("FOLLOWUP_ACTIVE_REQUIRED");
  });

  it("rejects an unknown CTA or stage", async () => {
    expect(await fails("select habita_followup_create(null, 'sin-uso', 'whatsapp', '', 'x', '{fax}', 'active')")).not.toBeNull();
    expect(await fails("select habita_followup_create(null, 'otra', 'whatsapp', '', 'x', '{}', 'active')")).not.toBeNull();
  });

  it("records one execution per version and agency, and a sent one never goes back", async () => {
    const a = await agency();
    const v = await active("sin-cuenta");
    const mark = (status: string, step = 5, reason: string | null = null) =>
      one<{ status: string; from_step: number; sent_at: string | null }>("select * from habita_followup_mark(null, $1, $2, $3, $4, $5)", [v.id, a, step, status, reason]);
    expect(await mark("opened")).toMatchObject({ status: "opened", sent_at: null });
    expect(await mark("sent")).toMatchObject({ status: "sent", from_step: 5 });
    expect(await mark("failed", 6, "Sin señal")).toMatchObject({ status: "sent", from_step: 5 });
    expect((await one<{ n: number }>("select count(*)::int as n from followup_executions where agency_id = $1", [a]))!.n).toBe(1);
  });

  it("is closed to anonymous and signed-in users", async () => {
    const grants = (await db.query<{ grantee: string }>("select grantee from information_schema.role_table_grants where table_name in ('followup_versions', 'followup_executions') and grantee in ('anon', 'authenticated')")).rows;
    expect(grants).toEqual([]);
  });
});

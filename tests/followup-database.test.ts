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
    for (const file of ["202611300001_followup.sql", "202612010001_followup_edit.sql"]) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    expect((await one<{ n: number }>("select count(*)::int as n from followup_versions"))!.n).toBe(9);
  });

  it("edits a version's text and observations, but never its stage or number, and never deletes it", async () => {
    const v = await active("no-responde");
    expect(await fails("update followup_versions set body = 'otro', notes = 'Solo de 9 a 19', edited_at = now() where id = $1", [v.id])).toBeNull();
    expect((await one<{ body: string; notes: string }>("select body, notes from followup_versions where id = $1", [v.id]))).toEqual({ body: "otro", notes: "Solo de 9 a 19" });
    expect(await fails("update followup_versions set stage = 'sin-uso' where id = $1", [v.id])).toContain("FOLLOWUP_VERSION_FROZEN");
    expect(await fails("update followup_versions set version = 7 where id = $1", [v.id])).toContain("FOLLOWUP_VERSION_FROZEN");
    expect(await fails("delete from followup_versions where id = $1", [v.id])).toContain("FOLLOWUP_VERSION_FROZEN");
  });

  it("keeps a corrected stage with the step it corrected, the manual score in range, and one script", async () => {
    const a = await agency();
    expect(await fails("insert into followup_agencies(agency_id, stage_override) values($1, 'sin-demo')", [a])).not.toBeNull();
    expect(await fails("insert into followup_agencies(agency_id, stage_override, override_step) values($1, 'otra', 0)", [a])).not.toBeNull();
    expect(await fails("insert into followup_agencies(agency_id, score) values($1, 120)", [a])).not.toBeNull();
    expect(await fails("insert into followup_agencies(agency_id, stage_override, override_step, score, zone) values($1, 'fuera', 0, 75, 'Batán')", [a])).toBeNull();
    expect((await one<{ n: number }>("select count(*)::int as n from followup_script"))!.n).toBe(1);
    expect(await fails("insert into followup_script(id, body) values(2, 'otro')")).not.toBeNull();
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
    const grants = (await db.query<{ grantee: string }>("select grantee from information_schema.role_table_grants where table_name in ('followup_versions', 'followup_executions', 'followup_agencies', 'followup_script') and grantee in ('anon', 'authenticated')")).rows;
    expect(grants).toEqual([]);
  });
});

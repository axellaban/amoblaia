import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect, describe } from "vitest";
import {
  guestToken,
  verifyGuestToken,
  GUEST_SECONDS,
} from "../src/lib/guest-token";
let db: PGlite;
const guest = "00000000-0000-4000-8000-000000000031",
  user = "00000000-0000-4000-8000-000000000032",
  project = "00000000-0000-4000-8000-000000000033",
  second = "00000000-0000-4000-8000-000000000034";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;insert into auth.users values('${guest}'),('${user}'),('${second}');`,
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query(
    "select amobla_register_guest($1,'qa-network'),amobla_account($2,true)",
    [guest, user],
  );
  await db.exec(
    `insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values('${project}','${guest}','hash','guest/original.jpg','Mi foto',100);`,
  );
}, 30000);
afterAll(async () => await db?.close());
describe("Anonymous trial and account conversion", () => {
  it("does not expose guest sessions or the claim RPC to clients", async () => {
    const r = await db.query<{ allowed: boolean }>(
      "select has_function_privilege('authenticated','amobla_claim_guest(uuid,uuid)','execute') as allowed",
    );
    expect(r.rows[0].allowed).toBe(false);
  });
  it("reserves free generations without a verified email and stops at 25", async () => {
    for (let i = 0; i < 25; i++) {
      const r = await db.query<{ id: string }>(
        "select amobla_reserve_generation($1,$2,gen_random_uuid(),'living','standard','furnish','','prompt') as id",
        [guest, project],
      );
      await db.query("select amobla_claim_generation($1)", [r.rows[0].id]);
      await db.query(
        "select amobla_finish_generation($1,'succeeded','result.jpg',100)",
        [r.rows[0].id],
      );
    }
    await expect(
      db.query(
        "select amobla_reserve_generation($1,$2,gen_random_uuid(),'living','modern','furnish','','prompt')",
        [guest, project],
      ),
    ).rejects.toThrow(/GUEST_LIMIT|FREE_LIMIT/);
  });
  it("does not reset free usage when a new guest uses the same network", async () => {
    await db.query("select amobla_register_guest($1,'qa-network')", [second]);
    const r = await db.query<{ a: { freeRemaining: number } }>(
      "select amobla_account($1,true) as a",
      [second],
    );
    expect(r.rows[0].a.freeRemaining).toBe(0);
  });
  it("moves the photo and usage into Google account once, and blocks the old guest", async () => {
    await db.query("select amobla_claim_guest($1,$2)", [guest, user]);
    await db.query("select amobla_claim_guest($1,$2)", [guest, user]);
    const r = await db.query<{
      a: { freeRemaining: number; freeUsed: number };
    }>("select amobla_account($1,true) as a", [user]);
    expect(r.rows[0].a.freeRemaining).toBe(0);
    expect(r.rows[0].a.freeUsed).toBe(25);
    const p = await db.query<{ user_id: string; original_path: string }>(
      "select user_id,original_path from projects where id=$1",
      [project],
    );
    expect(p.rows[0].user_id).toBe(user);
    expect(p.rows[0].original_path).toBe("guest/original.jpg");
    const quota = await db.query<{ a: { freeRemaining: number } }>(
      "select amobla_account($1,true) as a",
      [second],
    );
    expect(quota.rows[0].a.freeRemaining).toBe(0);
    await expect(
      db.query(
        "select amobla_reserve_generation($1,$2,gen_random_uuid(),'living','modern','furnish','','prompt')",
        [guest, project],
      ),
    ).rejects.toThrow("ACCOUNT_BLOCKED");
  });
});
describe("Guest cookie authentication", () => {
  const key = "private-test-only-key-never-production";
  it("binds the user ID, signature and expiry, without trusting a browser body", () => {
    const token = guestToken(guest, key, 1000000);
    expect(verifyGuestToken(token, key, 1000000)).toBe(guest);
    expect(
      verifyGuestToken(token.replace(guest, user), key, 1000000),
    ).toBeNull();
    expect(verifyGuestToken(token, key + "x", 1000000)).toBeNull();
    expect(
      verifyGuestToken(token, key, 1000000 + GUEST_SECONDS * 1000),
    ).toBeNull();
    expect(verifyGuestToken(token + ".extra", key, 1000000)).toBeNull();
  });
});

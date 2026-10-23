import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import {
  vi,
  beforeAll,
  beforeEach,
  afterAll,
  it,
  expect,
  describe,
} from "vitest";

// A Supabase stand-in for syncUnlimited: the grant lookup answers from
// `state.grant`, and every write is recorded.
const state = vi.hoisted(() => ({
  grant: null as null | {
    id: string;
    remaining: number;
    expires_at: string | null;
  },
  writes: [] as {
    table: string;
    op: string;
    values: Record<string, unknown>;
  }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      let write: { op: string; values: Record<string, unknown> } | null = null;
      const done = () => {
        if (write) state.writes.push({ table, ...write });
        return write?.op === "insert" && table === "credit_grants"
          ? { data: { id: "new-grant" }, error: null }
          : { data: state.grant, error: null };
      };
      for (const m of ["select", "eq", "is"]) chain[m] = () => chain;
      chain.insert = (values: Record<string, unknown>) => {
        write = { op: "insert", values };
        return chain;
      };
      chain.update = (values: Record<string, unknown>) => {
        write = { op: "update", values };
        return chain;
      };
      chain.maybeSingle = async () => done();
      chain.single = async () => done();
      chain.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve(done()).then(ok);
      return chain;
    },
  }),
}));
import { isUnlimited, syncUnlimited } from "../src/lib/commerce/unlimited";

describe("syncUnlimited", () => {
  beforeEach(() => {
    vi.stubEnv("UNLIMITED_EMAILS", " Team@Example.com ,other@example.com");
    state.grant = null;
    state.writes = [];
  });
  it("matches listed emails regardless of case and spacing", () => {
    expect(isUnlimited("team@example.com")).toBe(true);
    expect(isUnlimited("OTHER@example.com")).toBe(true);
    expect(isUnlimited("customer@example.com")).toBe(false);
    expect(isUnlimited(null)).toBe(false);
    vi.stubEnv("UNLIMITED_EMAILS", "");
    expect(isUnlimited("team@example.com")).toBe(false);
  });
  it("opens a non-expiring allowance for a listed account", async () => {
    const sync = await syncUnlimited({ id: "u", email: "team@example.com" });
    expect(sync).toEqual({ unlimited: true, changed: true });
    expect(state.writes[0]).toMatchObject({
      table: "credit_grants",
      op: "insert",
      values: {
        user_id: "u",
        source_key: "unlimited:u",
        total: 1_000_000,
        remaining: 1_000_000,
      },
    });
    expect(state.writes[0].values).not.toHaveProperty("expires_at");
    expect(state.writes[1]).toMatchObject({
      table: "credit_ledger",
      values: { delta: 1_000_000, reason: "unlimited_access" },
    });
  });
  it("leaves an open allowance alone", async () => {
    state.grant = { id: "g", remaining: 999_000, expires_at: null };
    expect(await syncUnlimited({ id: "u", email: "team@example.com" })).toEqual(
      {
        unlimited: true,
        changed: false,
      },
    );
    expect(state.writes).toEqual([]);
  });
  it("closes the allowance once the email leaves the list, and reopens it when it returns", async () => {
    state.grant = { id: "g", remaining: 999_000, expires_at: null };
    vi.stubEnv("UNLIMITED_EMAILS", "other@example.com");
    expect(await syncUnlimited({ id: "u", email: "team@example.com" })).toEqual(
      {
        unlimited: false,
        changed: true,
      },
    );
    expect(state.writes[0]).toMatchObject({
      op: "update",
      values: { remaining: 0 },
    });
    expect(state.writes[0].values.expires_at).toEqual(expect.any(String));
    expect(state.writes[0].values).not.toHaveProperty("revoked");
    expect(state.writes[1].values).toMatchObject({
      delta: -999_000,
      reason: "unlimited_access_ended",
    });

    state.writes = [];
    state.grant = {
      id: "g",
      remaining: 0,
      expires_at: new Date().toISOString(),
    };
    vi.stubEnv("UNLIMITED_EMAILS", "team@example.com");
    expect(await syncUnlimited({ id: "u", email: "team@example.com" })).toEqual(
      {
        unlimited: true,
        changed: true,
      },
    );
    expect(state.writes[0]).toMatchObject({
      op: "update",
      values: { remaining: 1_000_000, expires_at: null },
    });
  });
  it("does nothing for accounts that never had it", async () => {
    expect(
      await syncUnlimited({ id: "u", email: "customer@example.com" }),
    ).toEqual({
      unlimited: false,
      changed: false,
    });
    expect(await syncUnlimited({ id: "guest", email: null })).toEqual({
      unlimited: false,
      changed: false,
    });
    expect(state.writes).toEqual([]);
  });
});

// The same grant against the real reservation functions.
describe("an unlimited allowance in the database", () => {
  let db: PGlite;
  const u = "00000000-0000-4000-8000-000000000071";
  const photo = (i: number) =>
    `00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;insert into auth.users values('${u}');`,
    );
    for (const file of readdirSync("supabase/migrations").sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.query("select amobla_account($1,false)", [u]);
    await db.query(
      "insert into credit_grants(user_id,source_key,total,remaining) values($1,$2,1000000,1000000)",
      [u, `unlimited:${u}`],
    );
    for (let i = 0; i < 15; i++)
      await db.query(
        "insert into projects(id,user_id,original_hash,original_path,name,original_bytes) values($1,$2,$3,'o.jpg','Foto',100)",
        [photo(i), u, `hash-${i}`],
      );
  }, 30000);
  afterAll(async () => await db?.close());
  const batch = async (i: number, limit: number) =>
    (
      await db.query<{ ids: string[] }>(
        "select amobla_reserve_batch($1,$2,gen_random_uuid(),'living','modern','furnish','',array['a','b','c'],$3) as ids",
        [u, photo(i), limit],
      )
    ).rows[0].ids;
  const finish = async (ids: string[]) => {
    for (const id of ids) {
      await db.query("select amobla_claim_generation($1)", [id]);
      await db.query(
        "select amobla_finish_generation($1,'succeeded','r.jpg',100)",
        [id],
      );
    }
  };
  it("renders past the usual per-account daily share, one photo spent per original", async () => {
    // 14 photos x 3 proposals = 42, above the share of 33 a day at the default limit.
    for (let i = 0; i < 14; i++) await finish(await batch(i, 1000));
    const { rows } = await db.query<{ credits: number }>(
      "select (amobla_account($1,false)->>'credits')::int as credits",
      [u],
    );
    expect(rows[0].credits).toBe(1_000_000 - 14);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from generations where is_free",
        )
      ).rows[0].n,
    ).toBe(0);
    await expect(batch(14, 100)).rejects.toThrow("USER_DAILY_LIMIT");
  });
  it("once closed, new photos need credits and existing ones stop regenerating", async () => {
    await db.query(
      "update credit_grants set remaining=0,expires_at=now() where source_key=$1",
      [`unlimited:${u}`],
    );
    await expect(batch(14, 1000)).rejects.toThrow("NO_CREDITS");
    await expect(batch(0, 1000)).rejects.toThrow("ENTITLEMENT_EXPIRED");
  });
});

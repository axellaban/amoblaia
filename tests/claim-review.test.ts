// Fase 4: creating the account stays instant; who took over each agency is
// recorded for the team (e-mail, method, whether it is the agency's domain).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const db = vi.hoisted(() => ({ agency: { website: "https://www.inmosur.com.ar", contact_email: "ana@gmail.com" } as Record<string, unknown> | null, updates: [] as unknown[], audits: [] as unknown[], fail: false }));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.agency, error: null }) }) }),
      update: (row: unknown) => ({
        eq: async () => {
          if (db.fail) return { error: { message: "x" } };
          db.updates.push(row);
          return { error: null };
        },
      }),
      insert: async (row: unknown) => {
        if (table === "admin_audit") db.audits.push(row);
        return { error: null };
      },
    }),
  }),
  currentUser: async () => null,
}));
import { claimReview } from "../src/lib/agency/claim-review";
import { recordClaim } from "../src/lib/agency/invitation";

describe("claimReview", () => {
  it("the agency's own domain or its known contact is ok", () => {
    expect(claimReview("jose@inmosur.com.ar", "https://www.inmosur.com.ar/")).toEqual({ review: "ok", domain: "inmosur.com.ar" });
    expect(claimReview("jose@ventas.inmosur.com.ar", "inmosur.com.ar").review).toBe("ok");
    expect(claimReview("Ana@Gmail.com", "https://www.inmosur.com.ar", "ana@gmail.com").review).toBe("ok");
  });
  it("a personal mailbox is worth a look; another company's domain needs review", () => {
    expect(claimReview("jose@gmail.com", "https://www.inmosur.com.ar").review).toBe("personal");
    expect(claimReview("jose@hotmail.com", null).review).toBe("personal");
    expect(claimReview("jose@otrainmobiliaria.com", "https://www.inmosur.com.ar").review).toBe("mismatch");
    expect(claimReview("jose@otrainmobiliaria.com", null).review).toBe("mismatch");
  });
});

describe("recordClaim", () => {
  it("saves the e-mail, method and review, and an audit row with the domain only", async () => {
    await recordClaim("ag1", { id: "u1", email: "Jose@OtraInmobiliaria.com" }, "google");
    expect(db.updates.at(-1)).toEqual({ claim_email: "jose@otrainmobiliaria.com", claim_method: "google", claim_review: "mismatch", claim_reviewed_at: null });
    expect(db.audits.at(-1)).toEqual({ actor_id: "u1", action: "agency_claim", subject_id: "ag1", details: { method: "google", review: "mismatch", domain: "otrainmobiliaria.com" } });
  });
  it("never blocks the claim when recording fails", async () => {
    db.fail = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordClaim("ag1", { id: "u1", email: "a@b.com" }, "email")).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith("claim_record_failed");
    db.fail = false;
  });
});

describe("claim review columns", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
     create table auth.users(id uuid primary key, is_anonymous boolean not null default false);
     create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
     create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
     create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;
     create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
     grant usage on schema public to authenticated;`);
    for (const file of readdirSync("supabase/migrations").sort()) await pg.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    // Idempotent: the last migration runs again without error.
    await pg.exec(readFileSync("supabase/migrations/202611180001_claim_review.sql", "utf8"));
  }, 30000);
  afterAll(async () => await pg?.close());

  it("accepts only known methods and reviews", async () => {
    const { id } = (await pg.query<{ id: string }>("insert into agencies(name) values('Inmo Sur') returning id")).rows[0];
    await pg.query("update agencies set claim_email='a@b.com', claim_method='google', claim_review='mismatch' where id=$1", [id]);
    await expect(pg.query("update agencies set claim_method='magic' where id=$1", [id])).rejects.toThrow(/check/i);
    await expect(pg.query("update agencies set claim_review='maybe' where id=$1", [id])).rejects.toThrow(/check/i);
  });
});

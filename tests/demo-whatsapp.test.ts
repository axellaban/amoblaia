import { beforeEach, describe, expect, it, vi } from "vitest";

// Which WhatsApp the team's "send to the agency" opens. The database is a
// recorder that answers each table with fixed rows.
const db = vi.hoisted(() => ({ tables: {} as Record<string, { data: unknown[] | null; error: { message: string } | null }> }));
vi.mock("server-only", () => ({}));
vi.mock("sharp", () => ({ default: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: (table: string) => {
      const answer = () => db.tables[table] ?? { data: [], error: null };
      const chain = {
        select: () => chain,
        in: () => chain,
        eq: () => chain,
        is: () => chain,
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, fail),
      };
      return chain;
    },
  }),
}));

import { whatsappOf } from "@/lib/demos/server";

const contact = (over: Record<string, unknown>) => ({
  id: "c1",
  account_id: "acc1",
  address: "+5492230000101",
  needs_review: false,
  verified_at: null,
  invalid_at: null,
  is_primary: false,
  ...over,
});

describe("agency WhatsApp for sending its demo", () => {
  beforeEach(() => {
    db.tables = {
      prospect_accounts: { data: [{ id: "acc1", agency_id: "ag1" }], error: null },
      prospect_contacts: { data: [], error: null },
      prospect_suppressions: { data: [], error: null },
      agencies: { data: [], error: null },
    };
  });

  it("prefers the verified prospecting contact", async () => {
    db.tables.prospect_contacts.data = [
      contact({ id: "c1", address: "+5492230000101", needs_review: true, is_primary: true }),
      contact({ id: "c2", address: "+5492230000202", verified_at: "2026-10-27T10:00:00Z" }),
    ];
    expect((await whatsappOf(["ag1"])).get("ag1")).toBe("5492230000202");
  });

  it("never uses an invalid number or one under a suppression", async () => {
    db.tables.prospect_contacts.data = [
      contact({ id: "c1", address: "+5492230000101", verified_at: "2026-10-27T10:00:00Z", invalid_at: "2026-10-28T10:00:00Z" }),
      contact({ id: "c2", address: "+5492230000202", verified_at: "2026-10-27T10:00:00Z" }),
    ];
    db.tables.prospect_suppressions.data = [{ account_id: "acc1", scope: "contact", channel: null, contact_id: "c2" }];
    expect((await whatsappOf(["ag1"])).has("ag1")).toBe(false);
  });

  it("an account-wide suppression blocks every number of the agency", async () => {
    db.tables.prospect_contacts.data = [contact({ verified_at: "2026-10-27T10:00:00Z" })];
    db.tables.prospect_suppressions.data = [{ account_id: "acc1", scope: "account", channel: null, contact_id: null }];
    expect((await whatsappOf(["ag1"])).has("ag1")).toBe(false);
  });

  it("falls back to the public WhatsApp of the agency's branding", async () => {
    db.tables.prospect_accounts = { data: [], error: null };
    db.tables.agencies.data = [{ id: "ag1", branding: { contactKind: "whatsapp", contactValue: "+54 9 223 000-0303" } }];
    expect((await whatsappOf(["ag1"])).get("ag1")).toBe("5492230000303");
  });

  it("without the prospecting tables, still reads the branding", async () => {
    db.tables.prospect_accounts = { data: null, error: { message: "relation does not exist" } };
    db.tables.agencies.data = [{ id: "ag1", branding: { contactKind: "url", contactValue: "https://x.test" } }];
    expect((await whatsappOf(["ag1"])).has("ag1")).toBe(false);
  });
});

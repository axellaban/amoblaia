import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; email_confirmed_at?: string },
  tables: {} as Record<string, Record<string, unknown>[]>,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  listing: null as null | Record<string, unknown>,
  listingError: null as null | Error,
}));

/** In-memory stand-in for the service-role client: filters work, inserts are recorded. */
function fakeDb() {
  return {
    from(table: string) {
      let rows: Row[] = [...(state.tables[table] ?? [])];
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        insert: (row: Row) => {
          state.inserts.push({ table, row });
          rows = [{ id: `new-${table}`, ...row }];
          return q;
        },
        update: () => q,
        delete: () => q,
        eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
        neq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] !== v)), q),
        in: (k: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[k]))), q),
        is: () => q,
        like: () => q,
        not: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        single: async () => (rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116" } }),
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(ok, fail),
      };
      return q;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => fakeDb(),
  currentUser: async () => state.user,
  userClient: async () => ({}),
}));
vi.mock("@/lib/demos/listing", () => ({
  readListing: async (url: string) => {
    if (state.listingError) throw state.listingError;
    return { ...state.listing, listingUrl: url };
  },
}));
vi.mock("@/lib/commerce/http", async (original) => {
  const real = await original<typeof import("../src/lib/commerce/http")>();
  return {
    ...real,
    requireUser: async () => {
      if (!state.user) throw new real.HttpError(401, "Ingresá a tu cuenta y verificá tu email.");
      return state.user;
    },
    requireAdmin: async () => {
      if (state.user?.email !== "equipo@amobla.test") throw new real.HttpError(403, "Acceso reservado al equipo.");
      return state.user;
    },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      state.rpcs.push({ name, args });
      if (name === "amobla_account") return { credits: 3 };
      if (name === "habita_create_agency") {
        state.tables.agency_members.push({ user_id: args.p_user, role: "owner", agencies: { ...AGENCY, id: "new", name: args.p_name, slug: args.p_slug } });
        return "new";
      }
      if (name === "habita_claim_agency") throw new Error("CLAIM_INVALID");
      return null;
    },
  };
});

import * as panel from "../src/app/api/panel/route";
import * as importar from "../src/app/api/panel/importar/route";
import * as reclamar from "../src/app/api/panel/reclamar/route";
import * as reclamo from "../src/app/api/admin/demos/[id]/reclamo/route";
import { publicSite } from "../src/lib/agency/site";

const OWNER = "00000000-0000-4000-8000-0000000000b1";
const DEMO = "00000000-0000-4000-8000-000000000d01";
const AGENCY = { id: "ag1", name: "Sur Propiedades", website: "https://sur.test/", slug: "sur", owner_id: OWNER, site_published: true };
const origin = "https://habita.test";
const req = (path: string, method = "GET", body?: unknown) =>
  new Request(`${origin}${path}`, {
    method,
    headers: { origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const LISTING = {
  title: "Departamento en Venta en La Perla",
  location: "La Perla",
  description: "Luminoso",
  fullDescription: "Luminoso",
  prices: [],
  headlinePrices: [],
  agency: { name: "Sur", website: "https://sur.test/" },
  images: [],
  imported: {
    propertyId: "123",
    title: "Departamento en La Perla",
    location: "La Perla | Mar del Plata",
    propertyType: "residential",
    operation: "Venta",
    reference: "RAP123",
    price: "USD 265.000",
    priceConflict: null,
    priceOptions: [],
    features: "3 ambientes",
    facts: [],
    description: "Luminoso",
    amenities: [],
    map: null,
    agent: null,
    agency: { name: "Sur", website: "https://sur.test/", logoUrl: null, whatsapp: null, phone: null, email: null },
    images: ["https://cdn.test/123_a.jpg", "https://cdn.test/123_b.jpg", "https://cdn.test/123_c.jpg"],
    report: [],
  },
};

beforeEach(() => {
  state.user = { id: OWNER, email: "duenia@sur.test", email_confirmed_at: "2026-01-01" };
  state.inserts = [];
  state.rpcs = [];
  state.listing = structuredClone(LISTING);
  state.listingError = null;
  state.tables = {
    agency_members: [{ user_id: OWNER, role: "owner", agencies: AGENCY }],
    agencies: [{ ...AGENCY, notes: "Le interesa el plan Agente", contact_name: "Ana", branding: {} }],
    demo_properties: [],
    demos: [
      { id: DEMO, agency_id: "ag1", property_id: "pr1", token: "tok_abcdefghijklmnopqrstuvwx", status: "published", settings: { price: "USD 1", priceConflict: "x" }, demo_properties: { title: "Casa", location: "Centro" } },
      { id: "d2", agency_id: "ag1", property_id: "pr2", token: "tok_draftdraftdraftdraftdr", status: "draft", settings: {}, demo_properties: { title: "Borrador", location: null } },
    ],
    demo_photos: [],
    generations: [],
    property_imports: [],
  };
  vi.stubEnv("SAAS_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public");
  vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("Agency panel", () => {
  it("tells an account without an agency to create one, and creates it with a slug from its name", async () => {
    state.tables.agency_members = [];
    expect(await (await panel.GET()).json()).toEqual({ agency: null });
    const r = await panel.POST(req("/api/panel", "POST", { name: "Inmobiliaria Güemes & Asociados" }));
    expect(r.status).toBe(201);
    expect(state.rpcs.find((c) => c.name === "habita_create_agency")!.args).toEqual({
      p_user: OWNER,
      p_name: "Inmobiliaria Güemes & Asociados",
      p_slug: "inmobiliaria-guemes-y-asociados",
    });
  });

  it("lets only the owner change the site", async () => {
    state.tables.agency_members[0].role = "collaborator";
    expect((await panel.PATCH(req("/api/panel", "PATCH", { sitePublished: true }))).status).toBe(403);
  });
});

describe("Importing a property by URL", () => {
  it("previews without creating anything, no credit and no staging", async () => {
    const r = await importar.POST(req("/api/panel/importar", "POST", { url: "https://sur.test/p/123", preview: true }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ title: "Departamento en La Perla", price: "USD 265.000", duplicateOf: null });
    expect(state.inserts).toEqual([]);
    expect(state.rpcs.filter((c) => /reserve|generation/.test(c.name))).toEqual([]);
  });

  it("refuses a property already imported into the same agency, and records it", async () => {
    state.tables.demo_properties = [{ id: "pr1", agency_id: "ag1", listing_url: "https://sur.test/p/123", demos: { id: DEMO } }];
    const r = await importar.POST(req("/api/panel/importar", "POST", { url: "https://sur.test/p/123" }));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ duplicateOf: DEMO });
    expect(state.inserts.map((i) => [i.table, i.row.status])).toEqual([["property_imports", "duplicate"]]);
  });

  it("creates a draft with the corrections and only the photos kept on the preview", async () => {
    const r = await importar.POST(
      req("/api/panel/importar", "POST", {
        url: "https://sur.test/p/123",
        overrides: { title: "Depto con vista al mar", price: "USD 260.000" },
        images: ["https://cdn.test/123_b.jpg", "https://evil.test/other.jpg"],
      }),
    );
    expect(r.status).toBe(201);
    const body = await r.json();
    // A URL that was not on the listing is never fetched.
    expect(body.images).toEqual(["https://cdn.test/123_b.jpg"]);
    const property = state.inserts.find((i) => i.table === "demo_properties")!.row;
    expect(property).toMatchObject({ title: "Depto con vista al mar", agency_id: "ag1", origin: "agency", listing_url: "https://sur.test/p/123" });
    const demo = state.inserts.find((i) => i.table === "demos")!.row;
    expect(demo.status).toBeUndefined(); // draft by default
    expect(state.rpcs.filter((c) => /reserve/.test(c.name))).toEqual([]);
  });

  it("records a failed reading so it can be retried", async () => {
    const { HttpError } = await import("../src/lib/commerce/http");
    state.listingError = new HttpError(502, "No pudimos abrir la publicación.");
    const r = await importar.POST(req("/api/panel/importar", "POST", { url: "https://sur.test/p/9", preview: true }));
    expect(r.status).toBe(502);
    expect(state.inserts).toEqual([
      { table: "property_imports", row: expect.objectContaining({ status: "failed", url: "https://sur.test/p/9", error: "No pudimos abrir la publicación." }) },
    ]);
  });

  it("is only for members of an agency", async () => {
    state.tables.agency_members = [];
    const r = await importar.POST(req("/api/panel/importar", "POST", { url: "https://sur.test/p/123", preview: true }));
    expect(r.status).toBe(404);
  });
});

describe("Taking over a demo", () => {
  it("never transfers without a valid code, and only sends its hash", async () => {
    state.tables.agency_members = [];
    expect((await reclamar.POST(req("/api/panel/reclamar", "POST", { code: "abc" }))).status).toBe(404);
    expect(state.rpcs.filter((c) => c.name === "habita_claim_agency")).toEqual([]);
    const code = "x".repeat(32);
    const r = await reclamar.POST(req("/api/panel/reclamar", "POST", { code }));
    expect(r.status).toBe(404);
    const call = state.rpcs.find((c) => c.name === "habita_claim_agency")!;
    expect(call.args.p_code_hash).toBe(createHash("sha256").update(code).digest("hex"));
    expect(JSON.stringify(call.args)).not.toContain(code);
  });

  it("lets only the team create a claim link, for an agency without an account", async () => {
    const params = { params: Promise.resolve({ id: DEMO }) };
    expect((await reclamo.POST(req(`/api/admin/demos/${DEMO}/reclamo`, "POST"), params)).status).toBe(403);
    state.user = { id: "00000000-0000-4000-8000-0000000000aa", email: "equipo@amobla.test", email_confirmed_at: "2026-01-01" };
    expect((await reclamo.POST(req(`/api/admin/demos/${DEMO}/reclamo`, "POST"), params)).status).toBe(409);
    state.tables.agencies[0].owner_id = null;
    const r = await reclamo.POST(req(`/api/admin/demos/${DEMO}/reclamo`, "POST"), params);
    expect(r.status).toBe(201);
    const { url } = await r.json();
    const code = new URL(url).searchParams.get("codigo")!;
    const stored = state.inserts.find((i) => i.table === "agency_claims")!.row;
    expect(stored.code_hash).toBe(createHash("sha256").update(code).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(code);
  });
});

describe("Agency public site", () => {
  it("shows only a published site and its published properties, without private data", async () => {
    const site = await publicSite("sur");
    expect(site!.properties.map((p) => p.title)).toEqual(["Casa"]);
    // A price in conflict is never shown as confirmed.
    expect(site!.properties[0].price).toBeNull();
    expect(JSON.stringify(site)).not.toMatch(/Le interesa|Ana|owner|settings/);
    state.tables.agencies[0].site_published = false;
    expect(await publicSite("sur")).toBeNull();
    expect(await publicSite("../etc")).toBeNull();
  });
});

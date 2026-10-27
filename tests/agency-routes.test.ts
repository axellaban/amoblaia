import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; email_confirmed_at?: string },
  tables: {} as Record<string, Record<string, unknown>[]>,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  updates: [] as { table: string; row: Record<string, unknown> }[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  listing: null as null | Record<string, unknown>,
  listingError: null as null | Error,
  /** Errors to return, by "table:select|insert|update". */
  fail: {} as Record<string, { code?: string }>,
  creditsError: false,
  claimOk: false,
}));

/**
 * In-memory stand-in for the service-role client: filters work, inserts are
 * recorded (and kept for property_imports), updates apply to the filtered rows.
 */
function fakeDb() {
  return {
    from(table: string) {
      let rows: Row[] = [...(state.tables[table] ?? [])];
      let patch: Row | null = null;
      let count = false;
      let total: number | null = null;
      let op = "select";
      const error = () => state.fail[`${table}:${op}`] ?? null;
      const apply = () => {
        if (error()) return;
        if (patch) for (const r of rows) Object.assign(r, patch);
        patch = null;
      };
      const q = {
        select: (_f?: string, opts?: { count?: string }) => ((count = count || !!opts?.count), q),
        order: () => q,
        limit: () => q,
        range: (from: number, to: number) => ((total = rows.length), (rows = rows.slice(from, to + 1)), q),
        insert: (row: Row) => {
          op = "insert";
          if (error()) return q;
          state.inserts.push({ table, row });
          const made = { id: table === "property_imports" ? crypto.randomUUID() : `new-${table}-${state.inserts.length}`, ...row };
          if (table === "property_imports") state.tables[table].push(made);
          rows = [made];
          return q;
        },
        update: (row: Row) => {
          op = "update";
          if (error()) return q;
          state.updates.push({ table, row });
          patch = row;
          return q;
        },
        delete: () => q,
        eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
        neq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] !== v)), q),
        in: (k: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[k]))), q),
        lte: () => q,
        gt: () => q,
        lt: (k: string, v: string) => ((rows = rows.filter((r) => typeof r[k] === "string" && (r[k] as string) < v)), q),
        is: (k: string, v: null) => ((rows = rows.filter((r) => (v === null ? r[k] == null : r[k] === v))), q),
        like: () => q,
        not: () => q,
        or: () => q,
        maybeSingle: async () => (apply(), error() ? { data: null, error: error() } : { data: rows[0] ?? null, error: null }),
        single: async () =>
          (apply(), error() ? { data: null, error: error() } : rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116" } }),
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve(
            (apply(), error() ? { data: null, error: error(), count: null } : { data: rows, error: null, count: count ? (total ?? rows.length) : null }),
          ).then(ok, fail),
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
      if (name === "amobla_account") {
        if (state.creditsError) throw new Error("ACCOUNT_LOOKUP_FAILED");
        return { credits: args.p_user === OWNER ? 3 : 50 };
      }
      if (name === "habita_create_agency") {
        state.tables.agency_members.push({ user_id: args.p_user, role: "owner", agencies: { ...AGENCY, id: "new", name: args.p_name, slug: args.p_slug } });
        return "new";
      }
      if (name === "habita_claim_agency") {
        if (!state.claimOk) throw new Error("CLAIM_INVALID");
        state.tables.agency_members.push({ user_id: args.p_user, role: "owner", agencies: { ...AGENCY, owner_id: args.p_user } });
        return "ag1";
      }
      if (name === "habita_agency_counts") return { total: 2, published: 1, staged: 0, review: 0, operations: [] };
      return null;
    },
  };
});

import * as panel from "../src/app/api/panel/route";
import * as importar from "../src/app/api/panel/importar/route";
import * as reclamar from "../src/app/api/panel/reclamar/route";
import * as reclamo from "../src/app/api/admin/demos/[id]/reclamo/route";
import * as adminImport from "../src/app/api/admin/demos/importar/route";
import * as creditos from "../src/app/api/panel/creditos/route";
import * as propiedades from "../src/app/api/panel/propiedades/route";
import * as costo from "../src/app/api/admin/demos/[id]/costo/route";
import * as invitaciones from "../src/app/api/admin/inmobiliarias/[id]/invitaciones/route";
import * as invitacion from "../src/app/api/admin/inmobiliarias/[id]/invitaciones/[claimId]/route";
import { agencyStage, claimState } from "../src/lib/agency/stage";
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
  state.updates = [];
  state.rpcs = [];
  state.listing = structuredClone(LISTING);
  state.listingError = null;
  state.fail = {};
  state.creditsError = false;
  state.claimOk = false;
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
    const r = await importar.POST(req("/api/panel/importar", "POST", { url: "https://sur.test/p/123", key: crypto.randomUUID() }));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ duplicateOf: DEMO });
    expect(state.inserts.map((i) => [i.table, i.row.status])).toEqual([["property_imports", "started"]]);
    expect(state.tables.property_imports[0]).toMatchObject({ status: "duplicate", demo_id: DEMO });
  });

  it("creates a draft with the corrections and only the photos kept on the preview", async () => {
    const r = await importar.POST(
      req("/api/panel/importar", "POST", {
        url: "https://sur.test/p/123",
        key: crypto.randomUUID(),
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

describe("Maps when creating a property", () => {
  const withMap = (status: "found" | "review" | "none") => {
    Object.assign(state.listing!.imported as Row, {
      map: status === "none" ? null : { precision: "approx", lat: -38.0055, lng: -57.5426, radius: 400, source: "leaflet-circle" },
      mapStatus: status,
      mapNote: null,
      mapPlaces:
        status === "review"
          ? [
              { lat: -38.0055, lng: -57.5426, source: "leaflet-circle", radius: 400 },
              { lat: -38.1, lng: -57.7, source: "data-attribute", radius: null },
            ]
          : [],
    });
  };
  const savedMap = () => {
    const settings = state.updates.find((u) => u.table === "demos" && "settings" in u.row)?.row.settings as { map: Row } | undefined;
    return settings?.map;
  };

  it("keeps the detected map with its source and radius (agency)", async () => {
    withMap("found");
    expect((await importar.POST(req("/api/panel/importar", "POST", { url: "https://sur.test/p/123", key: crypto.randomUUID() }))).status).toBe(201);
    expect(savedMap()).toEqual({ precision: "approx", lat: -38.0055, lng: -57.5426, radius: 400, source: "leaflet-circle" });
  });

  it("saves a map that needed a review only with the place chosen on the preview", async () => {
    withMap("review");
    await importar.POST(req("/api/panel/importar", "POST", { url: "https://sur.test/p/123", key: crypto.randomUUID() }));
    expect(savedMap()).toMatchObject({ precision: "none" });
    state.updates = [];
    await importar.POST(
      req("/api/panel/importar", "POST", { url: "https://sur.test/p/123", key: crypto.randomUUID(), overrides: { map: { precision: "zone", lat: -38.1, lng: -57.7 } } }),
    );
    expect(savedMap()).toEqual({ precision: "zone", lat: -38.1, lng: -57.7, radius: null, source: "data-attribute" });
  });

  it("takes a pasted map link when nothing was found, and rejects one it cannot read", async () => {
    withMap("none");
    const ok = await importar.POST(
      req("/api/panel/importar", "POST", {
        url: "https://sur.test/p/123",
        key: crypto.randomUUID(),
        overrides: { map: { precision: "approx", link: "https://www.google.com/maps/place/-38.0055,-57.5426" } },
      }),
    );
    expect(ok.status).toBe(201);
    expect(savedMap()).toMatchObject({ lat: -38.0055, lng: -57.5426, source: "manual" });
    state.inserts = [];
    const bad = await importar.POST(
      req("/api/panel/importar", "POST", { url: "https://sur.test/p/123", key: crypto.randomUUID(), overrides: { map: { precision: "approx", link: "https://evil.test/x" } } }),
    );
    expect(bad.status).toBe(400);
    // Nothing is created with an unreadable map.
    expect(state.inserts.filter((i) => i.table === "demo_properties")).toEqual([]);
  });

  it("does the same from the team's import", async () => {
    withMap("found");
    state.user = { id: "00000000-0000-4000-8000-0000000000aa", email: "equipo@amobla.test", email_confirmed_at: "2026-01-01" };
    const r = await adminImport.POST(req("/api/admin/demos/importar", "POST", { url: "https://sur.test/p/123", map: { precision: "exact", lat: -38.0055, lng: -57.5426 } }));
    expect(r.status).toBe(201);
    expect(savedMap()).toEqual({ precision: "exact", lat: -38.0055, lng: -57.5426, radius: 400, source: "leaflet-circle" });
  });
});

describe("Credits of an agency", () => {
  const COLLAB = "00000000-0000-4000-8000-0000000000c1";

  it("shows a collaborator the agency's balance (its owner's), never their own account", async () => {
    state.user = { id: COLLAB, email: "colega@sur.test", email_confirmed_at: "2026-01-01" };
    state.tables.agency_members.push({ user_id: COLLAB, role: "collaborator", agencies: AGENCY });
    const body = await (await creditos.GET()).json();
    expect(body).toEqual({ role: "collaborator", payer: { agency: "Sur Propiedades", isYou: false }, credits: 3, creditsError: false });
    expect(state.rpcs.filter((c) => c.name === "amobla_account").map((c) => c.args.p_user)).toEqual([OWNER]);
  });

  it("reports a balance it could not read as unknown, not as zero", async () => {
    state.creditsError = true;
    const body = await (await creditos.GET()).json();
    expect(body).toMatchObject({ credits: null, creditsError: true });
    const home = await (await panel.GET()).json();
    expect(home.credits).toBeNull();
  });
});

describe("Errors are not shown as an empty state", () => {
  it("answers 500 when the membership cannot be read, never “create your agency”", async () => {
    state.fail["agency_members:select"] = {};
    const r = await panel.GET();
    expect(r.status).toBe(500);
    expect(await r.json()).not.toHaveProperty("agency");
    expect((await importar.POST(req("/api/panel/importar", "POST", { url: "https://sur.test/p/1", preview: true }))).status).toBe(500);
  });
});

describe("Site settings", () => {
  it("changes the color without touching the contact e-mail", async () => {
    state.tables.agencies[0].branding = { primary: "#000000", contactKind: "email", contactValue: "consultas@sur.test" };
    const r = await panel.PATCH(req("/api/panel", "PATCH", { primary: "#123456" }));
    expect(r.status).toBe(200);
    const saved = state.updates.find((u) => u.table === "agencies" && "branding" in u.row)!.row.branding;
    expect(saved).toEqual({ primary: "#123456", contactKind: "email", contactValue: "consultas@sur.test" });
  });

  it("saves nothing when one field is wrong", async () => {
    const r = await panel.PATCH(req("/api/panel", "PATCH", { name: "Sur Nuevo", primary: "rojo" }));
    expect(r.status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("does not publish a catalog without an address", async () => {
    state.tables.agency_members[0].agencies = { ...AGENCY, slug: null };
    expect((await panel.PATCH(req("/api/panel", "PATCH", { sitePublished: true }))).status).toBe(400);
  });
});

describe("Imports that tell what really happened", () => {
  const create = (extra: Record<string, unknown> = {}) =>
    importar.POST(req("/api/panel/importar", "POST", { url: "https://sur.test/p/123", key: crypto.randomUUID(), ...extra }));

  it("keeps the property when its data could not be saved, and tracks the photos still missing", async () => {
    state.fail["demos:update"] = {};
    const r = await create({ images: ["https://cdn.test/123_a.jpg", "https://cdn.test/123_b.jpg"] });
    expect(r.status).toBe(201);
    const made = await r.json();
    expect(made).toMatchObject({ status: "partial", settingsSaved: false, photosTotal: 2, photosDone: 0 });
    expect(made.id).toBeTruthy();
    delete state.fail["demos:update"];

    const report = (done: string[], failed: string[]) =>
      importar.PATCH(req("/api/panel/importar", "PATCH", { importId: made.importId, done, failed }));
    const first = await (await report(["https://cdn.test/123_a.jpg"], ["https://cdn.test/123_b.jpg"])).json();
    expect(first).toMatchObject({ status: "partial", photosDone: 1, images: ["https://cdn.test/123_b.jpg"] });
    // The photo retried later: the data is still missing, so it stays partial.
    const second = await (await report(["https://cdn.test/123_b.jpg"], [])).json();
    expect(second).toMatchObject({ status: "partial", photosDone: 2, images: [], settingsSaved: false });
  });

  it("is completed once every photo arrived and the data was saved", async () => {
    const made = await (await create({ images: ["https://cdn.test/123_a.jpg"] })).json();
    expect(made.status).toBe("partial");
    const done = await importar.PATCH(req("/api/panel/importar", "PATCH", { importId: made.importId, done: ["https://cdn.test/123_a.jpg"], failed: [] }));
    expect(await done.json()).toMatchObject({ status: "completed", photosDone: 1, images: [] });
  });

  it("creates one property when the same confirm is sent twice", async () => {
    const key = crypto.randomUUID();
    const a = await create({ key });
    const b = await create({ key });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    const [first, again] = [await a.json(), await b.json()];
    expect(again).toMatchObject({ replay: true, id: first.id, importId: first.importId });
    expect(state.inserts.filter((i) => i.table === "demo_properties")).toHaveLength(1);
  });

  it("refuses a second import of the same listing while one is running", async () => {
    state.fail["property_imports:insert"] = { code: "23505" };
    const r = await create();
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/ya se está importando/);
    expect(state.inserts.filter((i) => i.table === "demo_properties")).toEqual([]);
  });

  it("asks to review again when the listing changed since the preview", async () => {
    const r = await create({ snapshot: "0".repeat(64) });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.changed).toBe(true);
    expect(body.preview).toMatchObject({ title: "Departamento en La Perla", snapshot: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(state.inserts.filter((i) => i.table === "demo_properties")).toEqual([]);
    expect(state.tables.property_imports[0].status).toBe("failed");
  });

  it("never lets an agency report photos of another agency's import", async () => {
    state.tables.property_imports.push({ id: "00000000-0000-4000-8000-00000000f001", agency_id: "ag2", status: "partial", pending_images: ["x"], photos_total: 1 });
    const r = await importar.PATCH(req("/api/panel/importar", "PATCH", { importId: "00000000-0000-4000-8000-00000000f001", done: ["x"], failed: [] }));
    expect(r.status).toBe(404);
    expect(state.updates.filter((u) => u.table === "property_imports")).toEqual([]);
  });
});

describe("Properties list", () => {
  it("pages on the server with the real total, beyond 300, and only the agency's own", async () => {
    state.tables.demos = Array.from({ length: 321 }, (_, i) => ({
      id: `d${i}`,
      agency_id: "ag1",
      property_id: `p${i}`,
      token: `tok_${String(i).padStart(24, "0")}`,
      status: i % 3 ? "draft" : "published",
      cover_photo_id: null,
      created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
      settings: {},
      demo_properties: { title: `Casa ${i}`, location: null, listing_url: null },
    }));
    state.tables.demos.push({ ...state.tables.demos[0], id: "other", agency_id: "ag2" });
    const body = await (await propiedades.GET(req("/api/panel/propiedades?pagina=14&por=24"))).json();
    expect(body.total).toBe(321);
    expect(body.page).toBe(14);
    expect(body.items).toHaveLength(321 - 13 * 24);
    expect(body.items.map((p: { id: string }) => p.id)).not.toContain("other");
    const published = await (await propiedades.GET(req("/api/panel/propiedades?estado=published&por=48"))).json();
    expect(published.total).toBe(107);
  });
});

describe("Cost before staging", () => {
  const params = { params: Promise.resolve({ id: DEMO }) };
  const PHOTO = "00000000-0000-4000-8000-00000000e001";
  const cost = () => costo.POST(req(`/api/admin/demos/${DEMO}/costo`, "POST", { photoIds: [PHOTO] }), params);
  beforeEach(() => {
    state.tables.demos[0].property_id = "pr1";
    state.tables.demo_photos = [{ id: PHOTO, property_id: "pr1", project_id: "pj1" }];
  });

  it("charges a credit for a new photo, from the agency's balance", async () => {
    state.tables.projects = [{ id: "pj1", user_id: OWNER, grant_id: null, credit_grants: null }];
    expect(await (await cost()).json()).toEqual({ payer: "agency", credits: 3, newPhotos: 1, cost: 1, blocked: null });
  });

  it("is free for a paid photo while its coverage lasts, and blocked once it expired", async () => {
    state.tables.projects = [{ id: "pj1", user_id: OWNER, grant_id: "g1", credit_grants: { source_key: "mp:1", revoked: false, expires_at: "2999-01-01T00:00:00Z" } }];
    state.tables.credit_grants = [];
    expect(await (await cost()).json()).toMatchObject({ cost: 0, blocked: null });
    state.tables.projects[0].credit_grants = { source_key: "mp:1", revoked: false, expires_at: "2020-01-01T00:00:00Z" };
    expect((await (await cost()).json()).blocked).toMatch(/venció/);
  });

  it("does not guess the cost when the balance could not be read", async () => {
    state.tables.projects = [{ id: "pj1", user_id: OWNER, grant_id: null, credit_grants: null }];
    state.creditsError = true;
    expect(await (await cost()).json()).toMatchObject({ credits: null, blocked: expect.stringMatching(/saldo/) });
  });

  it("does not reveal another agency's property", async () => {
    state.tables.demos[0].agency_id = "ag2";
    expect((await cost()).status).toBe(404);
  });
});

describe("Claiming the agency", () => {
  it("opens the panel with the properties the team had prepared", async () => {
    state.user = { id: "00000000-0000-4000-8000-0000000000c9", email: "nueva@sur.test", email_confirmed_at: "2026-01-01" };
    state.tables.agency_members = [];
    state.claimOk = true;
    const r = await reclamar.POST(req("/api/panel/reclamar", "POST", { code: "y".repeat(32) }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.properties.map((p: { title: string }) => p.title).sort()).toEqual(["Borrador", "Casa"]);
    expect(body.counts).toMatchObject({ total: 2, published: 1, drafts: 1 });
  });
});

describe("The team's view of agencies", () => {
  const AG = "00000000-0000-4000-8000-00000000a001";
  const CLAIM = "00000000-0000-4000-8000-00000000c001";
  const TEAM = { id: "00000000-0000-4000-8000-0000000000aa", email: "equipo@amobla.test", email_confirmed_at: "2026-01-01" };
  const revoke = () =>
    invitacion.DELETE(req(`/api/admin/inmobiliarias/${AG}/invitaciones/${CLAIM}`, "DELETE"), { params: Promise.resolve({ id: AG, claimId: CLAIM }) });

  it("derives the stage only from facts", () => {
    expect(agencyStage({ hasOwner: false, liveClaimExpires: null, published: 0 })).toBe("no-account");
    expect(agencyStage({ hasOwner: false, liveClaimExpires: "2999-01-01", published: 3 })).toBe("invited");
    expect(agencyStage({ hasOwner: true, liveClaimExpires: null, published: 0 })).toBe("account");
    expect(agencyStage({ hasOwner: true, liveClaimExpires: null, published: 1 })).toBe("live");
    const now = Date.parse("2026-06-01");
    expect(claimState({ expires_at: "2026-07-01", used_at: null, revoked_at: null }, now)).toBe("pending");
    expect(claimState({ expires_at: "2026-05-01", used_at: null, revoked_at: null }, now)).toBe("expired");
    expect(claimState({ expires_at: "2026-07-01", used_at: "2026-05-02", revoked_at: null }, now)).toBe("used");
    expect(claimState({ expires_at: "2026-07-01", used_at: null, revoked_at: "2026-05-02" }, now)).toBe("revoked");
  });

  it("lets only the team revoke a pending invitation, and audits it", async () => {
    state.tables.agency_claims = [{ id: CLAIM, agency_id: AG, used_at: null, revoked_at: null, expires_at: "2999-01-01" }];
    state.tables.admin_audit = [];
    expect((await revoke()).status).toBe(403);
    state.user = TEAM;
    expect((await revoke()).status).toBe(204);
    expect(state.tables.agency_claims[0].revoked_at).toEqual(expect.any(String));
    expect(state.inserts.find((i) => i.table === "admin_audit")!.row).toMatchObject({ action: "agency_claim_revoke", subject_id: AG });
    // Already revoked (or used): nothing to do.
    expect((await revoke()).status).toBe(409);
  });

  it("creates an invitation only for an agency without an account", async () => {
    state.user = TEAM;
    state.tables.agencies.push({ id: AG, name: "Nueva", owner_id: null });
    const params = { params: Promise.resolve({ id: AG }) };
    const r = await invitaciones.POST(req(`/api/admin/inmobiliarias/${AG}/invitaciones`, "POST"), params);
    expect(r.status).toBe(201);
    expect((await r.json()).url).toMatch(/^https:\/\/habita\.test\/panel\/empezar\?codigo=[\w-]{32}$/);
    state.tables.agencies.at(-1)!.owner_id = OWNER;
    expect((await invitaciones.POST(req(`/api/admin/inmobiliarias/${AG}/invitaciones`, "POST"), params)).status).toBe(409);
  });
});

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
  applyError: false,
  cookies: new Map<string, string>(),
  pendingToApply: 0,
  authUsers: [] as { id: string; email: string; email_confirm?: boolean }[],
  deletedUsers: [] as string[],
}));

/**
 * In-memory stand-in for the service-role client: filters work, inserts are
 * recorded (and kept for property_imports), updates apply to the filtered rows.
 */
function fakeDb() {
  return {
    auth: {
      admin: {
        createUser: async (u: { email: string; password: string; email_confirm?: boolean }) => {
          if (state.authUsers.some((x) => x.email === u.email))
            return { data: { user: null }, error: { code: "email_exists", message: "A user with this email address has already been registered" } };
          const user = { id: `00000000-0000-4000-8000-${String(900000000000 + state.authUsers.length)}`, email: u.email, email_confirm: u.email_confirm };
          state.authUsers.push(user);
          return { data: { user }, error: null };
        },
        deleteUser: async (id: string) => (state.deletedUsers.push(id), { error: null }),
        getUserById: async (id: string) => ({ data: { user: state.authUsers.find((u) => u.id === id) ?? null }, error: null }),
      },
    },
    from(table: string) {
      let rows: Row[] = [...(state.tables[table] ?? [])];
      let patch: Row | null = null;
      let count = false;
      let total: number | null = null;
      let op = "select";
      let removing = false;
      const error = () => state.fail[`${table}:${op}`] ?? null;
      const apply = () => {
        if (error()) return;
        if (removing) {
          state.tables[table] = (state.tables[table] ?? []).filter((r) => !rows.includes(r));
          removing = false;
        }
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
          const made = { id: crypto.randomUUID(), ...row };
          if (table === "property_imports" || table === "property_spaces") (state.tables[table] ??= []).push(made);
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
        delete: () => ((op = "delete"), (patch = null), (removing = true), q),
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
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (state.cookies.has(k) ? { value: state.cookies.get(k) } : undefined),
    set: (k: string, v: string) => void state.cookies.set(k, v),
    delete: (k: string) => void state.cookies.delete(k),
  }),
}));
vi.mock("@/lib/commerce/jobs", () => ({ onFreeTier: async () => false, runJob: async () => {} }));
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
      if (name === "habita_apply_agency_credits" && state.applyError) throw new Error("boom");
      if (name === "habita_apply_agency_credits") return state.pendingToApply;
      if (name === "habita_join_agency") {
        state.tables.agency_members.push({ user_id: args.p_user, role: "editor", agencies: AGENCY });
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
import * as invitacionPanel from "../src/app/api/panel/invitacion/route";
import * as soporte from "../src/app/api/admin/inmobiliarias/[id]/soporte/route";
import { readSupportToken, supportToken } from "../src/lib/agency/support";
import * as espacios from "../src/app/api/admin/demos/[id]/espacios/route";
import * as espacio from "../src/app/api/admin/demos/[id]/espacios/[spaceId]/route";
import * as fotoDemo from "../src/app/api/admin/demos/[id]/photos/[photoId]/route";
import * as creditosAgencia from "../src/app/api/admin/inmobiliarias/[id]/creditos/route";
import * as fotosGrupo from "../src/app/api/panel/imagenes/route";
import * as grupoSubida from "../src/app/api/panel/imagenes/grupo/route";
import * as fichaGrupo from "../src/app/api/panel/imagenes/[id]/ficha/route";
import * as demoAgencia from "../src/app/api/admin/demos/[id]/route";
import * as usuarios from "../src/app/api/panel/usuarios/route";
import * as usuario from "../src/app/api/panel/usuarios/[id]/route";
import * as unirme from "../src/app/api/panel/unirme/route";
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
  state.authUsers = [];
  state.applyError = false;
  state.cookies = new Map();
  state.pendingToApply = 0;
  state.deletedUsers = [];
  state.tables = {
    agency_members: [{ user_id: OWNER, role: "owner", agencies: AGENCY }],
    agencies: [{ ...AGENCY, notes: "Le interesa el plan Agente", contact_name: "Ana", branding: {} }],
    demo_properties: [],
    demos: [
      { id: DEMO, agency_id: "ag1", kind: "ficha", property_id: "pr1", token: "tok_abcdefghijklmnopqrstuvwx", status: "published", settings: { price: "USD 1", priceConflict: "x" }, demo_properties: { title: "Casa", location: "Centro" } },
      { id: "d2", agency_id: "ag1", kind: "ficha", property_id: "pr2", token: "tok_draftdraftdraftdraftdr", status: "draft", settings: {}, demo_properties: { title: "Borrador", location: null } },
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
    const { url, presentationUrl } = await r.json();
    const code = new URL(url).searchParams.get("codigo")!;
    const stored = state.inserts.find((i) => i.table === "agency_claims")!.row;
    expect(stored.code_hash).toBe(createHash("sha256").update(code).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(code);
    // The demo as the way in: its presentation link carries the same one-time code.
    const demoLink = new URL(presentationUrl);
    expect(demoLink.pathname).toBe("/demo/tok_abcdefghijklmnopqrstuvwx");
    expect(demoLink.searchParams.get("presentacion")).toBe("1");
    expect(demoLink.searchParams.get("codigo")).toBe(code);
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
    // A collaborator from before 202611110001_agency_team.sql reads as an editor.
    expect(body).toEqual({ role: "editor", payer: { agency: "Sur Propiedades", isYou: false }, credits: 3, creditsError: false });
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
      kind: "ficha",
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
    expect(agencyStage({ hasOwner: true, claimedAt: "2026-10-01", liveClaimExpires: null, published: 0 })).toBe("claimed");
    // An account created directly is not a claimed one.
    expect(agencyStage({ hasOwner: true, claimedAt: null, liveClaimExpires: null, published: 0 })).toBe("own-account");
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

describe("Invitation from WhatsApp with only an e-mail and a password", () => {
  const CODE = "z".repeat(32);
  const HASH = createHash("sha256").update(CODE).digest("hex");
  const accept = (body: Record<string, unknown>) => invitacionPanel.POST(req("/api/panel/invitacion", "POST", { code: CODE, email: "Duenia@Nueva.test", password: "segura123", ...body }));
  beforeEach(() => {
    state.user = null;
    state.tables.agencies[0].owner_id = null;
    state.tables.agency_claims = [{ code_hash: HASH, agency_id: "ag1", expires_at: "2999-01-01T00:00:00Z", used_at: null, revoked_at: null, agencies: { name: "Sur Propiedades", owner_id: null } }];
    state.claimOk = true;
  });

  it("creates the account, takes over the agency and moves its waiting credits", async () => {
    const r = await accept({});
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ email: "duenia@nueva.test" });
    expect(state.authUsers).toEqual([expect.objectContaining({ email: "duenia@nueva.test", email_confirm: true })]);
    const claim = state.rpcs.find((c) => c.name === "habita_claim_agency")!;
    expect(claim.args).toMatchObject({ p_user: state.authUsers[0].id, p_code_hash: HASH, p_slug: "sur-propiedades" });
    expect(state.rpcs.map((c) => c.name)).toContain("habita_apply_agency_credits");
    expect(state.deletedUsers).toEqual([]);
  });

  it("creates no account for an unknown, used, revoked or expired invitation", async () => {
    for (const change of [{ used_at: "2026-01-01" }, { revoked_at: "2026-01-01" }, { expires_at: "2020-01-01T00:00:00Z" }, { agencies: { name: "Sur", owner_id: OWNER } }]) {
      Object.assign(state.tables.agency_claims[0], change);
      expect((await accept({})).status).toBe(404);
      state.tables.agency_claims[0] = { code_hash: HASH, agency_id: "ag1", expires_at: "2999-01-01T00:00:00Z", used_at: null, revoked_at: null, agencies: { name: "Sur Propiedades", owner_id: null } };
    }
    expect((await accept({ code: "y".repeat(32) })).status).toBe(404);
    expect(state.authUsers).toEqual([]);
  });

  it("asks to sign in when the e-mail already has an account", async () => {
    state.authUsers.push({ id: "x", email: "duenia@nueva.test" });
    const r = await accept({});
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/ya tiene una cuenta/);
    expect(state.rpcs.filter((c) => c.name === "habita_claim_agency")).toEqual([]);
  });

  it("removes the new account when the agency could not be taken over", async () => {
    state.claimOk = false;
    expect((await accept({})).status).toBe(404);
    expect(state.deletedUsers).toEqual([state.authUsers[0].id]);
  });

  it("checks the password, the e-mail and where the request comes from", async () => {
    expect((await accept({ password: "corta" })).status).toBe(400);
    expect((await accept({ email: "no-es-email" })).status).toBe(400);
    const foreign = new Request(`${origin}/api/panel/invitacion`, {
      method: "POST",
      headers: { origin: "https://evil.test", "content-type": "application/json" },
      body: JSON.stringify({ code: CODE, email: "a@b.test", password: "segura123" }),
    });
    expect((await invitacionPanel.POST(foreign)).status).toBe(403);
    expect(state.authUsers).toEqual([]);
  });
});

describe("Free credits for an agency from the admin panel", () => {
  const AG = "00000000-0000-4000-8000-00000000a001";
  const params = { params: Promise.resolve({ id: AG }) };
  const give = (body: Record<string, unknown>) => creditosAgencia.POST(req(`/api/admin/inmobiliarias/${AG}/creditos`, "POST", body), params);

  it("is only for the team, with an amount, a reason and a request key", async () => {
    const key = crypto.randomUUID();
    expect((await give({ key, photos: 5, reason: "Regalo de bienvenida" })).status).toBe(403);
    state.user = { id: "00000000-0000-4000-8000-0000000000aa", email: "equipo@amobla.test", email_confirmed_at: "2026-01-01" };
    expect((await give({ key, photos: 0, reason: "Regalo de bienvenida" })).status).toBe(400);
    expect((await give({ key, photos: 2.5, reason: "Regalo de bienvenida" })).status).toBe(400);
    expect((await give({ key, photos: 5, reason: "x" })).status).toBe(400);
    expect((await give({ photos: 5, reason: "Regalo de bienvenida" })).status).toBe(400);
    expect(state.rpcs.filter((c) => /habita_agency_credit/.test(c.name))).toEqual([]);
    const r = await give({ key, photos: 5, reason: "Regalo de bienvenida", owner: "00000000-0000-4000-8000-0000000000ff" });
    expect(r.status).toBe(201);
    // The owner is never taken from the client: only the agency of the URL.
    expect(state.rpcs.find((c) => c.name === "habita_agency_credit_once")!.args).toEqual({
      p_key: key,
      p_actor: "00000000-0000-4000-8000-0000000000aa",
      p_agency: AG,
      p_photos: 5,
      p_reason: "Regalo de bienvenida",
    });
  });

  it("says how many reserved credits moved, none, or that it failed (never a failure as 0)", async () => {
    state.user = { id: "00000000-0000-4000-8000-0000000000aa", email: "equipo@amobla.test", email_confirmed_at: "2026-01-01" };
    state.pendingToApply = 4;
    expect(await (await give({ apply: true })).json()).toEqual({ applied: 4 });
    state.pendingToApply = 0;
    expect(await (await give({ apply: true })).json()).toEqual({ applied: 0 });
    state.applyError = true;
    const failed = await give({ apply: true });
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toMatch(/No se movió nada/);
  });
});

describe("Spaces of a property", () => {
  const P1 = "00000000-0000-4000-8000-00000000f0a1";
  const P2 = "00000000-0000-4000-8000-00000000f0a2";
  const FOREIGN = "00000000-0000-4000-8000-00000000f0b1";
  const params = { params: Promise.resolve({ id: DEMO }) };
  beforeEach(() => {
    state.tables.demo_photos = [
      { id: P1, property_id: "pr1", project_id: "pj1", position: 0, visible: true, room: "bedroom", label: null, mode: "furnish", space_id: null },
      { id: P2, property_id: "pr1", project_id: "pj2", position: 1, visible: true, room: "bedroom", label: null, mode: "furnish", space_id: null },
      { id: FOREIGN, property_id: "pr9", project_id: "pj9", position: 0, visible: true, room: "living", label: null, mode: "furnish", space_id: null },
    ];
    state.tables.property_spaces = [];
  });
  const create = (name: string) => espacios.POST(req(`/api/admin/demos/${DEMO}/espacios`, "POST", { name, roomType: "bedroom" }), params);
  const assign = (photoIds: string[], spaceId: string | null) =>
    espacios.PATCH(req(`/api/admin/demos/${DEMO}/espacios`, "PATCH", { photoIds, spaceId }), params);

  it("keeps two bedrooms as two spaces and moves photos without touching anything else", async () => {
    const a = await (await create("Dormitorio principal")).json();
    const b = await (await create("Dormitorio 2")).json();
    expect(a.id).not.toBe(b.id);
    expect(b.spaces.map((s: { name: string; roomType: string }) => [s.name, s.roomType])).toEqual([
      ["Dormitorio principal", "bedroom"],
      ["Dormitorio 2", "bedroom"],
    ]);
    state.updates = [];
    const moved = await assign([P1], b.id);
    expect(moved.status).toBe(200);
    expect(state.updates).toEqual([{ table: "demo_photos", row: { space_id: b.id } }]);
    expect((await moved.json()).assignments).toEqual({ [P1]: b.id });
    // Nothing about generations, projects or credits.
    expect(state.rpcs).toEqual([]);
  });

  it("refuses photos or spaces of another property", async () => {
    const mine = await (await create("Living")).json();
    expect((await assign([FOREIGN], mine.id)).status).toBe(404);
    state.tables.property_spaces.push({ id: "00000000-0000-4000-8000-00000000f0c9", property_id: "pr9", name: "Ajeno", room_type: "living", position: 0 });
    expect((await assign([P1], "00000000-0000-4000-8000-00000000f0c9")).status).toBe(404);
    expect(state.updates.filter((u) => u.table === "demo_photos")).toEqual([]);
  });

  it("deletes a space after moving its photos, never the photos", async () => {
    const a = await (await create("Dormitorio 2")).json();
    const b = await (await create("Dormitorio principal")).json();
    await assign([P1, P2], a.id);
    const r = await espacio.DELETE(req(`/api/admin/demos/${DEMO}/espacios/${a.id}?destino=${b.id}`, "DELETE"), {
      params: Promise.resolve({ id: DEMO, spaceId: a.id }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.moved).toBe(2);
    expect(body.spaces.map((s: { name: string }) => s.name)).toEqual(["Dormitorio principal"]);
    expect(state.tables.demo_photos.filter((p) => p.property_id === "pr1")).toHaveLength(2);
    expect(body.assignments).toEqual({ [P1]: b.id, [P2]: b.id });
  });

  it("is not reachable from another agency", async () => {
    state.tables.agency_members = [{ user_id: OWNER, role: "owner", agencies: { ...AGENCY, id: "ag2" } }];
    expect((await create("Living")).status).toBe(404);
  });
});

describe("One rule for who pays a version", () => {
  const PHOTO = "00000000-0000-4000-8000-00000000f0d1";
  const TEAM = { id: "00000000-0000-4000-8000-0000000000aa", email: "equipo@amobla.test", email_confirmed_at: "2026-01-01" };
  const stage = (style = "modern") =>
    fotoDemo.POST(req(`/api/admin/demos/${DEMO}/photos/${PHOTO}`, "POST", { key: crypto.randomUUID(), style }), {
      params: Promise.resolve({ id: DEMO, photoId: PHOTO }),
    });
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubEnv("ADMIN_EMAILS", "equipo@amobla.test");
    state.tables.demo_photos = [{ id: PHOTO, property_id: "pr1", project_id: "pj1", position: 0, visible: true, room: "living", label: null, mode: "furnish", discarded: [] }];
    state.tables.generations = [];
  });

  it("never lets the team spend an agency's credits from the admin panel, and says why", async () => {
    state.user = TEAM;
    const r = await stage();
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/ya tiene su cuenta/);
    const quote = await costo.POST(req(`/api/admin/demos/${DEMO}/costo`, "POST", { photoIds: [PHOTO] }), { params: Promise.resolve({ id: DEMO }) });
    expect(quote.status).toBe(409);
    expect(state.rpcs.filter((c) => /reserve/.test(c.name))).toEqual([]);
  });

  it("quotes like it reserves for a team member who owns the agency", async () => {
    state.user = TEAM;
    state.tables.agencies[0].owner_id = TEAM.id;
    state.tables.projects = [{ id: "pj1", user_id: TEAM.id, grant_id: null, credit_grants: null }];
    const quote = await costo.POST(req(`/api/admin/demos/${DEMO}/costo`, "POST", { photoIds: [PHOTO] }), { params: Promise.resolve({ id: DEMO }) });
    expect(quote.status).toBe(200);
    expect(await quote.json()).toMatchObject({ payer: "agency", cost: 1 });
  });

  it("does not start another version while the last one of that style is uncertain", async () => {
    state.tables.generations = [{ id: "00000000-0000-4000-8000-00000000f0e1", project_id: "pj1", style: "modern", status: "needs_review", is_free: false, created_at: "2026-10-01" }];
    const r = await stage("modern");
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/revisión técnica/);
    expect(state.rpcs.filter((c) => /reserve/.test(c.name))).toEqual([]);
    // Once discarded (settled), a new one can start.
    state.tables.demo_photos[0].discarded = ["00000000-0000-4000-8000-00000000f0e1"];
    state.tables.projects = [{ id: "pj1", user_id: OWNER, grant_id: null, credit_grants: null }];
    expect((await stage("modern")).status).toBe(202);
    expect(state.rpcs.filter((c) => c.name === "amobla_reserve_batch")).toHaveLength(1);
  });
});

describe("Adding a property from an agency's row", () => {
  const TEAM = { id: "00000000-0000-4000-8000-0000000000aa", email: "equipo@amobla.test", email_confirmed_at: "2026-01-01" };
  const AG3 = "00000000-0000-4000-8000-00000000a003";
  it("creates it in that agency (validated on the server), never a new one by name", async () => {
    state.user = TEAM;
    state.tables.agencies.push({ id: AG3, name: "Costa Bienes Raíces", website: "https://otra.test/" });
    const missing = await adminImport.POST(req("/api/admin/demos/importar", "POST", { url: "https://sur.test/p/123", agencyId: "00000000-0000-4000-8000-00000000a0ff" }));
    expect(missing.status).toBe(404);
    expect(state.inserts.filter((i) => i.table === "demo_properties")).toEqual([]);
    const r = await adminImport.POST(req("/api/admin/demos/importar", "POST", { url: "https://sur.test/p/123", agencyId: AG3 }));
    expect(r.status).toBe(201);
    expect(state.inserts.find((i) => i.table === "demo_properties")!.row.agency_id).toBe(AG3);
    expect(state.inserts.filter((i) => i.table === "agencies")).toEqual([]);
  });
});

describe("Support view: the team sees an agency's panel, read only", () => {
  const TEAM = { id: "00000000-0000-4000-8000-0000000000aa", email: "equipo@amobla.test", email_confirmed_at: "2026-01-01" };
  const AG = "00000000-0000-4000-8000-00000000a001";
  const params = { params: Promise.resolve({ id: AG }) };
  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAILS", "equipo@amobla.test");
    state.tables.agencies.push({ id: AG, name: "Russillo", website: null, slug: "russillo", owner_id: OWNER, site_published: false });
    state.tables.admin_audit = [];
  });

  it("signs a token for one team member and one agency, that expires", () => {
    const now = Date.parse("2026-10-27T12:00:00Z");
    const t = supportToken(AG, TEAM.id, now);
    expect(readSupportToken(t, TEAM.id, now)).toBe(AG);
    expect(readSupportToken(t, OWNER, now)).toBeNull();
    expect(readSupportToken(t, TEAM.id, now + 61 * 60 * 1000)).toBeNull();
    expect(readSupportToken(t.replace(AG, "00000000-0000-4000-8000-00000000a002"), TEAM.id, now)).toBeNull();
    expect(readSupportToken(`${t.slice(0, -1)}0`, TEAM.id, now)).toBeNull();
  });

  it("is only for the team, audited before it opens", async () => {
    expect((await soporte.POST(req(`/api/admin/inmobiliarias/${AG}/soporte`, "POST"), params)).status).toBe(403);
    expect(state.cookies.size).toBe(0);
    state.user = TEAM;
    const r = await soporte.POST(req(`/api/admin/inmobiliarias/${AG}/soporte`, "POST"), params);
    expect(r.status).toBe(201);
    expect(state.inserts.find((i) => i.table === "admin_audit")!.row).toMatchObject({ actor_id: TEAM.id, action: "agency_support_view", subject_id: AG });
    expect(readSupportToken(state.cookies.get("habita_soporte"), TEAM.id)).toBe(AG);
  });

  it("shows the agency's panel as its owner sees it, and refuses every write", async () => {
    state.user = TEAM;
    state.tables.agency_members = [];
    state.cookies.set("habita_soporte", supportToken(AG, TEAM.id));
    const home = await (await panel.GET()).json();
    expect(home).toMatchObject({ agency: { id: AG, name: "Russillo" }, role: "owner", support: true });
    const write = await panel.PATCH(req("/api/panel", "PATCH", { name: "Otro nombre" }));
    expect(write.status).toBe(403);
    expect((await write.json()).error).toMatch(/solo lectura/);
    expect((await panel.POST(req("/api/panel", "POST", { name: "Mía" }))).status).toBe(403);
    expect(state.updates).toEqual([]);
    expect(state.rpcs.filter((c) => c.name === "habita_create_agency")).toEqual([]);
  });

  it("does nothing for an account that is not on the team, even with the cookie", async () => {
    state.cookies.set("habita_soporte", supportToken(AG, OWNER));
    const home = await (await panel.GET()).json();
    expect(home.agency.id).toBe("ag1");
    expect(home.support).toBe(false);
  });

  it("ends when the team member leaves", async () => {
    state.user = TEAM;
    state.cookies.set("habita_soporte", supportToken(AG, TEAM.id));
    const r = await soporte.DELETE(req(`/api/admin/inmobiliarias/${AG}/soporte`, "DELETE"), params);
    expect(r.status).toBe(200);
    expect(state.cookies.has("habita_soporte")).toBe(false);
    expect(state.inserts.find((i) => i.table === "admin_audit")!.row).toMatchObject({ action: "agency_support_end", subject_id: AG });
  });
});

describe("Photos imported without a ficha", () => {
  const GROUP = "00000000-0000-4000-8000-000000000f01";
  const importGroup = (extra: Record<string, unknown> = {}) =>
    fotosGrupo.POST(req("/api/panel/imagenes", "POST", { url: "https://sur.test/p/123", key: crypto.randomUUID(), ...extra }));
  const publish = (id: string) =>
    demoAgencia.PATCH(req(`/api/admin/demos/${id}`, "PATCH", { action: "publish" }), { params: Promise.resolve({ id }) });

  it("keeps only the photos chosen as a photo group, with no ficha, no credit and no staging", async () => {
    const r = await importGroup({ images: ["https://cdn.test/123_a.jpg", "https://cdn.test/123_b.jpg"] });
    expect(r.status).toBe(201);
    const made = await r.json();
    expect(made).toMatchObject({ status: "partial", photosTotal: 2, photosDone: 0, images: ["https://cdn.test/123_a.jpg", "https://cdn.test/123_b.jpg"] });
    const demo = state.inserts.find((i) => i.table === "demos")?.row;
    expect(demo).toMatchObject({ agency_id: "ag1", kind: "fotos" });
    expect(state.rpcs.filter((c) => /reserve|generation/.test(c.name))).toEqual([]);
    expect(state.inserts.filter((i) => i.table === "generations")).toEqual([]);
  });

  it("never offers a photo the listing did not show", async () => {
    const r = await importGroup({ images: ["https://evil.test/other.jpg"] });
    expect(await r.json()).toMatchObject({ photosTotal: 0, images: [] });
  });

  it("refuses a listing the agency already has, and records it as a duplicate", async () => {
    state.tables.demo_properties = [{ id: "pr1", agency_id: "ag1", listing_url: "https://sur.test/p/123", demos: { id: DEMO } }];
    const r = await importGroup();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ duplicateOf: DEMO });
    expect(state.tables.property_imports[0]).toMatchObject({ status: "duplicate", demo_id: DEMO });
  });

  it("lists photo groups apart from the agency's properties", async () => {
    state.tables.demos.push({ id: GROUP, agency_id: "ag1", kind: "fotos", property_id: "pr9", token: "tok_grupogrupogrupogrupo", status: "draft", settings: {}, demo_properties: { title: "Fotos", location: null, listing_url: null } });
    const groups = await (await fotosGrupo.GET()).json();
    expect(groups.items.map((g: { id: string }) => g.id)).toEqual([GROUP]);
    const properties = await (await propiedades.GET(req("/api/panel/propiedades"))).json();
    expect(properties.items.map((p: { id: string }) => p.id)).not.toContain(GROUP);
  });

  it("cannot be published as a ficha: it must become one first", async () => {
    state.tables.demos.push({ id: GROUP, agency_id: "ag1", kind: "fotos", property_id: "pr9", token: "tok_grupogrupogrupogrupo", status: "draft", settings: {}, demo_properties: { title: "Fotos", location: null, listing_url: null } });
    const r = await publish(GROUP);
    expect(r.status).toBe(409);
    expect(state.tables.demos.find((d) => d.id === GROUP)?.status).toBe("draft");
  });

  it("creates the ficha from the group, keeping its photos and leaving it as a draft", async () => {
    state.tables.demos.push({ id: GROUP, agency_id: "ag1", kind: "fotos", property_id: "pr9", token: "tok_grupogrupogrupogrupo", status: "draft", settings: {}, demo_properties: { title: "Fotos", location: null, listing_url: null } });
    const r = await fichaGrupo.POST(req(`/api/panel/imagenes/${GROUP}/ficha`, "POST"), { params: Promise.resolve({ id: GROUP }) });
    expect(r.status).toBe(200);
    expect(state.tables.demos.find((d) => d.id === GROUP)).toMatchObject({ kind: "ficha", status: "draft" });
    const again = await fichaGrupo.POST(req(`/api/panel/imagenes/${GROUP}/ficha`, "POST"), { params: Promise.resolve({ id: GROUP }) });
    expect(again.status).toBe(409);
  });

  it("creates an empty group for uploaded files, named as the person chose", async () => {
    const r = await grupoSubida.POST(req("/api/panel/imagenes/grupo", "POST", { name: "Casa en Zona Güemes" }));
    expect(r.status).toBe(201);
    expect(state.inserts.find((i) => i.table === "demo_properties")?.row).toMatchObject({ title: "Casa en Zona Güemes", listing_url: null });
    expect(state.inserts.find((i) => i.table === "demos")?.row).toMatchObject({ kind: "fotos" });
  });
});

describe("Users of an agency", () => {
  const EMPLOYEE = "00000000-0000-4000-8000-0000000000e1";
  const PR1 = "00000000-0000-4000-8000-00000000a001";
  const as = (role: string, property_ids: string[] | null = null) => {
    state.user = { id: EMPLOYEE, email: "laura@sur.test", email_confirmed_at: "2026-01-01" };
    state.tables.agency_members.push({ agency_id: "ag1", user_id: EMPLOYEE, role, property_ids, agencies: AGENCY });
  };
  const publish = (id: string) => demoAgencia.PATCH(req(`/api/admin/demos/${id}`, "PATCH", { action: "publish" }), { params: Promise.resolve({ id }) });
  beforeEach(() => {
    state.tables.agency_invites = [];
    state.tables.agency_members[0].agency_id = "ag1";
    state.tables.demos[0].property_id = PR1;
    state.tables.demo_properties = [{ id: PR1, agency_id: "ag1" }];
  });

  it("creates an access for an e-mail with a one-time link, stored only as its hash", async () => {
    const r = await usuarios.POST(req("/api/panel/usuarios", "POST", { name: " Laura  Gómez ", email: "Laura@Sur.test", role: "viewer", properties: [PR1] }));
    expect(r.status).toBe(201);
    const { link } = await r.json();
    const code = new URL(link, origin).searchParams.get("codigo")!;
    expect(link).toMatch(/^\/panel\/unirme\?codigo=[A-Za-z0-9_-]{32}$/);
    const invite = state.inserts.find((i) => i.table === "agency_invites")!.row;
    expect(invite).toMatchObject({ agency_id: "ag1", email: "laura@sur.test", display_name: "Laura Gómez", role: "viewer", property_ids: [PR1], created_by: OWNER });
    expect(invite.code_hash).toBe(createHash("sha256").update(code).digest("hex"));
    expect(JSON.stringify(state.inserts)).not.toContain(code);
  });

  it("refuses properties of another agency, limits for administrators and unknown roles", async () => {
    const post = (body: unknown) => usuarios.POST(req("/api/panel/usuarios", "POST", body));
    expect((await post({ email: "a@sur.test", role: "editor", properties: ["00000000-0000-4000-8000-00000000a999"] })).status).toBe(400);
    expect((await post({ email: "a@sur.test", role: "admin", properties: [PR1] })).status).toBe(400);
    expect((await post({ email: "a@sur.test", role: "owner" })).status).toBe(400);
    expect((await post({ email: "a@sur.test", role: "editor", properties: [] })).status).toBe(400);
    expect(state.inserts.filter((i) => i.table === "agency_invites")).toEqual([]);
  });

  it("lets only the owner and administrators manage users", async () => {
    as("editor");
    expect((await usuarios.GET()).status).toBe(403);
    expect((await usuarios.POST(req("/api/panel/usuarios", "POST", { email: "b@sur.test", role: "admin" }))).status).toBe(403);
    state.tables.agency_members.at(-1)!.role = "admin";
    expect((await usuarios.POST(req("/api/panel/usuarios", "POST", { email: "b@sur.test", role: "editor" }))).status).toBe(201);
  });

  it("never changes or removes the owner, nor one's own access", async () => {
    as("admin");
    const patch = (id: string) => usuario.PATCH(req(`/api/panel/usuarios/${id}`, "PATCH", { kind: "member", role: "viewer" }), { params: Promise.resolve({ id }) });
    expect((await patch(OWNER)).status).toBe(403);
    expect((await patch(EMPLOYEE)).status).toBe(400);
    const del = await usuario.DELETE(req(`/api/panel/usuarios/${OWNER}?tipo=member`, "DELETE"), { params: Promise.resolve({ id: OWNER }) });
    expect(del.status).toBe(403);
    expect(state.tables.agency_members.find((m) => m.user_id === OWNER)).toBeTruthy();
  });

  it("gives a pending access a new link and the previous one stops working", async () => {
    state.tables.agency_invites = [{ id: "00000000-0000-4000-8000-0000000001a1", agency_id: "ag1", email: "c@sur.test", role: "editor", code_hash: "x".repeat(64), used_at: null, revoked_at: null }];
    const id = "00000000-0000-4000-8000-0000000001a1";
    const r = await usuario.PATCH(req(`/api/panel/usuarios/${id}`, "PATCH", { kind: "pending", renew: true }), { params: Promise.resolve({ id }) });
    expect(r.status).toBe(200);
    const { link } = await r.json();
    const code = new URL(link, origin).searchParams.get("codigo")!;
    expect(state.tables.agency_invites[0].code_hash).toBe(createHash("sha256").update(code).digest("hex"));
  });

  it("keeps a viewer from changing anything: properties, imports or the site", async () => {
    as("viewer");
    expect((await publish(DEMO)).status).toBe(403);
    expect((await importar.POST(req("/api/panel/importar", "POST", { url: "https://sur.test/p/1" }))).status).toBe(403);
    expect((await panel.PATCH(req("/api/panel", "PATCH", { sitePublished: true }))).status).toBe(403);
    expect(state.tables.demos[0].status).toBe("published");
  });

  it("shows a limited user only its properties and hides the rest", async () => {
    as("editor", [PR1]);
    const list = await (await propiedades.GET(req("/api/panel/propiedades"))).json();
    expect(list.items.map((p: { id: string }) => p.id)).toEqual([DEMO]);
    state.tables.agency_members.at(-1)!.property_ids = ["00000000-0000-4000-8000-00000000a002"];
    expect((await publish(DEMO)).status).toBe(404);
    expect((await importar.POST(req("/api/panel/importar", "POST", { url: "https://sur.test/p/1" }))).status).toBe(403);
  });

  it("lets an editor publish but not delete properties or change the site", async () => {
    as("editor");
    expect((await publish("d2")).status).not.toBe(403);
    expect((await panel.PATCH(req("/api/panel", "PATCH", { sitePublished: true }))).status).toBe(403);
    const del = await demoAgencia.DELETE(req(`/api/admin/demos/${DEMO}`, "DELETE"), { params: Promise.resolve({ id: DEMO }) });
    expect(del.status).toBe(403);
  });

  it("joins with a new account for the invited e-mail only, and removes it if joining fails", async () => {
    state.user = null;
    const code = "a".repeat(32);
    state.tables.agency_invites = [
      { email: "laura@sur.test", role: "editor", property_ids: null, display_name: "Laura", code_hash: createHash("sha256").update(code).digest("hex"), expires_at: "2999-01-01T00:00:00Z", used_at: null, revoked_at: null, agencies: { name: "Sur Propiedades" } },
    ];
    const r = await unirme.POST(req("/api/panel/unirme", "POST", { code, password: "una-clave-segura" }));
    expect(r.status).toBe(201);
    expect(state.authUsers).toMatchObject([{ email: "laura@sur.test", email_confirm: true }]);
    expect(state.rpcs.find((c) => c.name === "habita_join_agency")!.args).toMatchObject({ p_email: "laura@sur.test" });
    expect((await unirme.POST(req("/api/panel/unirme", "POST", { code: "b".repeat(32), password: "una-clave-segura" }))).status).toBe(404);
  });
});

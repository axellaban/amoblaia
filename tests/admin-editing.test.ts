// "Editar inmobiliaria", the new agency and property flows, and the photo
// editor's rules, against the real route handlers with an in-memory
// database (the same approach as agency-routes.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; email_confirmed_at?: string },
  tables: {} as Record<string, Record<string, unknown>[]>,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  updates: [] as { table: string; row: Record<string, unknown> }[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  listing: null as null | Record<string, unknown>,
  fail: {} as Record<string, { code?: string; message?: string }>,
  cookies: new Map<string, string>(),
  credits: {} as Record<string, number>,
}));

/** In-memory stand-in for the service-role client: filters work, inserts persist, updates and deletes apply to the filtered rows. */
function fakeDb() {
  return {
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id.slice(-4)}@equipo.test` } }, error: null }) } },
    from(table: string) {
      // Properties carry their demo, as PostgREST embeds it.
      const withEmbeds = (r: Row) => (table === "demo_properties" ? { ...r, demos: (state.tables.demos ?? []).filter((d) => d.property_id === r.id) } : r);
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
          const key = row.request_key;
          if (key && (state.tables[table] ?? []).some((r) => r.request_key === key && (table !== "demo_properties" || r.agency_id === row.agency_id))) {
            state.fail[`${table}:insert`] = { code: "23505" };
            return q;
          }
          state.inserts.push({ table, row });
          const made = { id: crypto.randomUUID(), ...row };
          (state.tables[table] ??= []).push(made);
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
        lt: () => q,
        is: (k: string, v: null) => ((rows = rows.filter((r) => (v === null ? r[k] == null : r[k] === v))), q),
        like: () => q,
        not: () => q,
        or: () => q,
        maybeSingle: async () => {
          apply();
          const e = error();
          if (op === "insert") delete state.fail[`${table}:insert`];
          return e ? { data: null, error: e } : { data: rows[0] ? withEmbeds(rows[0]) : null, error: null };
        },
        single: async () => {
          apply();
          const e = error();
          if (op === "insert" && e?.code === "23505") delete state.fail[`${table}:insert`];
          return e ? { data: null, error: e } : rows[0] ? { data: withEmbeds(rows[0]), error: null } : { data: null, error: { code: "PGRST116" } };
        },
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve(
            (apply(), error() ? { data: null, error: error(), count: null } : { data: rows.map(withEmbeds), error: null, count: count ? (total ?? rows.length) : null }),
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
  readListing: async (url: string) => ({ ...state.listing, listingUrl: url }),
  fetchPublic: async () => {
    throw new Error("no network in tests");
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
      if (state.user?.email !== TEAM.email) throw new real.HttpError(403, "Acceso reservado al equipo.");
      return state.user;
    },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      state.rpcs.push({ name, args });
      if (name === "amobla_account") return { credits: state.credits[String(args.p_user)] ?? 0 };
      if (name === "habita_agency_counts") return { total: 1, published: 0, staged: 0, review: 0, operations: [] };
      return null;
    },
  };
});

import * as edicion from "../src/app/api/admin/inmobiliarias/[id]/edicion/route";
import * as agencyRoute from "../src/app/api/admin/inmobiliarias/[id]/route";
import * as agenciesRoute from "../src/app/api/admin/inmobiliarias/route";
import * as coincidencias from "../src/app/api/admin/inmobiliarias/coincidencias/route";
import * as adminProps from "../src/app/api/admin/inmobiliarias/[id]/propiedades/route";
import * as adminImport from "../src/app/api/admin/inmobiliarias/[id]/importar/route";
import * as actividad from "../src/app/api/admin/inmobiliarias/[id]/actividad/route";
import * as demoRoute from "../src/app/api/admin/demos/[id]/route";
import * as fotoDemo from "../src/app/api/admin/demos/[id]/photos/[photoId]/route";
import * as costo from "../src/app/api/admin/demos/[id]/costo/route";
import * as espacios from "../src/app/api/admin/demos/[id]/espacios/route";
import * as panel from "../src/app/api/panel/route";
import * as panelImport from "../src/app/api/panel/importar/route";
import { editToken, readEditToken } from "../src/lib/agency/edit-context";
import { EDIT_HEADER } from "../src/lib/agency/edit-scope";
import { readSupportToken, supportToken } from "../src/lib/agency/support";

const TEAM = { id: "00000000-0000-4000-8000-0000000000aa", email: "equipo@amobla.test", email_confirmed_at: "2026-01-01" };
const OWNER = "00000000-0000-4000-8000-0000000000b1";
const AG_A = "00000000-0000-4000-8000-00000000a001";
const AG_B = "00000000-0000-4000-8000-00000000a002";
const DEMO_A = "00000000-0000-4000-8000-000000000d0a";
const DEMO_B = "00000000-0000-4000-8000-000000000d0b";
const PHOTO = "00000000-0000-4000-8000-00000000f0d1";
const origin = "https://habita.test";
const req = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, {
    method,
    headers: { origin, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (agencyId: string, user = TEAM.id) => ({ [EDIT_HEADER]: editToken(agencyId, user).token });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const audits = () => state.inserts.filter((i) => i.table === "admin_audit").map((i) => i.row);
const LISTING = {
  title: "Departamento en La Perla",
  location: "La Perla",
  description: "Luminoso",
  fullDescription: "Luminoso",
  agency: { name: "Sur", website: "https://sur.test/" },
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
    mapStatus: "missing",
    mapPlaces: [],
    agent: null,
    agency: { name: "Sur", website: "https://sur.test/", logoUrl: null, whatsapp: null, phone: null, email: null },
    images: ["https://cdn.test/123_a.jpg", "https://cdn.test/123_b.jpg"],
    report: [],
  },
};

beforeEach(() => {
  state.user = TEAM;
  state.inserts = [];
  state.updates = [];
  state.rpcs = [];
  state.fail = {};
  state.cookies = new Map();
  state.credits = { [OWNER]: 0 };
  state.listing = structuredClone(LISTING);
  state.tables = {
    agencies: [
      { id: AG_A, name: "GM Servicios Inmobiliarios", website: "https://gm.test/", owner_id: OWNER, slug: "gm", site_published: false, notes: "interna", contact_name: "Ana", branding: {} },
      { id: AG_B, name: "Costa Bienes Raíces", website: null, owner_id: null, slug: null, site_published: false, notes: null, contact_name: null, branding: {} },
    ],
    agency_members: [{ user_id: OWNER, role: "owner", agencies: { id: AG_A, name: "GM Servicios Inmobiliarios", website: null, slug: "gm", owner_id: OWNER, site_published: false } }],
    demo_properties: [
      { id: "pr-a", agency_id: AG_A, title: "Casa A", location: null, listing_url: null, description: null },
      { id: "pr-b", agency_id: AG_B, title: "Casa B", location: null, listing_url: null, description: null },
    ],
    demos: [
      { id: DEMO_A, agency_id: AG_A, property_id: "pr-a", token: "tok_aaaaaaaaaaaaaaaaaaaaaaaa", status: "draft", settings: {}, title: "Casa A" },
      { id: DEMO_B, agency_id: AG_B, property_id: "pr-b", token: "tok_bbbbbbbbbbbbbbbbbbbbbbbb", status: "draft", settings: {}, title: "Casa B" },
    ],
    demo_photos: [
      { id: PHOTO, property_id: "pr-a", project_id: "pj1", position: 0, visible: true, room: "living", label: null, mode: "furnish", discarded: [], approved_generation_id: null },
    ],
    generations: [],
    property_imports: [],
    property_spaces: [],
    admin_audit: [],
    agency_claims: [],
  };
  vi.stubEnv("SAAS_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public");
  vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
  vi.stubEnv("ADMIN_EMAILS", TEAM.email);
  vi.stubEnv("OPENAI_API_KEY", "test");
});
afterEach(() => vi.unstubAllEnvs());

describe("Edit context: signed, for one team member and one agency, with an expiry", () => {
  it("reads only its own tokens, unexpired and untampered", () => {
    const now = Date.parse("2026-10-27T12:00:00Z");
    const { token, expiresAt } = editToken(AG_A, TEAM.id, now);
    expect(readEditToken(token, TEAM.id, now)).toEqual({ agencyId: AG_A, expiresAt });
    expect(readEditToken(token, OWNER, now)).toBeNull();
    expect(readEditToken(token, TEAM.id, now + 4 * 3600 * 1000 + 1000)).toBeNull();
    expect(readEditToken(token.replace(AG_A, AG_B), TEAM.id, now)).toBeNull();
    expect(readEditToken(`${token.slice(0, -1)}0`, TEAM.id, now)).toBeNull();
    // A support token (read-only view) is never an edit context, nor the other way round.
    expect(readEditToken(supportToken(AG_A, TEAM.id, now), TEAM.id, now)).toBeNull();
    expect(readSupportToken(token, TEAM.id, now)).toBeNull();
  });

  it("starts only for the team, on an agency that exists, audited before it is handed out", async () => {
    state.user = { id: OWNER, email: "duenia@gm.test", email_confirmed_at: "2026-01-01" };
    expect((await edicion.POST(req(`/api/admin/inmobiliarias/${AG_A}/edicion`, "POST"), p(AG_A))).status).toBe(403);
    state.user = TEAM;
    expect((await edicion.POST(req("/api/admin/inmobiliarias/x/edicion", "POST"), p("00000000-0000-4000-8000-00000000a0ff"))).status).toBe(404);
    const r = await edicion.POST(req(`/api/admin/inmobiliarias/${AG_A}/edicion`, "POST"), p(AG_A));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(readEditToken(body.token, TEAM.id)?.agencyId).toBe(AG_A);
    expect(audits()).toEqual([expect.objectContaining({ actor_id: TEAM.id, action: "agency_edit_start", subject_id: AG_A })]);
    // No cookie and no session change: the client's account is untouched.
    expect(state.cookies.size).toBe(0);
    expect(state.updates).toEqual([]);
  });

  it("ends audited when the team member leaves", async () => {
    const r = await edicion.DELETE(req(`/api/admin/inmobiliarias/${AG_A}/edicion`, "DELETE", undefined, ctx(AG_A)), p(AG_A));
    expect(r.status).toBe(200);
    expect(audits()).toEqual([expect.objectContaining({ action: "agency_edit_end", subject_id: AG_A })]);
  });
});

describe("The team edits the right agency, and only with its context", () => {
  const data = { name: "GM Servicios", website: "gm.test", contact_name: "Ana", contact_email: "ana@gm.test", notes: "Prefiere WhatsApp" };

  it("saves the agency's data and records who, which agency and what", async () => {
    const r = await agencyRoute.PATCH(req(`/api/admin/inmobiliarias/${AG_A}`, "PATCH", { action: "agency", agency: data }, ctx(AG_A)), p(AG_A));
    expect(r.status).toBe(200);
    expect(state.tables.agencies[0]).toMatchObject({ name: "GM Servicios", contact_email: "ana@gm.test", notes: "Prefiere WhatsApp" });
    expect(audits()).toEqual([
      expect.objectContaining({ actor_id: TEAM.id, action: "agency_edit", subject_id: AG_A, details: expect.objectContaining({ operation: "agency_data", via: "edit_context" }) }),
    ]);
  });

  it("refuses without a context, with an expired one, or with another agency's (two tabs)", async () => {
    const send = (headers: Record<string, string>) =>
      agencyRoute.PATCH(req(`/api/admin/inmobiliarias/${AG_A}`, "PATCH", { action: "agency", agency: data }, headers), p(AG_A));
    expect((await send({})).status).toBe(412);
    const old = editToken(AG_A, TEAM.id, Date.now() - 5 * 3600 * 1000).token;
    expect((await send({ [EDIT_HEADER]: old })).status).toBe(412);
    const other = await send(ctx(AG_B));
    expect(other.status).toBe(409);
    expect((await other.json()).error).toMatch(/otra inmobiliaria/);
    expect(state.updates).toEqual([]);
    expect(audits()).toEqual([]);
  });

  it("is not for accounts outside the team, even with a context or a forged header", async () => {
    state.user = { id: OWNER, email: "duenia@gm.test", email_confirmed_at: "2026-01-01" };
    expect((await agencyRoute.PATCH(req(`/api/admin/inmobiliarias/${AG_A}`, "PATCH", { action: "agency", agency: data }, ctx(AG_A, OWNER)), p(AG_A))).status).toBe(403);
    // The agency's own owner, on a property route, with a team header: refused, not ignored.
    const r = await demoRoute.PATCH(req(`/api/admin/demos/${DEMO_A}`, "PATCH", { action: "unpublish" }, ctx(AG_A, OWNER)), p(DEMO_A));
    expect(r.status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it("never writes on another agency's property from a tab editing this one", async () => {
    const r = await demoRoute.PATCH(req(`/api/admin/demos/${DEMO_B}`, "PATCH", { action: "publish" }, ctx(AG_A)), p(DEMO_B));
    expect(r.status).toBe(409);
    const space = await espacios.POST(req(`/api/admin/demos/${DEMO_B}/espacios`, "POST", { name: "Living" }, ctx(AG_A)), p(DEMO_B));
    expect(space.status).toBe(409);
    expect(state.updates).toEqual([]);
    expect(state.inserts.filter((i) => i.table === "property_spaces")).toEqual([]);
  });

  it("writes on its own agency's property and records the operation with the target", async () => {
    const r = await espacios.POST(req(`/api/admin/demos/${DEMO_A}/espacios`, "POST", { name: "Dormitorio 2", roomType: "bedroom" }, ctx(AG_A)), p(DEMO_A));
    expect(r.status).toBe(201);
    expect(audits()).toContainEqual(
      expect.objectContaining({ actor_id: TEAM.id, action: "agency_edit", subject_id: AG_A, details: expect.objectContaining({ operation: "space_create", demo: DEMO_A, via: "edit_context" }) }),
    );
  });

  it("publishes and unpublishes its own agency's property, audited with the operation", async () => {
    const r = await demoRoute.PATCH(req(`/api/admin/demos/${DEMO_A}`, "PATCH", { action: "publish" }, ctx(AG_A)), p(DEMO_A));
    expect(r.status).toBe(200);
    expect(state.tables.demos[0].status).toBe("published");
    expect(audits()).toContainEqual(expect.objectContaining({ subject_id: AG_A, action: "agency_edit", details: expect.objectContaining({ operation: "publish", demo: DEMO_A }) }));
    // Without a visible photo there is nothing to publish.
    state.tables.demo_photos[0].visible = false;
    state.tables.demos[0].status = "draft";
    expect((await demoRoute.PATCH(req(`/api/admin/demos/${DEMO_A}`, "PATCH", { action: "publish" }, ctx(AG_A)), p(DEMO_A))).status).toBe(409);
  });

  it("keeps the support view read only: the agency's panel refuses every write, edit header or not", async () => {
    state.cookies.set("habita_soporte", supportToken(AG_A, TEAM.id));
    const write = await panel.PATCH(req("/api/panel", "PATCH", { name: "Otro" }, ctx(AG_A)));
    expect(write.status).toBe(403);
    expect((await write.json()).error).toMatch(/solo lectura/);
    expect(state.updates).toEqual([]);
  });
});

describe("Editing never spends the client's credits", () => {
  it("refuses a version on an agency with its own account, quote included, and says why", async () => {
    const stage = await fotoDemo.POST(
      req(`/api/admin/demos/${DEMO_A}/photos/${PHOTO}`, "POST", { key: crypto.randomUUID(), style: "modern" }, ctx(AG_A)),
      { params: Promise.resolve({ id: DEMO_A, photoId: PHOTO }) },
    );
    expect(stage.status).toBe(409);
    expect((await stage.json()).error).toMatch(/ya tiene su cuenta/);
    const quote = await costo.POST(req(`/api/admin/demos/${DEMO_A}/costo`, "POST", { photoIds: [PHOTO] }, ctx(AG_A)), p(DEMO_A));
    expect(quote.status).toBe(409);
    expect(state.rpcs.filter((c) => /reserve/.test(c.name))).toEqual([]);
  });

  it("still lets the team organize: visibility, the version shown and the cover are saved without any reservation", async () => {
    state.tables.generations = [
      { id: "00000000-0000-4000-8000-00000000e001", project_id: "pj1", style: "modern", status: "succeeded", result_path: "x.jpg", is_free: false, created_at: "2026-10-01" },
    ];
    const params = { params: Promise.resolve({ id: DEMO_A, photoId: PHOTO }) };
    const r = await fotoDemo.PATCH(req(`/api/admin/demos/${DEMO_A}/photos/${PHOTO}`, "PATCH", { changes: { visible: false } }, ctx(AG_A)), params);
    expect(r.status).toBe(200);
    expect(state.tables.demo_photos[0].visible).toBe(false);
    expect(state.rpcs.filter((c) => /reserve|credit/.test(c.name))).toEqual([]);
  });
});

describe("New agency on its own", () => {
  const create = (body: Record<string, unknown>) => agenciesRoute.POST(req("/api/admin/inmobiliarias", "POST", body));

  it("needs only a name and creates no account, invitation, credits or property", async () => {
    const key = crypto.randomUUID();
    const r = await create({ key, name: "Martín Propiedades" });
    expect(r.status).toBe(201);
    expect(state.inserts.map((i) => i.table).filter((t) => t !== "admin_audit")).toEqual(["agencies"]);
    expect(state.inserts[0].row).toMatchObject({ name: "Martín Propiedades", website: null, contact_email: null, created_by: TEAM.id, request_key: key });
    expect(state.rpcs.map((c) => c.name).filter((n) => n !== "amobla_account")).toEqual([]);
    expect(audits()).toEqual([expect.objectContaining({ action: "agency_create" })]);
  });

  it("creates once per request key (double click, retry, two tabs)", async () => {
    const key = crypto.randomUUID();
    expect((await create({ key, name: "Martín Propiedades" })).status).toBe(201);
    const again = await create({ key, name: "Martín Propiedades" });
    expect(again.status).toBe(200);
    expect((await again.json()).replay).toBe(true);
    expect(state.inserts.filter((i) => i.table === "agencies")).toHaveLength(1);
  });

  it("shows possible duplicates first and creates it only when confirmed, never merging", async () => {
    const key = crypto.randomUUID();
    const r = await create({ key, name: "GM Servicios Inmobiliarios S.R.L." });
    expect(r.status).toBe(409);
    expect((await r.json()).duplicates).toEqual([expect.objectContaining({ id: AG_A, reasons: ["nombre"] })]);
    expect(state.inserts).toEqual([]);
    const site = await (await coincidencias.GET(req("/api/admin/inmobiliarias/coincidencias?nombre=Otra&web=https://www.gm.test/contacto"))).json();
    expect(site.items).toEqual([expect.objectContaining({ id: AG_A, reasons: ["sitio"] })]);
    expect((await create({ key, name: "GM Servicios Inmobiliarios S.R.L.", confirmDuplicates: true })).status).toBe(201);
    expect(state.tables.agencies).toHaveLength(3);
    expect(state.updates).toEqual([]);
  });

  it("validates the name, the site and the e-mail, and is only for the team", async () => {
    expect((await create({ key: crypto.randomUUID(), name: " " })).status).toBe(400);
    expect((await create({ key: crypto.randomUUID(), name: "X", website: "javascript:alert(1)" })).status).toBe(400);
    expect((await create({ key: crypto.randomUUID(), name: "X", contactEmail: "no-es-email" })).status).toBe(400);
    expect((await create({ name: "Sin clave" })).status).toBe(400);
    state.user = { id: OWNER, email: "duenia@gm.test", email_confirmed_at: "2026-01-01" };
    expect((await create({ key: crypto.randomUUID(), name: "Mía" })).status).toBe(403);
    expect(state.inserts).toEqual([]);
  });
});

describe("Adding a property from the agency's context", () => {
  it("creates a manual draft in the agency of the address and the context, once per key", async () => {
    const key = crypto.randomUUID();
    const body = { key, property: { title: "PH en Güemes", location: "Güemes" }, settings: { operation: "Venta", price: "USD 120.000" } };
    const r = await adminProps.POST(req(`/api/admin/inmobiliarias/${AG_B}/propiedades`, "POST", body, ctx(AG_B)), p(AG_B));
    expect(r.status).toBe(201);
    const made = await r.json();
    expect(state.inserts.find((i) => i.table === "demo_properties")!.row).toMatchObject({ agency_id: AG_B, title: "PH en Güemes", origin: "admin", request_key: key });
    // Same confirm again (double click, lost answer): the same draft.
    const again = await adminProps.POST(req(`/api/admin/inmobiliarias/${AG_B}/propiedades`, "POST", body, ctx(AG_B)), p(AG_B));
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(made.id);
    expect(state.inserts.filter((i) => i.table === "demo_properties")).toHaveLength(1);
    expect(state.inserts.filter((i) => i.table === "agencies")).toEqual([]);
    expect(state.rpcs.filter((c) => /reserve/.test(c.name))).toEqual([]);
    expect(audits()).toContainEqual(expect.objectContaining({ subject_id: AG_B, details: expect.objectContaining({ operation: "property_create" }) }));
  });

  it("ignores any other agency in the body and refuses a context of another agency", async () => {
    const body = { key: crypto.randomUUID(), agencyId: AG_A, property: { title: "PH" } };
    expect((await adminProps.POST(req(`/api/admin/inmobiliarias/${AG_B}/propiedades`, "POST", body, ctx(AG_A)), p(AG_B))).status).toBe(409);
    const r = await adminProps.POST(req(`/api/admin/inmobiliarias/${AG_B}/propiedades`, "POST", body, ctx(AG_B)), p(AG_B));
    expect(r.status).toBe(201);
    expect(state.inserts.find((i) => i.table === "demo_properties")!.row.agency_id).toBe(AG_B);
  });

  it("does not create anything when the title is missing", async () => {
    const r = await adminProps.POST(req(`/api/admin/inmobiliarias/${AG_B}/propiedades`, "POST", { key: crypto.randomUUID(), property: { title: "" } }, ctx(AG_B)), p(AG_B));
    expect(r.status).toBe(400);
    expect(state.inserts).toEqual([]);
  });

  it("imports from a link into that agency with the panel's preview, key and partial recovery, without staging", async () => {
    const url = "https://sur.test/p/123";
    const preview = await adminImport.POST(req(`/api/admin/inmobiliarias/${AG_B}/importar`, "POST", { url, preview: true }, ctx(AG_B)), p(AG_B));
    expect(preview.status).toBe(200);
    expect(state.inserts).toEqual([]);
    const key = crypto.randomUUID();
    const made = await adminImport.POST(req(`/api/admin/inmobiliarias/${AG_B}/importar`, "POST", { url, key, agencyId: AG_A }, ctx(AG_B)), p(AG_B));
    expect(made.status).toBe(201);
    const created = await made.json();
    expect(created).toMatchObject({ status: "partial", photosTotal: 2, photosDone: 0 });
    expect(state.inserts.find((i) => i.table === "demo_properties")!.row).toMatchObject({ agency_id: AG_B, origin: "admin" });
    // One photo arrived, one did not: partial, and the missing one is kept to retry.
    const report = await adminImport.PATCH(
      req(`/api/admin/inmobiliarias/${AG_B}/importar`, "PATCH", { importId: created.importId, done: ["https://cdn.test/123_a.jpg"], failed: ["https://cdn.test/123_b.jpg"] }, ctx(AG_B)),
      p(AG_B),
    );
    expect(await report.json()).toMatchObject({ status: "partial", photosDone: 1, images: ["https://cdn.test/123_b.jpg"] });
    // The retry finishes it.
    const done = await adminImport.PATCH(req(`/api/admin/inmobiliarias/${AG_B}/importar`, "PATCH", { importId: created.importId, done: ["https://cdn.test/123_b.jpg"] }, ctx(AG_B)), p(AG_B));
    expect(await done.json()).toMatchObject({ status: "completed", photosDone: 2, images: [] });
    // The same confirm again creates nothing new.
    const replay = await adminImport.POST(req(`/api/admin/inmobiliarias/${AG_B}/importar`, "POST", { url, key }, ctx(AG_B)), p(AG_B));
    expect((await replay.json()).replay).toBe(true);
    expect(state.inserts.filter((i) => i.table === "demo_properties")).toHaveLength(1);
    expect(state.rpcs.filter((c) => /reserve|generation/.test(c.name))).toEqual([]);
  });

  it("never lets one agency report the photos of another agency's import", async () => {
    state.tables.property_imports = [{ id: "00000000-0000-4000-8000-0000000001a1", agency_id: AG_A, url: "x", status: "partial", pending_images: ["a"], photos_total: 1 }];
    const r = await adminImport.PATCH(
      req(`/api/admin/inmobiliarias/${AG_B}/importar`, "PATCH", { importId: "00000000-0000-4000-8000-0000000001a1", done: ["a"] }, ctx(AG_B)),
      p(AG_B),
    );
    expect(r.status).toBe(404);
  });

  it("keeps the agency's own panel import working as before", async () => {
    state.user = { id: OWNER, email: "duenia@gm.test", email_confirmed_at: "2026-01-01" };
    const r = await panelImport.POST(req("/api/panel/importar", "POST", { url: "https://sur.test/p/123", key: crypto.randomUUID() }));
    expect(r.status).toBe(201);
    expect(state.inserts.find((i) => i.table === "demo_properties")!.row).toMatchObject({ agency_id: AG_A, origin: "agency" });
  });
});

describe("Activity of an agency", () => {
  it("lists what the team did there, newest first, only for the team", async () => {
    state.tables.admin_audit = [{ id: 1, action: "agency_edit", subject_id: AG_A, actor_id: TEAM.id, created_at: "2026-10-27T10:00:00Z", details: { operation: "publish" } }];
    const r = await actividad.GET(req(`/api/admin/inmobiliarias/${AG_A}/actividad`), p(AG_A));
    expect((await r.json()).items).toEqual([expect.objectContaining({ action: "agency_edit", actor: "Vos" })]);
    state.user = { id: OWNER, email: "duenia@gm.test", email_confirmed_at: "2026-01-01" };
    expect((await actividad.GET(req(`/api/admin/inmobiliarias/${AG_A}/actividad`), p(AG_A))).status).toBe(403);
  });
});

import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  admin: true as boolean,
  user: null as null | { id: string; email: string; is_anonymous?: boolean; email_confirmed_at?: string },
  dbCalls: 0,
  touched: [] as string[],
  tables: {} as Record<string, Record<string, unknown>[]>,
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  after: [] as (() => unknown)[],
  freeTier: false,
}));

/** In-memory stand-in for the service-role client: filters work, everything else is a no-op. */
function fakeDb() {
  return {
    from(table: string) {
      state.dbCalls++;
      state.touched.push(table);
      let rows: Row[] = [...(state.tables[table] ?? [])];
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        insert: () => q,
        update: () => q,
        delete: () => q,
        eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
        in: (k: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[k]))), q),
        is: (k: string, v: unknown) => ((rows = rows.filter((r) => (r[k] ?? null) === v)), q),
        like: () => q,
        not: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        single: async () =>
          rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116" } },
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null, count: rows.length }).then(ok, fail),
      };
      return q;
    },
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "x" } }) }) },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => state.after.push(fn) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => fakeDb(),
  currentUser: async () => state.user,
  userClient: async () => ({}),
}));
vi.mock("@/lib/commerce/jobs", () => ({
  BUCKET: "property-images",
  runJob: async () => {},
  onFreeTier: async () => state.freeTier,
}));
vi.mock("@/lib/commerce/http", async (original) => {
  const real = await original<typeof import("../src/lib/commerce/http")>();
  return {
    ...real,
    requireAdmin: async () => {
      if (!state.admin) throw new real.HttpError(403, "Acceso reservado al equipo.");
      return { id: "00000000-0000-4000-8000-0000000000aa", email: "equipo@amobla.test" };
    },
    // The team's account, or the signed-in visitor of each test.
    requireUser: async () => {
      if (state.admin) return { id: "00000000-0000-4000-8000-0000000000aa", email: "equipo@amobla.test" };
      if (!state.user) throw new real.HttpError(401, "Ingresá a tu cuenta y verificá tu email.");
      return state.user;
    },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      state.rpcs.push({ name, args });
      return name === "amobla_reserve_demo_generation" ? ["00000000-0000-4000-8000-0000000000f1"] : {};
    },
  };
});

import * as list from "../src/app/api/admin/demos/route";
import * as one from "../src/app/api/admin/demos/[id]/route";
import * as photos from "../src/app/api/admin/demos/[id]/photos/route";
import * as photo from "../src/app/api/admin/demos/[id]/photos/[photoId]/route";
import * as image from "../src/app/api/admin/demos/imagen/route";
import * as importar from "../src/app/api/admin/demos/importar/route";
import { publicImagePaths, publishedDemo } from "../src/lib/demos/server";
import { requireAdminPage } from "../src/lib/demos/admin-page";

const DEMO = "00000000-0000-4000-8000-000000000d01";
const PHOTO = "00000000-0000-4000-8000-000000000f01";
const HIDDEN = "00000000-0000-4000-8000-000000000f02";
const GEN = "00000000-0000-4000-8000-000000000e01";
const GEN2 = "00000000-0000-4000-8000-000000000e02";
const GEN3 = "00000000-0000-4000-8000-000000000e03";
const TOKEN = "tok_abcdefghijklmnopqrstuvwx";
const origin = "https://amoblaia.test";
const req = (path: string, method = "GET", body?: unknown) =>
  new Request(`${origin}${path}`, {
    method,
    headers: { origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  state.admin = true;
  state.user = null;
  state.dbCalls = 0;
  state.touched = [];
  state.freeTier = false;
  state.rpcs = [];
  state.after = [];
  state.tables = {
    demos: [
      { id: DEMO, agency_id: "ag1", property_id: "pr1", title: null, token: TOKEN, status: "published", cover_photo_id: null, published_at: null, created_at: "2026-10-26T00:00:00Z" },
    ],
    agencies: [
      { id: "ag1", name: "Sur Propiedades", website: "https://sur.test/", contact_name: "Ana", notes: "Le interesa el plan Agente" },
    ],
    demo_properties: [
      { id: "pr1", agency_id: "ag1", title: "Depto en Palermo", location: "Palermo", listing_url: "https://portal.test/1", description: "Luminoso" },
    ],
    demo_photos: [
      { id: PHOTO, property_id: "pr1", project_id: "pj1", position: 0, visible: true, room: "living", label: null, style: "modern", mode: "furnish", approved_generation_id: GEN, discarded: [] },
      { id: HIDDEN, property_id: "pr1", project_id: "pj2", position: 1, visible: false, room: "bedroom", label: "Suite", style: "modern", mode: "furnish", approved_generation_id: null, discarded: [] },
    ],
    generations: [
      { id: GEN, project_id: "pj1", style: "modern", result_path: "u/pj1/g.jpg", status: "succeeded", is_free: false },
      { id: GEN2, project_id: "pj1", style: "industrial", result_path: "u/pj1/h.jpg", status: "succeeded", is_free: false },
      { id: GEN3, project_id: "pj2", style: "modern", result_path: "u/pj2/g.jpg", status: "succeeded", is_free: false },
    ],
    projects: [
      { id: "pj1", original_path: "u/demos/a.jpg", deleted_at: null },
      { id: "pj2", original_path: "u/demos/b.jpg", deleted_at: null },
    ],
  };
  vi.stubEnv("SAAS_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public");
  vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
  vi.stubEnv("ADMIN_EMAILS", "equipo@amobla.test");
});
afterEach(() => vi.unstubAllEnvs());

describe("Admin API authorization", () => {
  it("rejects every demo operation for accounts that are neither admins nor members, before reading any demo", async () => {
    state.admin = false;
    state.user = { id: "00000000-0000-4000-8000-0000000000cc", email: "cliente@example.com", email_confirmed_at: "2026-01-01" };
    const responses = await Promise.all([
      list.GET(),
      list.POST(req("/api/admin/demos", "POST", { agency: { name: "X" }, property: { title: "Y" } })),
      importar.POST(req("/api/admin/demos/importar", "POST", { url: "https://x.com/p/1" })),
      photos.POST(req(`/api/admin/demos/${DEMO}/photos`, "POST", { url: "https://x.com/1.jpg" }), params({ id: DEMO })),
      one.GET(req(`/api/admin/demos/${DEMO}`), params({ id: DEMO })),
      one.PATCH(req(`/api/admin/demos/${DEMO}`, "PATCH", { action: "publish" }), params({ id: DEMO })),
      one.DELETE(req(`/api/admin/demos/${DEMO}`, "DELETE"), params({ id: DEMO })),
      photos.POST(req(`/api/admin/demos/${DEMO}/photos`, "POST"), params({ id: DEMO })),
      photo.GET(req("/x"), params({ id: DEMO, photoId: PHOTO })),
      photo.PATCH(req("/x", "PATCH", { approve: GEN }), params({ id: DEMO, photoId: PHOTO })),
      photo.DELETE(req("/x", "DELETE"), params({ id: DEMO, photoId: PHOTO })),
      photo.POST(req("/x", "POST", { key: GEN }), params({ id: DEMO, photoId: PHOTO })),
      image.GET(req(`/api/admin/demos/imagen?foto=${PHOTO}&v=original`)),
    ]);
    // The team-only listing, creation and import say so; a property of an
    // agency the account does not work for is not even revealed.
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 404, 404, 404, 404, 404, 404, 404, 404, 404, 404]);
    expect(new Set(state.touched)).toEqual(new Set(["agency_members"]));
    expect(state.rpcs).toEqual([]);
  });

  it("keeps the panel pages from anyone who is not an admin", async () => {
    await expect(requireAdminPage("/admin/demos")).rejects.toThrow("REDIRECT:/acceso?next=%2Fadmin%2Fdemos");
    state.user = { id: "u1", email: "cliente@example.com", email_confirmed_at: "2026-01-01" };
    await expect(requireAdminPage("/admin/demos")).rejects.toThrow("NOT_FOUND");
    state.user = { id: "u2", email: "equipo@amobla.test", email_confirmed_at: undefined };
    await expect(requireAdminPage("/admin/demos")).rejects.toThrow(/REDIRECT/);
    state.user = { id: "u3", email: "equipo@amobla.test", email_confirmed_at: "2026-01-01" };
    await expect(requireAdminPage("/admin/demos")).resolves.toMatchObject({ id: "u3" });
  });
});

const OWNER = "00000000-0000-4000-8000-0000000000b1";
const HELPER = "00000000-0000-4000-8000-0000000000b2";
/** Turns the test agency into an account with an owner and a collaborator; `who` signs in. */
function agencyAccount(who: string, ownerPaidPhoto = false) {
  state.admin = false;
  const agency = { id: "ag1", name: "Sur Propiedades", website: "https://sur.test/", slug: "sur", owner_id: OWNER, site_published: false };
  Object.assign(state.tables.agencies[0], { owner_id: OWNER, slug: "sur" });
  state.tables.agency_members = [
    { agency_id: "ag1", user_id: OWNER, role: "owner", agencies: agency },
    { agency_id: "ag1", user_id: HELPER, role: "collaborator", agencies: agency },
  ];
  for (const p of state.tables.projects) Object.assign(p, { user_id: OWNER, grant_id: ownerPaidPhoto ? "gr1" : null, credit_grants: ownerPaidPhoto ? { source_key: "payment:1" } : null });
  state.user = { id: who, email: `${who}@inmo.test`, email_confirmed_at: "2026-01-01" };
}

describe("Agency members on their own properties", () => {
  it("lets members open their property, and not one of another agency", async () => {
    agencyAccount(HELPER);
    expect((await one.GET(req(`/api/admin/demos/${DEMO}`), params({ id: DEMO }))).status).toBe(200);
    state.tables.agency_members[1].agency_id = "ag2";
    (state.tables.agency_members[1].agencies as Row).id = "ag2";
    expect((await one.GET(req(`/api/admin/demos/${DEMO}`), params({ id: DEMO }))).status).toBe(404);
  });

  it("stages with the owner's credits through the regular reservation, never the team's demo grant", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-never-real");
    agencyAccount(HELPER, true);
    const r = await photo.POST(
      req("/x", "POST", { key: GEN, room: "living", style: "modern", mode: "furnish" }),
      params({ id: DEMO, photoId: PHOTO }),
    );
    expect(r.status).toBe(202);
    expect(state.rpcs.map((c) => c.name)).not.toContain("amobla_reserve_demo_generation");
    expect(state.rpcs.find((c) => c.name === "amobla_reserve_batch")!.args).toMatchObject({
      p_user: OWNER,
      p_project: "pj1",
      p_key: GEN,
      p_daily_limit: 100,
    });
  });

  it("asks for credits instead of producing a marked result that could not be published", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-never-real");
    agencyAccount(OWNER);
    state.freeTier = true;
    const r = await photo.POST(req("/x", "POST", { key: GEN, style: "modern" }), params({ id: DEMO, photoId: PHOTO }));
    expect(r.status).toBe(402);
    expect(state.rpcs.map((c) => c.name)).not.toContain("amobla_reserve_batch");
  });

  it("does not let the team spend an agency's credits", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-never-real");
    agencyAccount(OWNER, true);
    state.admin = true;
    const r = await photo.POST(req("/x", "POST", { key: GEN, style: "modern" }), params({ id: DEMO, photoId: PHOTO }));
    expect(r.status).toBe(409);
    expect(state.rpcs.filter((c) => /reserve/.test(c.name))).toEqual([]);
  });

  it("keeps the team's notes, the brand and deleting for the right people", async () => {
    agencyAccount(HELPER);
    const notes = await one.PATCH(req(`/api/admin/demos/${DEMO}`, "PATCH", { action: "agency", agency: { name: "X", notes: "y" } }), params({ id: DEMO }));
    expect(notes.status).toBe(403);
    const brand = await one.PATCH(req(`/api/admin/demos/${DEMO}`, "PATCH", { action: "branding", branding: { primary: "#24382e" } }), params({ id: DEMO }));
    expect(brand.status).toBe(403);
    expect((await one.DELETE(req(`/api/admin/demos/${DEMO}`, "DELETE"), params({ id: DEMO }))).status).toBe(403);
    // The team's private notes never reach a member's view of the property.
    const detail = JSON.stringify(await (await one.GET(req(`/api/admin/demos/${DEMO}`), params({ id: DEMO }))).json());
    expect(detail).not.toContain("Le interesa");
    expect(detail).not.toContain('"Ana"');
  });
});

describe("Imported photos without a ficha", () => {
  it("tells the editor it is a photo group, and refuses to publish it until it becomes a ficha", async () => {
    agencyAccount(HELPER);
    const ficha = await (await one.GET(req(`/api/admin/demos/${DEMO}`), params({ id: DEMO }))).json();
    expect(ficha.demo.kind).toBe("ficha");
    (state.tables.demos[0] as Row).kind = "fotos";
    const group = await (await one.GET(req(`/api/admin/demos/${DEMO}`), params({ id: DEMO }))).json();
    expect(group.demo.kind).toBe("fotos");
    const r = await one.PATCH(req(`/api/admin/demos/${DEMO}`, "PATCH", { action: "publish" }), params({ id: DEMO }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("Creá la ficha antes de publicar estas fotos.");
  });
});

describe("AI staging from the panel", () => {
  it("reserves through the demo RPC with the regular prompt and no daily cap", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-never-real");
    vi.stubEnv("MAX_GENERATIONS_PER_DAY", "90");
    const r = await photo.POST(
      req("/x", "POST", { key: GEN, room: "bedroom", style: "scandinavian", mode: "redesign" }),
      params({ id: DEMO, photoId: PHOTO }),
    );
    expect(r.status).toBe(202);
    const call = state.rpcs.find((c) => c.name === "amobla_reserve_demo_generation")!;
    expect(call.args).toMatchObject({
      p_actor: "00000000-0000-4000-8000-0000000000aa",
      p_photo: PHOTO,
      p_room: "bedroom",
      p_style: "scandinavian",
      p_mode: "redesign",
      p_daily_limit: 1_000_000,
    });
    expect(String(call.args.p_prompt)).toContain("STRICT ARCHITECTURAL CONSTRAINTS");
    expect(state.after).toHaveLength(1);
  });

  it("does not start without the provider configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const r = await photo.POST(req("/x", "POST", { key: GEN }), params({ id: DEMO, photoId: PHOTO }));
    expect(r.status).toBe(503);
    expect(state.rpcs).toEqual([]);
  });
});

describe("Public demo", () => {
  it("returns only what the page shows: no internal notes, contact person, settings or hidden photos", async () => {
    const demo = await publishedDemo(TOKEN);
    expect(demo).toMatchObject({
      agencyName: "Sur Propiedades",
      title: "Depto en Palermo",
      location: "Palermo",
      styles: [
        { id: "modern", name: "Moderno" },
        { id: "industrial", name: "Industrial" },
      ],
      cover: { id: PHOTO },
      photos: [
        {
          id: PHOTO,
          // No room name: "Living" would be wrong for an office.
          label: "",
          versions: [
            { style: "modern", v: GEN.slice(0, 8) },
            { style: "industrial", v: GEN2.slice(0, 8) },
          ],
        },
      ],
    });
    const json = JSON.stringify(demo);
    // The agency's site and the original listing are public now: the page links to them.
    expect(demo).toMatchObject({ listingUrl: "https://portal.test/1", agency: { website: "https://sur.test/" } });
    for (const secret of ["Le interesa", "Ana", "u/demos", "u/pj1", "Suite", GEN, "openMode", "banner\":false"])
      expect(json).not.toContain(secret);
  });

  it("is unavailable as a draft, with a malformed token or once unpublished", async () => {
    expect(await publishedDemo("short")).toBeNull();
    state.tables.demos[0].status = "draft";
    expect(await publishedDemo(TOKEN)).toBeNull();
    expect(await publicImagePaths(TOKEN, PHOTO, null)).toBeNull();
  });

  it("serves images only for visible photos, and a style only when it has a deliverable version", async () => {
    expect(await publicImagePaths(TOKEN, PHOTO, null)).toEqual({ original: "u/demos/a.jpg", staged: null });
    expect(await publicImagePaths(TOKEN, PHOTO, "industrial")).toEqual({ original: "u/demos/a.jpg", staged: "u/pj1/h.jpg" });
    expect(await publicImagePaths(TOKEN, PHOTO, "coastal")).toBeNull();
    expect(await publicImagePaths(TOKEN, HIDDEN, null)).toBeNull();
    state.tables.generations[0].is_free = true;
    expect(await publicImagePaths(TOKEN, PHOTO, "modern")).toBeNull();
    state.tables.demo_photos[0].discarded = [GEN2];
    expect((await publishedDemo(TOKEN))?.photos[0].versions).toEqual([]);
  });

  it("opens the gallery on the cover the agency chose, keeping the rest in order", async () => {
    state.tables.demo_photos[1].visible = true;
    expect((await publishedDemo(TOKEN))?.photos.map((p) => p.id)).toEqual([PHOTO, HIDDEN]);
    (state.tables.demos[0] as Row).cover_photo_id = HIDDEN;
    const demo = await publishedDemo(TOKEN);
    expect(demo?.photos.map((p) => p.id)).toEqual([HIDDEN, PHOTO]);
    expect(demo?.cover?.id).toBe(HIDDEN);
    // A hidden cover is not shown: the order stays as it was.
    state.tables.demo_photos[1].visible = false;
    expect((await publishedDemo(TOKEN))?.photos.map((p) => p.id)).toEqual([PHOTO]);
  });

  it("keeps the main style first, for the cover and the link preview", async () => {
    for (const p of state.tables.demo_photos) p.style = "industrial";
    const demo = await publishedDemo(TOKEN);
    expect(demo?.styles.map((s) => s.id)).toEqual(["industrial", "modern"]);
    expect(demo?.photos[0].versions.map((v) => v.style)).toEqual(["industrial", "modern"]);
  });

  it("opens in the configured style when some visible photo has it, else with the original", async () => {
    expect((await publishedDemo(TOKEN))?.openStyle).toBeNull();
    (state.tables.demos[0] as Row).settings = { openMode: "styled", openStyle: "industrial" };
    expect((await publishedDemo(TOKEN))?.openStyle).toBe("industrial");
    (state.tables.demos[0] as Row).settings = { openMode: "styled", openStyle: "coastal" };
    expect((await publishedDemo(TOKEN))?.openStyle).toBeNull();
    // A style staged only in the second photo: still available while that photo is visible.
    state.tables.generations.push({ id: "00000000-0000-4000-8000-0000000000f4", project_id: "pj2", style: "coastal", result_path: "u/pj2/c.jpg", status: "succeeded", is_free: false });
    expect((await publishedDemo(TOKEN))?.openStyle).toBeNull();
    state.tables.demo_photos[1].visible = true;
    expect((await publishedDemo(TOKEN))?.openStyle).toBe("coastal");
    (state.tables.demos[0] as Row).settings = { openMode: "original", openStyle: "industrial" };
    expect((await publishedDemo(TOKEN))?.openStyle).toBeNull();
  });

  it("sends inquiries to the agency's own channel, with its brand", async () => {
    (state.tables.agencies[0] as Row).branding = {
      primary: "#123456",
      contactKind: "whatsapp",
      contactValue: "+54 9 223 555-1234",
      logo: { type: "image/png", data: "aGVsbG8=", v: "abc123" },
    };
    (state.tables.demos[0] as Row).settings = { banner: false, price: "USD 265.000" };
    const demo = await publishedDemo(TOKEN);
    expect(demo?.agency).toMatchObject({
      name: "Sur Propiedades",
      primary: "#123456",
      contact: { kind: "whatsapp", value: "+54 9 223 555-1234" },
      logo: `/demo/${TOKEN}/logo?v=abc123`,
    });
    expect(demo).toMatchObject({ banner: false, price: "USD 265.000", operation: null });
    expect(JSON.stringify(demo)).not.toContain("aGVsbG8=");
  });

  it("shows only the styles that fit the property type", async () => {
    (state.tables.demos[0] as Row).settings = { propertyType: "office" };
    expect((await publishedDemo(TOKEN))?.styles).toEqual([]);
    state.tables.generations.push({
      id: "00000000-0000-4000-8000-000000000e09",
      project_id: "pj1",
      style: "office_executive",
      result_path: "u/pj1/o.jpg",
      status: "succeeded",
      is_free: false,
    });
    expect((await publishedDemo(TOKEN))?.styles).toEqual([{ id: "office_executive", name: "Oficina ejecutiva" }]);
  });

  it("never shows a contradictory price, nor a map more precise than the listing", async () => {
    (state.tables.demos[0] as Row).settings = {
      operation: "Alquiler",
      price: "$ 1.100.000",
      priceConflict: "cabecera $ 1.100.000 / descripción $ 950.000",
      map: { precision: "approx", lat: -38.004871, lng: -57.551234 },
    };
    const demo = await publishedDemo(TOKEN);
    expect(demo?.price).toBeNull();
    expect(demo?.map).toEqual({ precision: "approx", lat: -38.005, lng: -57.551, radius: 300 });
    expect(JSON.stringify(demo)).not.toContain("950.000");
    (state.tables.demos[0] as Row).settings = { map: { precision: "zone", lat: -38.004871, lng: -57.551234 } };
    expect((await publishedDemo(TOKEN))?.map).toEqual({ precision: "zone", lat: -38, lng: -57.55, radius: 1000 });
  });

  it("routes inquiries to the assigned agent first, then to the agency", async () => {
    (state.tables.agencies[0] as Row).branding = { contactKind: "whatsapp", contactValue: "+54 9 223 555-0000" };
    expect((await publishedDemo(TOKEN))?.contact.whatsapp).toBe("+54 9 223 555-0000");
    (state.tables.demos[0] as Row).settings = {
      agent: { name: "Guadalupe Bonanni Tempone", whatsapp: "+54 9 223 555-1111", email: "gb@sur.test" },
    };
    const demo = await publishedDemo(TOKEN);
    expect(demo?.contact).toMatchObject({ whatsapp: "+54 9 223 555-1111", email: "gb@sur.test" });
    expect(demo?.agent).toMatchObject({ name: "Guadalupe Bonanni Tempone", initials: "GB", photoUrl: null });
  });
});

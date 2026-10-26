import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  admin: true as boolean,
  user: null as null | { id: string; email: string; is_anonymous?: boolean; email_confirmed_at?: string },
  dbCalls: 0,
  tables: {} as Record<string, Record<string, unknown>[]>,
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  after: [] as (() => unknown)[],
}));

/** In-memory stand-in for the service-role client: filters work, everything else is a no-op. */
function fakeDb() {
  return {
    from(table: string) {
      state.dbCalls++;
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
vi.mock("@/lib/commerce/jobs", () => ({ BUCKET: "property-images", runJob: async () => {} }));
vi.mock("@/lib/commerce/http", async (original) => {
  const real = await original<typeof import("../src/lib/commerce/http")>();
  return {
    ...real,
    requireAdmin: async () => {
      if (!state.admin) throw new real.HttpError(403, "Acceso reservado al equipo.");
      return { id: "00000000-0000-4000-8000-0000000000aa", email: "equipo@amobla.test" };
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
  it("rejects every demo operation for accounts that are not admins, before touching data", async () => {
    state.admin = false;
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
    for (const r of responses) expect(r.status).toBe(403);
    expect(state.dbCalls).toBe(0);
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

describe("AI staging from the panel", () => {
  it("reserves through the demo RPC with the regular prompt and daily capacity", async () => {
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
      p_daily_limit: 90,
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
  it("returns only what the page shows: no notes, contacts, listing URL or hidden photos", async () => {
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
          label: "Living",
          versions: [
            { style: "modern", v: GEN.slice(0, 8) },
            { style: "industrial", v: GEN2.slice(0, 8) },
          ],
        },
      ],
    });
    const json = JSON.stringify(demo);
    for (const secret of ["Le interesa", "Ana", "sur.test", "portal.test", "u/demos", "u/pj1", "Suite", GEN])
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

  it("keeps the main style first, for the cover and the link preview", async () => {
    for (const p of state.tables.demo_photos) p.style = "industrial";
    const demo = await publishedDemo(TOKEN);
    expect(demo?.styles.map((s) => s.id)).toEqual(["industrial", "modern"]);
    expect(demo?.photos[0].versions.map((v) => v.style)).toEqual(["industrial", "modern"]);
  });
});

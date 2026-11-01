// Habita V2 panel (Fase 2): the sidebar, the home's three ways in, the
// upcoming tools' pages and their interest API, and the feature_interest table.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/analytics", () => ({ track: () => {}, trackMilestone: () => {}, registerSuperProperties: () => {}, registerSuperPropertiesOnce: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/panel", useSearchParams: () => new URLSearchParams() }));

// --- interest API: auth and database replaced -------------------------------------------------
const auth = vi.hoisted(() => ({
  user: { id: "00000000-0000-4000-8000-000000000001", email: "ana@inmo.com", email_confirmed_at: "x" } as Record<string, unknown> | null,
  membership: { role: "viewer", agency: { id: "00000000-0000-4000-8000-0000000000a1", name: "Inmo Sur" }, scope: null } as Record<string, unknown> | null,
  rows: [] as Record<string, unknown>[],
  upserts: [] as { row: Record<string, unknown>; onConflict: string }[],
}));
vi.mock("@/lib/commerce/http", async (orig) => {
  const real = await orig<typeof import("../src/lib/commerce/http")>();
  return {
    ...real,
    requireUser: async (request?: Request) => {
      if (request && request.headers.get("origin") === "https://evil.example") throw new real.HttpError(403, "Origen inválido.");
      if (!auth.user) throw new real.HttpError(401, "Ingresá a tu cuenta.");
      return auth.user;
    },
  };
});
vi.mock("@/lib/agency/server", async () => {
  const { HttpError } = await import("../src/lib/commerce/http");
  return {
    membershipFor: async () => auth.membership,
    requireAgency: async () => {
      if (!auth.user) throw new HttpError(401, "Ingresá a tu cuenta.");
      if (!auth.membership) throw new HttpError(404, "Todavía no creaste tu inmobiliaria.");
      return { user: auth.user, ...auth.membership };
    },
  };
});
vi.mock("@/lib/supabase/server", () => {
  const match = (filters: Record<string, unknown>) => auth.rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
  const builder = () => {
    const filters: Record<string, unknown> = {};
    let update: Record<string, unknown> | null = null;
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => ((filters[k] = v), b),
      maybeSingle: async () => ({ data: match(filters)[0] ?? null, error: null }),
      upsert: async (row: Record<string, unknown>, opts: { onConflict: string }) => {
        auth.upserts.push({ row, onConflict: opts.onConflict });
        const key = { feature_key: row.feature_key, agency_id: row.agency_id, user_id: row.user_id };
        const found = match(key)[0];
        if (found) Object.assign(found, row);
        else auth.rows.push({ ...row });
        return { error: null };
      },
      update: (u: Record<string, unknown>) => ((update = u), b),
      then: (resolve: (v: { error: null }) => void) => {
        if (update) for (const r of match(filters)) Object.assign(r, update);
        resolve({ error: null });
      },
    };
    return b;
  };
  return { adminClient: () => ({ from: () => builder() }), currentUser: async () => auth.user };
});

import { GET, POST, DELETE } from "../src/app/api/panel/interes/route";
import { PanelNav } from "../src/components/panel-shell";
import { FutureFeaturePage } from "../src/components/future-feature";
import { FUTURE_FEATURE_INFO, FUTURE_FEATURES } from "../src/lib/agency/future-features";

const req = (method: string, query = "", body?: unknown, origin = "https://habitaia.vercel.app") =>
  new Request(`https://habitaia.vercel.app/api/panel/interes${query}`, {
    method,
    headers: { "content-type": "application/json", origin },
    body: body ? JSON.stringify(body) : undefined,
  });

describe("Interest in upcoming tools (API)", () => {
  beforeEach(() => {
    auth.rows.length = 0;
    auth.upserts.length = 0;
    auth.user = { id: "00000000-0000-4000-8000-000000000001", email: "ana@inmo.com", email_confirmed_at: "x" };
    auth.membership = { role: "viewer", agency: { id: "00000000-0000-4000-8000-0000000000a1", name: "Inmo Sur" }, scope: null };
  });

  it("any member, a viewer too, registers interest for its agency; channels are explicit opt-ins", async () => {
    const res = await POST(req("POST", "", { feature: "tour_360", notifyEmail: true, notifyWhatsapp: false, source: "future_feature_page" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ interested: true, notifyEmail: true, notifyWhatsapp: false, first: true });
    expect(auth.upserts[0]).toMatchObject({
      onConflict: "feature_key,agency_id,user_id",
      row: { feature_key: "tour_360", agency_id: "00000000-0000-4000-8000-0000000000a1", user_id: "00000000-0000-4000-8000-000000000001", notify_email: true, notify_whatsapp: false, cancelled_at: null },
    });
    // Not ticked is not consent.
    await POST(req("POST", "", { feature: "planos" }));
    expect(auth.upserts[1].row).toMatchObject({ notify_email: false, notify_whatsapp: false });
  });

  it("asking again updates the same row (one per feature, agency and user) and is not a new interest", async () => {
    await POST(req("POST", "", { feature: "api", notifyEmail: true }));
    const again = await (await POST(req("POST", "", { feature: "api", notifyEmail: false, notifyWhatsapp: true }))).json();
    expect(again).toMatchObject({ first: false, notifyWhatsapp: true, notifyEmail: false });
    expect(auth.rows).toHaveLength(1);
  });

  it("can be withdrawn, keeping the row as cancelled", async () => {
    await POST(req("POST", "", { feature: "redes", notifyEmail: true }));
    expect(await (await DELETE(req("DELETE", "?feature=redes"))).json()).toEqual({ interested: false, notifyEmail: false, notifyWhatsapp: false });
    expect(auth.rows[0]).toMatchObject({ notify_email: false, cancelled_at: expect.any(String) });
    expect(await (await GET(req("GET", "?feature=redes"))).json()).toMatchObject({ interested: false });
  });

  it("refuses unknown features, other origins, signed-out visitors, people without an agency and the team's support view", async () => {
    expect((await POST(req("POST", "", { feature: "teleport" }))).status).toBe(400);
    expect((await POST(req("POST", "", { feature: "api" }, "https://evil.example"))).status).toBe(403);
    auth.membership = { ...auth.membership!, support: true };
    expect((await POST(req("POST", "", { feature: "api" }))).status).toBe(403);
    expect(await (await GET(req("GET", "?feature=api"))).json()).toEqual({ interested: false, notifyEmail: false, notifyWhatsapp: false });
    auth.membership = null;
    expect((await POST(req("POST", "", { feature: "api" }))).status).toBe(404);
    auth.user = null;
    expect((await POST(req("POST", "", { feature: "api" }))).status).toBe(401);
    expect(auth.upserts).toHaveLength(0);
  });
});

describe("Panel navigation and home", () => {
  it("the sidebar has Sitio web and the four upcoming tools as plain items, without «Próximamente»", () => {
    const html = renderToStaticMarkup(<PanelNav section="inicio" agencyName="Inmo Sur" role="owner" credits={3} />);
    for (const label of ["Inicio", "Mis propiedades", "Estudio de imágenes", "Video", "Sitio web", "Tour 360", "Planos", "Redes", "API", "Planes y créditos", "Usuarios", "Ayuda"])
      expect(html).toContain(`<span>${label}</span>`);
    for (const slug of ["tour-360", "planos", "redes", "api"]) expect(html).toContain(`href="/panel/${slug}"`);
    expect(html).not.toMatch(/Pr[oó]ximamente/i);
    expect(html).not.toMatch(/aria-disabled|disabled/);
    // «Usuarios» sits right above «Sitio web».
    expect(html.indexOf("<span>Usuarios</span>")).toBeLessThan(html.indexOf("<span>Sitio web</span>"));
    expect(html.indexOf("<span>Estudio de imágenes</span>")).toBeLessThan(html.indexOf("<span>Usuarios</span>"));
  });

  it("the site and users are only for the owner and administrators", () => {
    const html = renderToStaticMarkup(<PanelNav section="inicio" agencyName="Inmo Sur" role="viewer" />);
    expect(html).not.toContain("<span>Sitio web</span>");
    expect(html).not.toContain("<span>Usuarios</span>");
    expect(html).toContain("<span>Tour 360</span>");
  });

  it("the home offers exactly three large cards and never the upcoming tools", () => {
    const source = readFileSync("src/components/agency-panel.tsx", "utf8");
    const cards = source.slice(source.indexOf("function HomeCards"), source.indexOf("function HomeProperty"));
    expect([...cards.matchAll(/\btitle: "([^"]+)"/g)].map((m) => m[1])).toEqual(["Crear demostraciones", "Estudio de imágenes", "Video"]);
    const home = source.slice(source.indexOf("function HomeCards"), source.indexOf('/** "Ver mi sitio"'));
    expect(home).not.toMatch(/Tour 360|Planos|Redes|\/panel\/api|Pr[oó]ximamente|Guardar (mi )?panel/);
  });
});

describe("Upcoming tool page", () => {
  it("each one says «Próximamente», explains the benefit and asks before any notice", () => {
    for (const feature of FUTURE_FEATURES) {
      const html = renderToStaticMarkup(<FutureFeaturePage feature={feature} agencyName="Inmo Sur" role="owner" />);
      expect(html).toContain(`>${FUTURE_FEATURE_INFO[feature].title}</h1>`);
      expect(html).toContain("Próximamente");
      expect(html).toContain(FUTURE_FEATURE_INFO[feature].description.slice(0, 30));
      expect(html).toContain("<svg");
      expect(html).toContain('href="/panel"');
    }
  });
});

describe("feature_interest table", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
     create table auth.users(id uuid primary key, is_anonymous boolean not null default false);
     create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
     create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
     create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;
     create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
     grant usage on schema public to authenticated;`);
    for (const file of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }, 30000);
  afterAll(async () => await db?.close());

  it("one row per feature, agency and user; only known features; nobody but the server reads it", async () => {
    const user = "00000000-0000-4000-8000-000000000101";
    await db.query("insert into auth.users(id) values($1)", [user]);
    const agency = (await db.query<{ id: string }>("insert into agencies(name) values('Inmo Sur') returning id")).rows[0].id;
    await db.query("insert into feature_interest(feature_key,agency_id,user_id,notify_email) values('tour_360',$1,$2,true)", [agency, user]);
    await expect(db.query("insert into feature_interest(feature_key,agency_id,user_id) values('tour_360',$1,$2)", [agency, user])).rejects.toThrow(/unique|duplicate/i);
    await expect(db.query("insert into feature_interest(feature_key,agency_id,user_id) values('teleport',$1,$2)", [agency, user])).rejects.toThrow(/check/i);
    // Interested agencies are distinct agency_id.
    expect((await db.query<{ n: number }>("select count(distinct agency_id)::int n from feature_interest where feature_key='tour_360' and cancelled_at is null")).rows[0].n).toBe(1);
    await db.exec("set role authenticated");
    await expect(db.query("select * from feature_interest")).rejects.toThrow(/permission/i);
    await db.exec("reset role");
  });
});

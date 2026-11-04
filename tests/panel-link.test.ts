import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The agency's fixed link to its panel (docs/ACCESO_PANEL.md): the link
// itself, where /i/<inmobiliaria>-<codigo> lands each kind of person, the
// account made from it and the exploration funnel.

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; email_confirmed_at?: string; is_anonymous?: boolean },
  tables: {} as Record<string, Row[]>,
  inserts: [] as { table: string; row: Row }[],
  cookies: new Map<string, string>(),
  members: {} as Record<string, { agency: { id: string; name: string } }>,
  support: [] as { actor: string; agency: string; mode: string }[],
  fail: {} as Record<string, { code?: string; message?: string }>,
}));

function fakeDb() {
  return {
    from(table: string) {
      let rows = [...(state.tables[table] ?? [])];
      let op = "select";
      let patch: Row | null = null;
      const error = () => state.fail[`${table}:${op}`] ?? null;
      const done = () => {
        if (!error() && patch) for (const r of rows) Object.assign(r, patch);
        patch = null;
      };
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
        insert: (row: Row) => {
          op = "insert";
          if (!error()) {
            state.inserts.push({ table, row });
            (state.tables[table] ??= []).push({ ...row });
          }
          return q;
        },
        update: (row: Row) => ((op = "update"), (patch = row), q),
        maybeSingle: async () => (done(), error() ? { data: null, error: error() } : { data: rows[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve((done(), error() ? { data: null, error: error() } : { data: rows, error: null })).then(ok, fail),
      };
      return q;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  NextResponse: { redirect: (url: URL) => new Response(null, { status: 307, headers: { location: url.toString() } }) },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (state.cookies.has(k) ? { value: state.cookies.get(k) } : undefined),
    set: (k: string, v: string) => void state.cookies.set(k, v),
    delete: (k: string) => void state.cookies.delete(k),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ adminClient: () => fakeDb(), currentUser: async () => state.user }));
vi.mock("@/lib/supabase/config", () => ({ cloudEnabled: () => true, cloudConfigured: () => true }));
vi.mock("@/lib/agency/server", () => ({ membershipOf: async (id: string) => state.members[id] ?? null }));
vi.mock("@/lib/agency/support", () => ({
  startSupport: async (actor: string, agency: string, mode: string) => void state.support.push({ actor, agency, mode }),
}));
vi.mock("@/lib/commerce/http", async (original) => {
  const real = await original<typeof import("../src/lib/commerce/http")>();
  return { ...real, isAdmin: (email?: string | null) => email === "equipo@habita.test" };
});

import { panelLinkPath, redactInvite, shortLinkCode } from "@/lib/agency/demo-invite";
import { entryChoiceKey, explorationClick } from "@/lib/agency/exploration";
import { agencyPanelLink } from "@/lib/agency/panel-link";
import { claimCodeFromVisit, liveVisit } from "@/lib/agency/visit";
import { VISIT_COOKIE } from "@/lib/agency/visit-token";
import * as fixedLink from "../src/app/i/[link]/route";

const AGENCY = "11111111-1111-4111-8111-111111111111";
const TEAM = "22222222-2222-4222-8222-222222222222";
const CODE = "k7m2p9qrst";
const russillo = (owner: string | null = null) => ({ id: AGENCY, name: "Russillo Propiedades", website: null, slug: null, owner_id: owner, site_published: false });
const open = async (link = `russillo-propiedades-${CODE}`) => {
  const res = await fixedLink.GET(new Request(`https://habita.test/i/${link}`), { params: Promise.resolve({ link }) });
  return { status: res.status, location: new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search };
};

beforeEach(() => {
  process.env.SUPABASE_SECRET_KEY = "clave-de-prueba";
  state.user = null;
  state.inserts = [];
  state.cookies = new Map();
  state.members = {};
  state.support = [];
  state.fail = {};
  state.tables = {
    agencies: [{ ...russillo() }],
    agency_panel_links: [{ agency_id: AGENCY, code: CODE, created_by: TEAM, agencies: russillo() }],
  };
});

describe("the fixed link itself", () => {
  it("names the agency, keeps the code readable for the server and hides it from analytics", () => {
    const path = panelLinkPath("Russillo Propiedades", CODE);
    expect(path).toBe(`/i/russillo-propiedades-${CODE}`);
    expect(shortLinkCode(path.split("/")[2])).toBe(CODE);
    expect(redactInvite(`https://habita.test${path}?enlace=invitado`)).toBe("https://habita.test/i/russillo-propiedades-[oculto]?enlace=invitado");
  });

  it("is created once and copied again the same; changing it replaces it", async () => {
    state.tables.agency_panel_links = [];
    const first = await agencyPanelLink(AGENCY, TEAM, "https://habita.test");
    const again = await agencyPanelLink(AGENCY, TEAM, "https://habita.test");
    expect(again.url).toBe(first.url);
    expect(first.url).toMatch(/^https:\/\/habita\.test\/i\/russillo-propiedades-[2-9a-hjkmnp-z]{10}$/);
    const rotated = await agencyPanelLink(AGENCY, TEAM, "https://habita.test", true);
    expect(rotated.url).not.toBe(first.url);
    expect(state.inserts.filter((i) => i.table === "admin_audit").map((i) => i.row.action)).toEqual(["agency_panel_link", "agency_panel_link_rotate"]);
  });

  it("asks for its migration instead of failing silently", async () => {
    state.fail["agency_panel_links:select"] = { code: "PGRST205", message: "Could not find the table 'public.agency_panel_links'" };
    await expect(agencyPanelLink(AGENCY, TEAM, "https://habita.test")).rejects.toMatchObject({ status: 409 });
    expect(await liveVisit(CODE)).toBeNull();
  });
});

describe("where /i/<inmobiliaria>-<codigo> lands", () => {
  it("a guest: the home of that agency's panel, with the visit started", async () => {
    expect(await open()).toEqual({ status: 307, location: "/panel?enlace=invitado" });
    expect(state.cookies.get(VISIT_COOKIE)).toMatch(new RegExp(`^${CODE}\\.\\d+\\.[0-9a-f]{64}$`));
  });

  it("the agency's own member: its panel, nothing else", async () => {
    state.user = { id: "u1", email: "duenia@russillo.test", email_confirmed_at: "2026-11-01" };
    state.members.u1 = { agency: { id: AGENCY, name: "Russillo Propiedades" } };
    expect(await open()).toEqual({ status: 307, location: "/panel?enlace=miembro" });
    expect(state.cookies.has(VISIT_COOKIE)).toBe(false);
  });

  it("a signed-in account outside any agency: the same visit (it may take the agency over)", async () => {
    state.user = { id: "u2", email: "laura@gmail.test", email_confirmed_at: "2026-11-01" };
    expect(await open()).toEqual({ status: 307, location: "/panel?enlace=sesion" });
    expect(state.cookies.has(VISIT_COOKIE)).toBe(true);
  });

  it("a member of another agency keeps its own panel", async () => {
    state.user = { id: "u3", email: "otra@inmo.test", email_confirmed_at: "2026-11-01" };
    state.members.u3 = { agency: { id: "otra", name: "Otra" } };
    expect(await open()).toEqual({ status: 307, location: "/panel?enlace=otra" });
    expect(state.cookies.has(VISIT_COOKIE)).toBe(false);
  });

  it("the team: that panel in its support view, never /admin", async () => {
    state.user = { id: TEAM, email: "equipo@habita.test", email_confirmed_at: "2026-11-01" };
    expect(await open()).toEqual({ status: 307, location: "/panel?enlace=equipo" });
    expect(state.support).toEqual([{ actor: TEAM, agency: AGENCY, mode: "view" }]);
  });

  it("a changed, unknown or malformed link: a short notice, never the sign-up", async () => {
    expect((await open("russillo-propiedades-zzzzzzzzzz")).location).toBe("/i/inactivo");
    expect((await open("cualquier-cosa")).location).toBe("/i/inactivo");
    expect(state.cookies.has(VISIT_COOKIE)).toBe(false);
  });
});

describe("the account made from the link", () => {
  it("an agency without owner gets a fresh two-day invitation on behalf of the team member who made the link", async () => {
    const visit = (await liveVisit(CODE))!;
    expect(visit).toMatchObject({ source: "link", claimed: false, demoToken: null });
    const code = await claimCodeFromVisit({ ...visit, code: CODE });
    const claim = state.inserts.find((i) => i.table === "agency_claims")!.row;
    expect(claim).toMatchObject({ agency_id: AGENCY, created_by: TEAM, code_hash: createHash("sha256").update(code).digest("hex") });
    expect(new Date(claim.expires_at as string).getTime() - Date.now()).toBeGreaterThan(47 * 3600 * 1000);
  });

  it("an agency that already has its owner: no invitation, only signing in", async () => {
    state.tables.agency_panel_links[0].agencies = russillo("duenia");
    const visit = (await liveVisit(CODE))!;
    expect(visit.claimed).toBe(true);
    await expect(claimCodeFromVisit({ ...visit, code: CODE })).rejects.toMatchObject({ status: 409 });
    expect(state.inserts).toEqual([]);
  });
});

describe("the exploration funnel", () => {
  it("records sections and properties opened, not the section it is already on", () => {
    expect(explorationClick("/panel/imagenes", "/panel", "sidebar")).toEqual({
      event: "panel_exploration_section_clicked",
      properties: { section: "imagenes", origen: "sidebar" },
    });
    expect(explorationClick("/panel/propiedades/abc?pestana=fotos", "/panel", "contenido")).toEqual({
      event: "panel_exploration_property_opened",
      properties: { origen: "contenido", vista: "editor" },
    });
    expect(explorationClick("/panel/propiedades/abc/vista-previa", "/panel", "contenido")?.properties.vista).toBe("vista_previa");
    expect(explorationClick("/panel", "/panel", "sidebar")).toBeNull();
    expect(explorationClick("/panel/empezar?codigo=x", "/panel", "contenido")).toBeNull();
    expect(explorationClick("https://otro.test/panel/imagenes", "/panel", "contenido")).toBeNull();
  });

  it("remembers the welcome's choice per agency, and once more after signing in", () => {
    expect(entryChoiceKey(AGENCY)).not.toBe(entryChoiceKey("otra"));
    expect(entryChoiceKey(AGENCY, true)).not.toBe(entryChoiceKey(AGENCY));
  });
});

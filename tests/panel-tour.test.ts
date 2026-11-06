// The panel's welcome tour: its steps for each role and feature, who it starts
// by itself for, and /api/panel/recorrido (eligibility and saving it as seen).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));

const db = vi.hoisted(() => ({
  user: { id: "00000000-0000-4000-8000-000000000001", email: "ana@inmo.com" } as Record<string, unknown> | null,
  membership: { role: "owner", agency: { id: "a1", name: "Inmo Sur" }, scope: null } as Record<string, unknown> | null,
  profile: { panel_tour_seen_at: null } as Record<string, unknown> | null,
  member: { created_at: new Date().toISOString() } as Record<string, unknown> | null,
  profileError: null as unknown,
  upserts: [] as Record<string, unknown>[],
  upsertError: null as unknown,
}));
vi.mock("@/lib/commerce/http", async (orig) => {
  const real = await orig<typeof import("../src/lib/commerce/http")>();
  return {
    ...real,
    requireUser: async () => {
      if (!db.user) throw new real.HttpError(401, "Ingresá a tu cuenta.");
      return db.user;
    },
  };
});
vi.mock("@/lib/agency/server", () => ({ membershipFor: async () => db.membership }));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: (table: string) => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () =>
          table === "profiles" ? { data: db.profile, error: db.profileError } : { data: db.member, error: null },
        upsert: async (row: Record<string, unknown>) => {
          db.upserts.push(row);
          return { error: db.upsertError };
        },
      };
      return b;
    },
  }),
}));

import { NEW_MEMBER_DAYS, TOUR_VERSION, tourEligible } from "@/lib/agency/panel-tour";
import { tourSteps } from "@/components/panel-tour";
import { GET, POST } from "@/app/api/panel/recorrido/route";
import type { PanelProperty } from "@/lib/agency/shared";

const DAY = 24 * 60 * 60 * 1000;
const prop = { id: "p1", title: "Depto", origin: "admin" } as PanelProperty;

describe("the tour's steps", () => {
  it("are the seven of the reference for an owner with demos and video", () => {
    const steps = tourSteps({ role: "owner", properties: [prop], credits: 7 }, true, true);
    expect(steps.map((s) => s.id)).toEqual(["welcome", "demo", "start", "studio", "video", "demos", "credits"]);
    expect(steps.map((s) => s.title)).toEqual([
      "¡Bienvenido a Habita!",
      "Tu herramienta principal",
      "Empezar es muy fácil",
      "Mejorá tus fotografías",
      "También podés crear videos",
      "Todo queda organizado",
      "Pagás solo cuando lo necesitás",
    ]);
    expect(steps.find((s) => s.id === "start")?.picker).toBe(true);
    expect(steps.find((s) => s.id === "demos")?.targets).toEqual(['[data-tour="recents"]']);
  });

  it("never mention the cinematic video mode, still unfinished", () => {
    const text = tourSteps({ role: "owner", properties: [], credits: 0 }, true, true)
      .map((s) => `${s.title} ${s.text}`)
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/cinemat/);
  });

  it("leave video out where it is not enabled", () => {
    expect(tourSteps({ role: "owner", properties: [prop], credits: 1 }, true, false).map((s) => s.id)).not.toContain("video");
  });

  it("point to «Mis demostraciones» in the menu without demos", () => {
    const demos = tourSteps({ role: "owner", properties: [], credits: 1 }, true, true).find((s) => s.id === "demos")!;
    expect(demos.targets).toEqual(['[data-tour="nav-propiedades"]']);
    expect(demos.menu).toBe(true);
  });

  it("show no tools to who cannot create, and no buying to who cannot buy", () => {
    const steps = tourSteps({ role: "viewer", properties: [prop], credits: 3 }, false, true);
    expect(steps.map((s) => s.id)).toEqual(["welcome", "demos", "credits"]);
    expect(steps.at(-1)!.text).toMatch(/cuenta dueña/);
    expect(tourSteps({ role: "owner", properties: [prop], credits: 3, support: true }, true, true).at(-1)!.text).toMatch(/cuenta dueña/);
  });
});

describe("who the tour starts by itself for", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  it("a recent member that has not seen it", () => {
    expect(tourEligible({ seenAt: null, joinedAt: new Date(now - 2 * DAY).toISOString(), now })).toBe(true);
  });
  it("not who saw it, joined long ago, or is the team's support view", () => {
    expect(tourEligible({ seenAt: "2026-11-01T00:00:00Z", joinedAt: new Date(now - DAY).toISOString(), now })).toBe(false);
    expect(tourEligible({ seenAt: null, joinedAt: new Date(now - (NEW_MEMBER_DAYS + 1) * DAY).toISOString(), now })).toBe(false);
    expect(tourEligible({ seenAt: null, joinedAt: new Date(now - DAY).toISOString(), support: true, now })).toBe(false);
    expect(tourEligible({ seenAt: null, joinedAt: null, now })).toBe(false);
    expect(tourEligible({ seenAt: null, joinedAt: "no es una fecha", now })).toBe(false);
  });
});

describe("/api/panel/recorrido", () => {
  beforeEach(() => {
    db.user = { id: "00000000-0000-4000-8000-000000000001", email: "ana@inmo.com" };
    db.membership = { role: "owner", agency: { id: "a1", name: "Inmo Sur" }, scope: null };
    db.profile = { panel_tour_seen_at: null };
    db.member = { created_at: new Date().toISOString() };
    db.profileError = null;
    db.upsertError = null;
    db.upserts.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  const eligible = async () => ((await (await GET()).json()) as { eligible: boolean }).eligible;

  it("says yes to a new member that has not seen it", async () => {
    expect(await eligible()).toBe(true);
  });

  it("says no without an account, in a support view or a visit, once seen, or if it cannot read (no migration)", async () => {
    db.user = null;
    expect(await eligible()).toBe(false);
    db.user = { id: "u" };
    db.membership = { role: "owner", agency: { id: "a1" }, scope: null, support: true };
    expect(await eligible()).toBe(false);
    db.membership = { role: "owner", agency: { id: "a1" }, scope: null, visitor: true };
    expect(await eligible()).toBe(false);
    db.membership = { role: "owner", agency: { id: "a1" }, scope: null };
    db.profile = { panel_tour_seen_at: "2026-11-01T00:00:00Z" };
    expect(await eligible()).toBe(false);
    db.profile = null;
    db.profileError = { message: "column profiles.panel_tour_seen_at does not exist" };
    expect(await eligible()).toBe(false);
  });

  it("saves it as seen for the account, never from the team's support view", async () => {
    const res = await POST(new Request("http://localhost/api/panel/recorrido", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0]).toMatchObject({ id: db.user!.id, panel_tour_version: TOUR_VERSION });
    expect(typeof db.upserts[0].panel_tour_seen_at).toBe("string");
    db.membership = { role: "owner", agency: { id: "a1" }, scope: null, support: true };
    expect(await (await POST(new Request("http://localhost/api/panel/recorrido", { method: "POST" }))).json()).toMatchObject({ saved: false });
    expect(db.upserts).toHaveLength(1);
  });
});

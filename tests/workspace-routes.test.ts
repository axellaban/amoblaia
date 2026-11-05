import { beforeEach, describe, expect, it, vi } from "vitest";

// Equipo y accesos: the routes decide with the role read from the database
// (never the browser's), and send the database the agency of the session,
// never one taken from the request.
type Row = Record<string, unknown>;
const OWNER = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000002";
const MEMBER = "00000000-0000-4000-8000-000000000003";
const OUTSIDER = "00000000-0000-4000-8000-000000000004";
const REQUEST = "00000000-0000-4000-8000-0000000000aa";
const TRANSFER = "00000000-0000-4000-8000-0000000000bb";
const AG = "00000000-0000-4000-8000-0000000000a1";
const OTHER_AG = "00000000-0000-4000-8000-0000000000a2";

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; email_confirmed_at?: string },
  tables: {} as Record<string, Record<string, unknown>[]>,
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  rpcError: null as null | string,
  demoAgency: null as null | string,
}));

function fakeDb() {
  return {
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id.slice(-2)}@sur.test` } }, error: null }) } },
    from(table: string) {
      let rows: Row[] = [...(state.tables[table] ?? [])];
      let count = false;
      const q = {
        select: (_f?: string, opts?: { count?: string }) => ((count = count || !!opts?.count), q),
        order: () => q,
        limit: () => q,
        insert: () => q,
        update: () => q,
        delete: () => q,
        eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
        neq: () => q,
        in: (k: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[k]))), q),
        is: (k: string, v: null) => ((rows = rows.filter((r) => (v === null ? r[k] == null : r[k] === v))), q),
        not: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        single: async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { code: "PGRST116" } }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null, count: count ? rows.length : null }).then(ok),
      };
      return q;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }));
vi.mock("@/lib/agency/visit", async (original) => ({
  ...(await original<typeof import("../src/lib/agency/visit")>()),
  visitorMembership: async () => null,
  currentVisit: async () => null,
}));
vi.mock("@/lib/supabase/server", () => ({ adminClient: () => fakeDb(), currentUser: async () => state.user, userClient: async () => ({}) }));
vi.mock("@/lib/demos/server", () => ({
  publishedDemo: async (token: string) => (state.demoAgency && token === "tok_demo1234567890" ? { id: "demo-1", agencyId: state.demoAgency, title: "Casa" } : null),
  demoRow: async () => {
    throw new Error("unused");
  },
}));
vi.mock("@/lib/commerce/mercadopago", () => ({ billingConfigured: () => true, mp: vi.fn() }));
vi.mock("@/lib/commerce/http", async (original) => {
  const real = await original<typeof import("../src/lib/commerce/http")>();
  return {
    ...real,
    requireUser: async (request?: Request) => {
      if (request && request.headers.get("origin") !== new URL(request.url).origin) throw new real.HttpError(403, "Origen inválido.");
      if (!state.user) throw new real.HttpError(401, "Ingresá a tu cuenta y verificá tu email.");
      return state.user;
    },
    requireAdmin: async () => {
      if (state.user?.email !== "equipo@habita.test") throw new real.HttpError(403, "Acceso reservado al equipo.");
      return state.user;
    },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      state.rpcs.push({ name, args });
      if (state.rpcError) throw new Error(state.rpcError);
      if (name === "amobla_account") return { blocked: false, credits: 8 };
      if (name === "habita_request_access") return { id: REQUEST, created: true, createdAt: "2026-11-05T12:00:00Z" };
      if (name === "habita_request_admin_transfer") return { id: TRANSFER, created: true, createdAt: "2026-11-05T12:00:00Z" };
      if (name === "habita_resolve_access_request") return args.p_approve ? "approved" : "rejected";
      if (name === "habita_resolve_admin_transfer") return args.p_approve ? "approved" : "rejected";
      return null;
    },
  };
});

import * as equipo from "../src/app/api/panel/equipo/route";
import * as solicitud from "../src/app/api/panel/equipo/solicitudes/[id]/route";
import * as administracion from "../src/app/api/panel/equipo/administracion/route";
import * as transferencia from "../src/app/api/panel/equipo/administracion/[id]/route";
import * as acceso from "../src/app/api/panel/acceso/route";
import * as usuarios from "../src/app/api/panel/usuarios/route";
import * as usuario from "../src/app/api/panel/usuarios/[id]/route";
import * as checkout from "../src/app/api/checkout/route";

const ORIGIN = "https://habita.test";
const req = (path: string, method = "GET", body?: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (id: string) => (state.user = { id, email: `${id.slice(-2)}@sur.test`, email_confirmed_at: "2026-11-01T00:00:00Z" });
const agency = (id: string, owner: string) => ({ id, name: "Frejo Gustavo", website: null, slug: "frejo", owner_id: owner, site_published: false });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pk");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sk");
  vi.stubEnv("SAAS_ENABLED", "true");
  vi.stubEnv("APP_URL", ORIGIN);
  vi.stubEnv("MERCADOPAGO_MODE", "production");
  state.user = null;
  state.rpcs = [];
  state.rpcError = null;
  state.demoAgency = null;
  const member = (user_id: string, role: string, agencyId = AG, owner = OWNER) => ({
    agency_id: agencyId,
    user_id,
    role,
    property_ids: null,
    display_name: null,
    created_at: "2026-11-01T00:00:00Z",
    agencies: agency(agencyId, owner),
  });
  state.tables = {
    agencies: [
      { id: AG, name: "Frejo Gustavo", owner_id: OWNER, principal_id: OWNER },
      { id: OTHER_AG, name: "Otra", owner_id: OUTSIDER, principal_id: OUTSIDER },
    ],
    agency_members: [member(OWNER, "owner"), member(ADMIN, "admin"), member(MEMBER, "editor"), member(OUTSIDER, "owner", OTHER_AG, OUTSIDER)],
    agency_invites: [],
    agency_access_requests: [{ id: REQUEST, agency_id: AG, user_id: "x", email: "pide@mail.test", source: "demo", status: "pending", created_at: "2026-11-05T00:00:00Z" }],
    agency_admin_transfers: [],
    demos: [],
  };
});

describe("Equipo y accesos: what each role sees", () => {
  it("a member sees the team and the principal, without invitations or requests", async () => {
    as(MEMBER);
    const r = await equipo.GET();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.canManage).toBe(false);
    expect(body.requests).toEqual([]);
    expect(body.invitations).toEqual([]);
    expect(body.administration.principal.id).toBe(OWNER);
    expect(body.administration.isPrincipal).toBe(false);
    expect(body.team.every((m: { kind: string }) => m.kind === "member")).toBe(true);
    expect(body.team.find((m: { id: string }) => m.id === OWNER).principal).toBe(true);
  });

  it("an administrator also gets the pending requests", async () => {
    as(ADMIN);
    const body = await (await equipo.GET()).json();
    expect(body.canManage).toBe(true);
    expect(body.requests).toHaveLength(1);
  });

  it("someone outside any agency gets nothing", async () => {
    as("00000000-0000-4000-8000-000000000099");
    expect((await equipo.GET()).status).toBe(404);
  });
});

describe("Permissions are enforced on the server", () => {
  it("a member cannot invite, change roles, nor answer requests", async () => {
    as(MEMBER);
    expect((await usuarios.POST(req("/api/panel/usuarios", "POST", { email: "b@sur.test", role: "editor" }))).status).toBe(403);
    expect((await usuario.PATCH(req(`/api/panel/usuarios/${ADMIN}`, "PATCH", { kind: "member", role: "editor" }), params(ADMIN))).status).toBe(403);
    expect((await solicitud.POST(req(`/api/panel/equipo/solicitudes/${REQUEST}`, "POST", { approve: true }), params(REQUEST))).status).toBe(403);
    expect(state.rpcs.filter((c) => c.name === "habita_resolve_access_request")).toHaveLength(0);
  });

  it("a member cannot buy credits: only the billing account does", async () => {
    as(MEMBER);
    const r = await checkout.POST(req("/api/checkout", "POST", { sku: "pack-10", key: "00000000-0000-4000-8000-00000000c0de" }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/cuenta de facturación/);
    // Not even an administrator other than the billing account.
    as(ADMIN);
    expect((await checkout.POST(req("/api/checkout", "POST", { sku: "pack-10", key: "00000000-0000-4000-8000-00000000c0de" }))).status).toBe(403);
  });

  it("an administrator answers requests of its own agency only: the agency comes from the session", async () => {
    as(ADMIN);
    const r = await solicitud.POST(req(`/api/panel/equipo/solicitudes/${REQUEST}`, "POST", { approve: true, agency: OTHER_AG }), params(REQUEST));
    expect(r.status).toBe(200);
    const call = state.rpcs.find((c) => c.name === "habita_resolve_access_request")!;
    expect(call.args).toMatchObject({ p_actor: ADMIN, p_agency: AG, p_request: REQUEST, p_approve: true });
  });

  it("the principal administrator cannot be removed nor demoted, and the billing account neither", async () => {
    state.tables.agencies[0].principal_id = ADMIN;
    as(OWNER);
    const patch = await usuario.PATCH(req(`/api/panel/usuarios/${ADMIN}`, "PATCH", { kind: "member", role: "editor" }), params(ADMIN));
    expect(patch.status).toBe(403);
    expect((await patch.json()).error).toMatch(/administrador principal/);
    const del = await usuario.DELETE(req(`/api/panel/usuarios/${ADMIN}?tipo=member`, "DELETE"), params(ADMIN));
    expect(del.status).toBe(403);
    as(ADMIN);
    const owner = await usuario.DELETE(req(`/api/panel/usuarios/${OWNER}?tipo=member`, "DELETE"), params(OWNER));
    expect(owner.status).toBe(403);
    expect((await owner.json()).error).toMatch(/facturación/);
  });

  it("an invalid request id is not even sent to the database", async () => {
    as(ADMIN);
    expect((await solicitud.POST(req("/api/panel/equipo/solicitudes/x", "POST", { approve: true }), params("x"))).status).toBe(404);
    expect(state.rpcs.filter((c) => c.name === "habita_resolve_access_request")).toHaveLength(0);
  });
});

describe("Administración principal", () => {
  it("a member asks for it; asking needs the same origin", async () => {
    as(MEMBER);
    const bad = new Request(`${ORIGIN}/api/panel/equipo/administracion`, { method: "POST", headers: { Origin: "https://evil.test" }, body: "{}" });
    expect((await administracion.POST(bad)).status).toBe(403);
    const r = await administracion.POST(req("/api/panel/equipo/administracion", "POST", { action: "request" }));
    expect(r.status).toBe(201);
    expect(state.rpcs.find((c) => c.name === "habita_request_admin_transfer")!.args).toEqual({ p_user: MEMBER, p_agency: AG });
  });

  it("approving asks for an explicit confirmation; the database decides who is the principal", async () => {
    as(OWNER);
    const unconfirmed = await transferencia.POST(req(`/api/panel/equipo/administracion/${TRANSFER}`, "POST", { approve: true }), params(TRANSFER));
    expect(unconfirmed.status).toBe(400);
    expect(state.rpcs.filter((c) => c.name === "habita_resolve_admin_transfer")).toHaveLength(0);
    const ok = await transferencia.POST(req(`/api/panel/equipo/administracion/${TRANSFER}`, "POST", { approve: true, confirm: true }), params(TRANSFER));
    expect(ok.status).toBe(200);
    expect(state.rpcs.find((c) => c.name === "habita_resolve_admin_transfer")!.args).toMatchObject({ p_actor: OWNER, p_agency: AG, p_support: false });
  });

  it("someone who is not the principal gets the database's refusal", async () => {
    as(ADMIN);
    state.rpcError = "NOT_PRINCIPAL";
    const r = await transferencia.POST(req(`/api/panel/equipo/administracion/${TRANSFER}`, "POST", { approve: true, confirm: true }), params(TRANSFER));
    expect(r.status).toBe(403);
  });
});

describe("Solicitar acceso (Journey C)", () => {
  it("asks for the demo's agency; nothing is granted", async () => {
    state.demoAgency = AG;
    as("00000000-0000-4000-8000-000000000099");
    const r = await acceso.POST(req("/api/panel/acceso", "POST", { demo: "tok_demo1234567890" }));
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ created: true, agency: "Frejo Gustavo", toTeam: false });
    expect(state.rpcs.find((c) => c.name === "habita_request_access")!.args).toMatchObject({ p_agency: AG, p_source: "demo" });
    expect(state.rpcs.some((c) => c.name.startsWith("habita_join") || c.name.startsWith("habita_claim"))).toBe(false);
  });

  it("a member of that agency is told so; signed out, it must sign in", async () => {
    state.demoAgency = AG;
    as(MEMBER);
    expect(await (await acceso.POST(req("/api/panel/acceso", "POST", { demo: "tok_demo1234567890" }))).json()).toEqual({ member: true });
    state.user = null;
    expect((await acceso.POST(req("/api/panel/acceso", "POST", { demo: "tok_demo1234567890" }))).status).toBe(401);
  });

  it("an unknown demo names no agency", async () => {
    as("00000000-0000-4000-8000-000000000099");
    expect((await acceso.POST(req("/api/panel/acceso", "POST", { demo: "tok_unknown" }))).status).toBe(404);
  });
});

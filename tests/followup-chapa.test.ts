import { beforeEach, describe, expect, it, vi } from "vitest";

// Follow-up desde Chapa Labs por /api/prospeccion: clave, quién opera (el usuario del equipo con
// ese nombre) y que cada operación llama a la misma función que la ruta del agente.
const FACU = "00000000-0000-4000-8000-0000000000f1";
const FACU_ID = vi.hoisted(() => "00000000-0000-4000-8000-0000000000f1");
const AXEL = "00000000-0000-4000-8000-0000000000f2";
const AG = "00000000-0000-4000-8000-0000000000b1";
const calls = vi.hoisted(() => [] as { fn: string; args: unknown[] }[]);
const board = vi.hoisted(() => ({ claim: null as null | { actorId: string; by: string; until: string } }));
const snapshotReads = vi.hoisted(() => ({ count: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  currentUser: async () => null,
  userClient: async () => ({}),
  adminClient: () => ({
    from: (table: string) => table === "followup_claims"
      ? { select: () => ({ eq: () => ({ gt: () => ({ maybeSingle: async () => ({
          data: board.claim ? { actor_id: board.claim.actorId, actor_name: board.claim.by, locked_until: board.claim.until } : null,
          error: null,
        }) }) }) }) }
      : { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ actor_id: FACU_ID, status: "sent", converted_at: "2026-11-05T12:00:00Z" }, { actor_id: FACU_ID, status: "sent", converted_at: null }], error: null }) }) }) },
    auth: {
      admin: {
        listUsers: async () => ({
          data: {
            users: [
              { id: FACU, email: "facu@example.test", user_metadata: { full_name: "Facundo Gregorini" } },
              { id: AXEL, email: "axel@example.test", user_metadata: {} },
              { id: "00000000-0000-4000-8000-0000000000f9", email: "otro@afuera.test", user_metadata: { name: "Axel" } },
            ],
          },
        }),
      },
    },
  }),
}));
vi.mock("@/lib/agency/external", () => ({}));
const fn = vi.hoisted(() => (name: string, out: unknown = { ok: name }) => async (...args: unknown[]) => (calls.push({ fn: name, args }), out));
vi.mock("@/lib/followup/server", () => ({
  followupOverview: async () => (snapshotReads.count++, {
    summary: { ready: 1 },
    queue: [{ agencyId: AG, name: "Inmo", action: "principal", dueAt: null, execution: null }],
    blocked: [],
    inbox: [],
    funnel: [],
    stages: [{ key: "no-contactado", title: "No contactado", goal: "Contactados", versions: [], queue: [{ agencyId: AG, action: "principal", dueAt: "2026-11-10T12:00:00Z", execution: null }] }],
    rules: [],
    changes: [],
    results: { versions: [] },
  }),
  agentQueue: async (...args: unknown[]) => (calls.push({ fn: "agentQueue", args }), { queue: [{ agencyId: AG, name: "Inmo", claim: board.claim }] }),
  claimNext: fn("claimNext"),
  openExecution: fn("openExecution"),
  confirmExecution: fn("confirmExecution"),
  failExecution: fn("failExecution"),
  releaseClaim: fn("releaseClaim"),
  setSituation: fn("setSituation"),
  setStage: fn("setStage"),
  readScript: fn("readScript", { body: "SCRIPT ORIGINAL HABITA", updated_at: "2026-11-10T20:00:00Z" }),
  saveScript: fn("saveScript", { body: "SCRIPT EDITADO", updated_at: "2026-11-10T20:01:00Z" }),
  registerReply: fn("registerReply"),
  processReply: fn("processReply"),
  inbox: async () => [],
  snooze: fn("snooze"),
  unsnooze: fn("unsnooze"),
  setPriority: fn("setPriority"),
  createVersion: fn("createVersion"),
  updateVersion: fn("updateVersion"),
  setVersionStatus: fn("setVersionStatus"),
  saveRule: fn("saveRule"),
}));
import { GET, POST } from "../src/app/api/prospeccion/route";
import { invalidateFollowupSnapshot, operatorFor } from "../src/lib/followup/chapa";

const SECRET = "m".repeat(40);
const req = (method: string, path: string, body?: unknown, auth = `Bearer ${SECRET}`) =>
  new Request(`https://habita.test/api/prospeccion${path}`, { method, headers: { "content-type": "application/json", authorization: auth }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("SAAS_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public");
  vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
  vi.stubEnv("ADMIN_EMAILS", "facu@example.test,axel@example.test");
  vi.stubEnv("METRICS_SECRET", SECRET);
  vi.stubEnv("PROSPECTING_ACTOR_ID", FACU);
  calls.length = 0;
  board.claim = null;
  snapshotReads.count = 0;
  invalidateFollowupSnapshot();
});

describe("Follow-up para Chapa", () => {
  it("quien opera es el usuario del equipo con ese nombre; si no hay, el de la API con su nombre", () => {
    const team = [
      { id: FACU, email: "facu@example.test", user_metadata: { full_name: "Facundo Gregorini" } },
      { id: AXEL, email: "axel.laban@example.test", user_metadata: {} },
    ];
    expect(operatorFor("Facundo", team, "x")).toEqual({ id: FACU, name: "Facundo" });
    expect(operatorFor("axel", team, "x")).toEqual({ id: AXEL, name: "Axel" });
    expect(operatorFor("Ana", team, "x")).toEqual({ id: "x", name: "Ana" });
    expect(operatorFor("", team, "x")).toEqual({ id: "x", name: "Chapa Labs" });
  });

  it("sin la clave no responde", async () => {
    expect((await GET(req("GET", "?vista=followup", undefined, "Bearer otra"))).status).toBe(401);
    expect((await POST(req("POST", "", { followup: { op: "queue" } }, ""))).status).toBe(401);
  });

  it("Chapa lee y actualiza el mismo Script original de HABITA",async()=>{
    const read=await GET(req("GET","?vista=script"));
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({body:"SCRIPT ORIGINAL HABITA"});
    const changed=await POST(req("POST","",{by:"Facundo",followup:{op:"script-save",body:"SCRIPT EDITADO"}}));
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({body:"SCRIPT EDITADO"});
    expect(calls.find(x=>x.fn==="saveScript")?.args).toEqual(["SCRIPT EDITADO",FACU]);
  });

  it("GET ?vista=followup devuelve la cola, las programadas y el resto del tablero", async () => {
    const res = await GET(req("GET", "?vista=followup"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queue).toHaveLength(1);
    expect(body.scheduled).toHaveLength(1);
    expect(body.stages[0]).toMatchObject({ key: "no-contactado", waiting: 1 });
    expect(Object.keys(body)).toEqual(expect.arrayContaining(["summary", "blocked", "inbox", "funnel", "rules", "results", "labels"]));
    expect(body.labels.situations.interesado).toBe("Interesado");
    expect(body.results.byActor).toEqual([{ actor: "Facundo", executions: 2, conversions: 1, rate: 0.5 }]);
  });

  it("cachea lecturas repetidas pero invalida luego de una acción real", async () => {
    const url = "?vista=followup";
    expect((await GET(req("GET", url))).status).toBe(200);
    expect((await GET(req("GET", url))).status).toBe(200);
    expect(snapshotReads.count).toBe(1);
    await POST(req("POST", "", { by: "Facundo", followup: { op: "situation", inmobiliaria: AG, situacion: "neutro" } }));
    expect((await GET(req("GET", url))).status).toBe(200);
    expect(snapshotReads.count).toBe(2);
  });

  it("cada operación va a la misma función que la ruta del agente, a nombre de quien opera", async () => {
    const task = { inmobiliaria: AG, etapa: "no-contactado", tarea: "principal", version: "v1" };
    await POST(req("POST", "", { by: "Axel", followup: { op: "claim", inmobiliaria: AG } }));
    await POST(req("POST", "", { by: "Axel", followup: { op: "confirm", ...task, texto: "hola" } }));
    await POST(req("POST", "", { by: "Axel", followup: { op: "fail", ...task, motivo: "No tiene WhatsApp", tipo: "sin_whatsapp" } }));
    await POST(req("POST", "", { by: "Axel", followup: { op: "snooze", inmobiliaria: AG, hasta: "2026-11-20T12:00:00Z", motivo: "vuelve el lunes" } }));
    await POST(req("POST", "", { by: "Axel", followup: { op: "stage", inmobiliaria: AG, etapa: "no-responde" } }));
    const done = calls.filter((c) => c.fn !== "agentQueue");
    expect(done.map((c) => c.fn)).toEqual(["claimNext", "confirmExecution", "failExecution", "snooze", "setStage"]);
    expect(done[0].args).toEqual([{ agencyId: AG }, "https://habita.test", { id: AXEL, name: "Axel" }]);
    expect(done[1].args).toEqual([{ agencyId: AG, stage: "no-contactado", action: "principal", versionId: "v1", text: "hola" }, { id: AXEL, name: "Axel" }, { includeItem: false }]);
    expect(done[2].args[0]).toMatchObject({ reason: "No tiene WhatsApp", kind: "sin_whatsapp" });
    expect(done[4].args).toEqual([AG, "no-responde", AXEL, "Axel"]);
  });

  it("dos personas con el usuario por defecto: el claim de una frena a la otra", async () => {
    board.claim = { actorId: FACU, by: "Ana", until: new Date(Date.now() + 60_000).toISOString() };
    const res = await POST(req("POST", "", { by: "Beto", followup: { op: "confirm", inmobiliaria: AG, etapa: "x", tarea: "principal", version: "v1" } }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Ana");
    expect(calls.some((c) => c.fn === "confirmExecution")).toBe(false);
  });

  it("una operación desconocida es un 400", async () => {
    const res = await POST(req("POST", "", { followup: { op: "borrar-todo" } }));
    expect(res.status).toBe(400);
  });
});

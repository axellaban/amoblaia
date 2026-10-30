import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/commerce/http", async (actual) => ({
  ...(await actual<typeof import("@/lib/commerce/http")>()),
  requireUser: async () => ({ id: "u1", email: "a@b.c" }),
}));
vi.mock("@/lib/agency/server", () => ({ membershipFor: async () => null }));
vi.mock("@/lib/agency/panel", () => ({ agencyCredits: async () => null }));
vi.mock("@/lib/agency/invitation", () => ({ invitationOf: async () => null }));
vi.mock("@/lib/demos/server", () => ({ publishedDemo: async () => null }));

const { POST } = await import("@/app/api/asistente/route");

const ORIGIN = "https://habita.test";
const question = (n: number) =>
  new Request(`${ORIGIN}/api/asistente`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: `pregunta ${n}` }], place: { kind: "panel" }, path: "/panel" }),
  });
const sse = (...deltas: string[]) =>
  new Response(deltas.map((d) => `event: x\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: d })}\n\n`).join("") + "data: [DONE]\n\n", {
    status: 200,
  });

let calls: { model: string }[] = [];
let n = 0;
beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/asistente", () => {
  it("streams only the answer's text", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return sse("¡Hola", "! Soy Miguel Ángel.");
    });
    const res = await POST(question(n++));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("¡Hola! Soy Miguel Ángel.");
    expect(calls[0].model).toBe("gpt-5-mini");
  });

  it("tries a widely available model when the account cannot use the first", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      return body.model === "gpt-5-mini"
        ? Response.json({ error: { code: "model_not_found", message: "no access" } }, { status: 404 })
        : sse("Listo.");
    });
    const res = await POST(question(n++));
    expect(await res.text()).toBe("Listo.");
    expect(calls.map((c) => c.model)).toEqual(["gpt-5-mini", "gpt-4.1-mini"]);
  });

  it("says why when OpenAI refuses, as JSON a gateway keeps", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: { code: "invalid_api_key" } }, { status: 401 }));
    const res = await POST(question(n++));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("clave de OpenAI");
  });
});

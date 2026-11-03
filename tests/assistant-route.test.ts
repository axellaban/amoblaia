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
const logged: { owner: string; question: string; answer: string | null; error: string | null; model: string | null }[] = [];
vi.mock("@/lib/assistant/log", () => ({
  logExchange: async (who: { owner: string }, e: { question: string; answer: string | null; error: string | null; model: string | null }) => {
    logged.push({ owner: who.owner, question: e.question, answer: e.answer, error: e.error, model: e.model });
    return "c1";
  },
}));

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
  logged.length = 0;
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
    expect(calls[0].model).toBe("gpt-4.1-mini");
    // The exchange is saved for the team before the answer closes.
    expect(logged).toEqual([{ owner: "user:u1", question: expect.stringMatching(/^pregunta/), answer: "¡Hola! Soy Miguel Ángel.", error: null, model: "gpt-4.1-mini" }]);
  });

  it("keeps reading when OpenAI's first pieces carry no text, as its real stream does", async () => {
    const pieces = [
      `event: response.created\ndata: ${JSON.stringify({ type: "response.created" })}\n\n`,
      `event: response.in_progress\ndata: ${JSON.stringify({ type: "response.in_progress" })}\n\n`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hola" })}\n\n`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: ", ¿qué tal?" })}\n\n`,
      `data: ${JSON.stringify({ type: "response.completed" })}\n\n`,
    ];
    vi.stubGlobal("fetch", async () => {
      const encoder = new TextEncoder();
      let i = 0;
      return new Response(
        new ReadableStream({
          pull(c) {
            if (i < pieces.length) c.enqueue(encoder.encode(pieces[i++]));
            else c.close();
          },
        }),
        { status: 200 },
      );
    });
    const res = await POST(question(n++));
    const text = await Promise.race([res.text(), new Promise((r) => setTimeout(() => r("TRABADO"), 2000))]);
    expect(text).toBe("Hola, ¿qué tal?");
  });

  it("tries a widely available model when the account cannot use the first", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      return body.model === "gpt-4.1-mini"
        ? Response.json({ error: { code: "model_not_found", message: "no access" } }, { status: 404 })
        : sse("Listo.");
    });
    const res = await POST(question(n++));
    expect(await res.text()).toBe("Listo.");
    expect(calls.map((c) => c.model)).toEqual(["gpt-4.1-mini", "gpt-4o-mini"]);
  });

  it("says why when OpenAI refuses, as JSON a gateway keeps", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: { code: "invalid_api_key" } }, { status: 401 }));
    const res = await POST(question(n++));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("clave de OpenAI");
    expect(logged[0]).toMatchObject({ answer: null, error: expect.stringContaining("clave de OpenAI") });
  });
});

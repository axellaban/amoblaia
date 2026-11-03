import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ConversationRow } from "@/lib/assistant/admin";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("@/lib/demos/admin-page", () => ({ requireAdminPage: async () => ({ id: "admin" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

const row: ConversationRow = {
  id: "11111111-1111-4111-8111-111111111111",
  place: "demo",
  user_email: null,
  agency_id: "22222222-2222-4222-8222-222222222222",
  agency_name: "Inmobiliaria Sur",
  demo_id: "33333333-3333-4333-8333-333333333333",
  demo_title: "Casa en el lago",
  support: false,
  path: "/demo/tok",
  questions: 2,
  failures: 1,
  last_question: "¿Cómo guardo mi panel?",
  created_at: "2026-10-30T15:00:00Z",
  updated_at: "2026-10-30T15:05:00Z",
};
vi.mock("@/lib/assistant/admin", async (actual) => ({
  ...(await actual<typeof import("@/lib/assistant/admin")>()),
  conversations: async () => ({ items: [row], total: 1, week: { conversations: 1, questions: 2, failures: 1 } }),
  conversation: async () => ({
    conversation: row,
    messages: [
      { id: 1, role: "user", content: "¿Cuánto cuesta?", model: null, error: null, created_at: "2026-10-30T15:00:00Z" },
      { id: 2, role: "assistant", content: "Mirá los planes en [Precios](/precios).", model: "gpt-4.1-mini", error: null, created_at: "2026-10-30T15:00:05Z" },
      { id: 3, role: "user", content: "¿Cómo guardo mi panel?", model: null, error: null, created_at: "2026-10-30T15:05:00Z" },
      { id: 4, role: "assistant", content: "", model: null, error: "OpenAI 429", created_at: "2026-10-30T15:05:01Z" },
    ],
  }),
}));

const List = (await import("@/app/admin/asistente/page")).default;
const Detail = (await import("@/app/admin/asistente/[id]/page")).default;

describe("the team's history of Miguel Ángel", () => {
  it("lists each conversation with its agency, demo and last question", async () => {
    const html = renderToStaticMarkup(await List({ searchParams: Promise.resolve({}) }));
    for (const text of ["Conversaciones con Miguel Ángel", "Inmobiliaria Sur", "Casa en el lago", "¿Cómo guardo mi panel?", "1 sin respuesta", `/admin/asistente/${row.id}`])
      expect(html).toContain(text);
  });

  it("shows the whole conversation with links to the agency and the demo", async () => {
    const html = renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: row.id }) }));
    for (const text of [`/admin/inmobiliarias/${row.agency_id}`, `/admin/demos/${row.demo_id}`, "¿Cuánto cuesta?", '<a href="/precios">Precios</a>', "Sin respuesta: OpenAI 429", "gpt-4.1-mini"])
      expect(html).toContain(text);
  });
});

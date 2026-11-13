import { describe, expect, it, vi } from "vitest";

// La respuesta se registra con la hora en que la inmobiliaria escribió (la que lee la extensión), no con la del registro.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ currentUser: async () => null, userClient: async () => ({}), adminClient: () => ({}) }));
vi.mock("@/lib/agency/external", () => ({}));
vi.mock("@/lib/agency/commercial-server", () => ({}));
vi.mock("@/lib/agency/admin-edit", () => ({}));
vi.mock("@/lib/agency/panel-link", () => ({}));
vi.mock("@/lib/prospecting/server", () => ({}));
vi.mock("@/lib/prospecting/record-send", () => ({}));

import { replyTime } from "../src/lib/followup/server";

describe("Hora de la respuesta", () => {
  it("usa la hora del mensaje cuando la extensión la manda", () => {
    expect(replyTime("2026-11-12T13:30:00-03:00")).toBe("2026-11-12T16:30:00.000Z");
  });
  it("sin hora, la del registro", () => {
    const before = Date.now();
    const at = Date.parse(replyTime(undefined));
    expect(at).toBeGreaterThanOrEqual(before);
    expect(Date.parse(replyTime(""))).toBeGreaterThanOrEqual(before);
  });
  it("rechaza una hora inválida o futura", () => {
    expect(() => replyTime("ayer")).toThrow("Hora inválida.");
    expect(() => replyTime(new Date(Date.now() + 10 * 60_000).toISOString())).toThrow("Hora inválida.");
  });
});

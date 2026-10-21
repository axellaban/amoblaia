import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ message: "" }));
vi.mock("@/lib/supabase/server", () => ({
  currentUser: async () => null,
  adminClient: () => ({
    rpc: async () => ({
      data: null,
      error: { message: state.message, code: "P0001" },
    }),
  }),
}));
import { rpc } from "../src/lib/commerce/http";

it.each([
  ["USER_DAILY_LIMIT", 429, "Llegaste al máximo de diseños por hoy"],
  ["DAILY_LIMIT", 429, "Llegamos al cupo de generación de hoy"],
  ["USER_STORAGE_LIMIT", 409, "Tu cuenta llegó a su espacio máximo"],
  ["STORAGE_LIMIT", 503, "El almacenamiento está al límite"],
  ["GUEST_REQUIRED", 403, "Recargá la página"],
  ["NO_CREDITS", 402, "No te quedan fotos disponibles"],
])(
  "maps %s to its own message, not a shorter code it contains",
  async (code, status, text) => {
    state.message = code;
    await expect(rpc("any")).rejects.toMatchObject({
      status,
      message: expect.stringContaining(text),
    });
  },
);

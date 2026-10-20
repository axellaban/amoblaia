import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ email: "customer@example.com" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/commerce/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/commerce/http")>()),
  requireUser: async () => ({ id: "signed-in-user", email: state.email }),
}));
vi.mock("@/lib/commerce/mercadopago", () => ({
  billingConfigured: () => true,
  mp: vi.fn(),
}));
import { POST } from "../src/app/api/checkout/route";

beforeEach(() => {
  state.email = "customer@example.com";
  vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
  vi.stubEnv("APP_URL", "https://amobla.example");
  vi.stubEnv("MERCADOPAGO_MODE", "test");
});
afterEach(() => vi.unstubAllEnvs());
function invalidCheckout() {
  return new Request("https://amobla.example/api/checkout", {
    method: "POST",
    headers: {
      Origin: "https://amobla.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sku: "x", key: "invalid" }),
  });
}
describe("Sandbox checkout access", () => {
  it("blocks customers from a sandbox even when checkout is otherwise enabled", async () => {
    expect((await POST(invalidCheckout())).status).toBe(403);
  });
  it("allows the operator into normal checkout validation in test mode", async () => {
    state.email = "owner@example.com";
    expect((await POST(invalidCheckout())).status).toBe(400);
  });
  it("allows customers into normal checkout validation in production", async () => {
    vi.stubEnv("MERCADOPAGO_MODE", "production");
    expect((await POST(invalidCheckout())).status).toBe(400);
  });
});

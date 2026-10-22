import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(async () => ({ state: "pending" })),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/commerce/http", async (original) => ({
  ...(await original<typeof import("../src/lib/commerce/http")>()),
  requireUser: vi.fn(async (request: Request) => {
    const { HttpError } = await import("../src/lib/commerce/http");
    if (request.headers.get("Origin") !== "https://amobla.example")
      throw new HttpError(403, "Origen inválido.");
    return { id: "session-user" };
  }),
}));
vi.mock("@/lib/commerce/reconcile", () => ({
  reconcileCheckout: mocks.reconcile,
}));
import { POST } from "../src/app/api/billing/checkout-status/route";
afterEach(() => vi.clearAllMocks());
const order = "00000000-0000-4000-8000-000000000001";
const request = (body: object, origin = "https://amobla.example") =>
  new Request("https://amobla.example/api/billing/checkout-status", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
it("ignores return flags, user ids and provider ids supplied by the browser", async () => {
  const response = await POST(
    request({
      order,
      status: "approved",
      payment_id: 42,
      user_id: "victim",
      preapproval_id: "forged",
    }),
  );
  expect(await response.json()).toEqual({ state: "pending" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith(
    "session-user",
    order,
  );
});
it("rejects an invalid order without contacting the provider", async () => {
  expect((await POST(request({ order: "bad" }))).status).toBe(400);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it("rejects an off-site attempt", async () => {
  expect((await POST(request({ order }, "https://evil.example"))).status).toBe(
    403,
  );
  expect(mocks.reconcile).not.toHaveBeenCalled();
});

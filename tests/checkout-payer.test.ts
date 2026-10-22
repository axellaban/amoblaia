import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { verifyCheckoutPayer } from "../src/lib/commerce/mercadopago";

const merchant = { id: 123, email: "seller@example.com", site_id: "MLA", country_id: "AR" };
beforeEach(() => {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "private-test-token");
  vi.stubEnv("MERCADOPAGO_COLLECTOR_ID", "123");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(merchant)));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Read-only payer check before collecting a card", () => {
  it("accepts a different buyer without creating a payment or sending their email to Mercado Pago", async () => {
    await expect(verifyCheckoutPayer("buyer@example.com")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "https://api.mercadopago.com/users/me",
      expect.objectContaining({ method: "GET" }),
    );
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain("buyer@example.com");
  });
  it("detects the seller's email without guessing a country problem", async () => {
    await expect(verifyCheckoutPayer(" SELLER@EXAMPLE.COM ")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("cuenta compradora distinta"),
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([
    { id: 999 },
    { site_id: "MLB", country_id: "BR" },
    { country_id: "BR" },
  ])("identifies seller configuration mismatches rather than blaming the buyer: %s", async (patch) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...merchant, ...patch }));
    await expect(verifyCheckoutPayer("buyer@example.com")).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("configuración de Mercado Pago"),
    });
  });
  it("does not approve a payer when the merchant identity cannot be verified", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ code: "unauthorized" }, { status: 401 }));
    await expect(verifyCheckoutPayer("buyer@example.com")).rejects.toThrow("MERCADOPAGO_401");
  });
});

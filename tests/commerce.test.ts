import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
vi.mock("server-only", () => ({}));
import {
  billingStatus,
  moneyCents,
  validWebhookSignature,
  validatePayment,
  type Payment,
  type Order,
} from "../src/lib/commerce/mercadopago";
import { safeNext } from "../src/lib/commerce/redirect";
afterEach(() => vi.unstubAllEnvs());
describe("Payment boundary", () => {
  it("uses integer cents without accepting malformed amounts", () => {
    expect(moneyCents("19900.90")).toBe(1990090);
    expect(moneyCents(0.29)).toBe(29);
    for (const v of ["-1", "1e3", "1.001", "NaN"])
      expect(() => moneyCents(v)).toThrow();
  });
  it("authenticates the notification ID and rejects modified signatures", () => {
    const secret = "a-webhook-secret-that-is-only-for-tests",
      ts = "1704908010",
      requestId = "request-123",
      id = "ABCDEF123";
    const signature = createHmac("sha256", secret)
      .update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`)
      .digest("hex");
    const headers = new Headers({
      "x-signature": `ts=${ts},v1=${signature}`,
      "x-request-id": requestId,
    });
    expect(validWebhookSignature(headers, id, secret)).toBe(true);
    expect(validWebhookSignature(headers, "other-id", secret)).toBe(false);
    expect(validWebhookSignature(headers, id, "different-secret")).toBe(false);
    expect(validWebhookSignature(new Headers(), id, secret)).toBe(false);
  });
  it("checks seller, amount, currency, environment and order before granting anything", () => {
    vi.stubEnv("MERCADOPAGO_COLLECTOR_ID", "123");
    vi.stubEnv("MERCADOPAGO_MODE", "production");
    const order: Order = {
      id: "order-1",
      user_id: "user-1",
      provider_subscription_id: null,
      checkout_url: null,
      status: "checkout_ready",
      snapshot: {
        sku: "pack-10",
        name: "Pack",
        photos: 10,
        versions: 3,
        kind: "pack",
        price_cents: 10000,
        active: true,
      },
    };
    const payment: Payment = {
      id: 42,
      collector_id: 123,
      external_reference: "order-1",
      currency_id: "ARS",
      transaction_amount: 100,
      status: "approved",
      live_mode: true,
      date_approved: new Date().toISOString(),
      date_created: new Date().toISOString(),
    };
    expect(() => validatePayment(payment, order)).not.toThrow();
    for (const patch of [
      { collector_id: 999 },
      { transaction_amount: 1 },
      { currency_id: "USD" },
      { live_mode: false },
      { external_reference: "another-order" },
    ])
      expect(() => validatePayment({ ...payment, ...patch }, order)).toThrow();
  });
});
describe("Billing diagnostics", () => {
  const complete = {
    BILLING_ENABLED: "true",
    MERCADOPAGO_ACCESS_TOKEN: "provider-token-for-tests",
    MERCADOPAGO_COLLECTOR_ID: "123",
    MERCADOPAGO_NOTIFICATION_TOKEN: "notification-token-for-tests",
    APP_URL: "https://amobla.example",
    SELLER_NAME: "Seller",
    SELLER_CUIT: "20-00000000-0",
    SUPPORT_EMAIL: "soporte@amobla.example",
    MERCADOPAGO_MODE: "production",
  };
  it("is ready only when every requirement is present", () => {
    for (const [k, v] of Object.entries(complete)) vi.stubEnv(k, v);
    expect(billingStatus()).toEqual({
      ready: true,
      mode: "production",
      missing: [],
    });
  });
  it("names missing settings without exposing configured values", () => {
    for (const [k, v] of Object.entries(complete)) vi.stubEnv(k, v);
    vi.stubEnv("BILLING_ENABLED", "false");
    vi.stubEnv("SELLER_CUIT", "");
    vi.stubEnv("MERCADOPAGO_MODE", "");
    const status = billingStatus();
    expect(status).toEqual({
      ready: false,
      mode: "test",
      missing: ["BILLING_ENABLED", "SELLER_CUIT"],
    });
    expect(JSON.stringify(status)).not.toContain("provider-token-for-tests");
  });
});
describe("Safe auth redirects", () => {
  it("keeps return destinations on the application origin", () => {
    expect(safeNext("/precios?plan=standard")).toBe("/precios?plan=standard");
    for (const v of [
      "https://other.example",
      "//other.example",
      "/\\other.example",
      null,
    ])
      expect(safeNext(v)).toBe("/cuenta");
  });
});

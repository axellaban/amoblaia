import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  after: vi.fn(),
  processInbox: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({ from: () => ({ upsert: mocks.upsert }) }),
}));
vi.mock("@/lib/commerce/mercadopago", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/commerce/mercadopago")>()),
  processInbox: mocks.processInbox,
}));
import { POST } from "../src/app/api/webhooks/mercadopago/route";

const token = "notification-token-only-for-isolated-unit-tests";
const secret = "webhook-signature-only-for-isolated-unit-tests";
function notification({
  authenticated = false,
  signature,
  topic = "payment",
}: { authenticated?: boolean; signature?: string; topic?: string } = {}) {
  return new Request(
    `https://amobla.example/api/webhooks/mercadopago?data.id=123456&type=${topic}${authenticated ? `&token=${token}` : ""}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signature
          ? { "x-signature": signature, "x-request-id": "notification-42" }
          : {}),
      },
      body: JSON.stringify({ id: 42, type: topic, data: { id: "123456" } }),
    },
  );
}
beforeEach(() => {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "isolated-provider-token");
  vi.stubEnv("MERCADOPAGO_NOTIFICATION_TOKEN", token);
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", secret);
  mocks.upsert.mockReset().mockResolvedValue({ error: null });
  mocks.after.mockReset();
  mocks.processInbox.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("Mercado Pago notification ingress", () => {
  it("does not accept events before the provider is configured", async () => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "");
    expect((await POST(notification({ authenticated: true }))).status).toBe(
      503,
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("rejects an unsigned event without the private callback token", async () => {
    expect((await POST(notification())).status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("persists an authenticated subscription callback before scheduling reconciliation", async () => {
    const response = await POST(
      notification({
        authenticated: true,
        topic: "subscription_authorized_payment",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_key: "subscription_authorized_payment:123456:42",
        topic: "subscription_authorized_payment",
        resource_id: "123456",
      }),
      expect.anything(),
    );
    expect(mocks.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.after.mock.invocationCallOrder[0],
    );
    expect(mocks.processInbox).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.processInbox).toHaveBeenCalledWith(
      "subscription_authorized_payment:123456:42",
      "subscription_authorized_payment",
      "123456",
    );
  });
  it("never lets the callback token override a bad supplied signature", async () => {
    const response = await POST(
      notification({
        authenticated: true,
        signature: `ts=123,v1=${"0".repeat(64)}`,
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("accepts a valid Mercado Pago signature without a URL token", async () => {
    const ts = "1704908010";
    const signature = createHmac("sha256", secret)
      .update(`id:123456;request-id:notification-42;ts:${ts};`)
      .digest("hex");
    expect(
      (await POST(notification({ signature: `ts=${ts},v1=${signature}` })))
        .status,
    ).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledOnce();
  });
  it("requests a provider retry when the durable inbox cannot be saved", async () => {
    mocks.upsert.mockResolvedValue({ error: { code: "DATABASE_UNAVAILABLE" } });
    expect((await POST(notification({ authenticated: true }))).status).toBe(
      503,
    );
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("ignores unrelated event topics without performing financial work", async () => {
    expect((await POST(notification({ topic: "mp-connect" }))).status).toBe(
      200,
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});

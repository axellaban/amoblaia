import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { authorizedInvoice } from "../src/lib/commerce/mercadopago";
beforeEach(() => vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "test-token"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("recovers a missing invoice detail through an exact match in the provider's search API", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ message: "not found" }, { status: 404 }),
    )
    .mockResolvedValueOnce(
      Response.json({
        results: [{ id: 123, preapproval_id: "sub-1", payment: { id: 456 } }],
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  expect(await authorizedInvoice("123")).toMatchObject({
    id: 123,
    preapproval_id: "sub-1",
  });
  expect(fetcher.mock.calls[1][0]).toBe(
    "https://api.mercadopago.com/authorized_payments/search?id=123",
  );
});
it("keeps a genuinely missing resource retryable rather than fabricating a successful payment", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ results: [{ id: 999 }] })),
  );
  await expect(authorizedInvoice("123")).rejects.toMatchObject({ status: 404 });
});
it("does not turn authentication failures into invoice searches", async () => {
  const fetcher = vi.fn(async () => Response.json({}, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(authorizedInvoice("123")).rejects.toMatchObject({ status: 401 });
  expect(fetcher).toHaveBeenCalledOnce();
});

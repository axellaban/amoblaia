// How readListing chooses its strategy: the direct request, the render
// provider when the site refuses it (only if one is configured), and a clear
// failure otherwise. The transport is replaced; nothing goes to the network.
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => {
    throw new Error("not used");
  },
  currentUser: async () => null,
}));
const fetchMock = vi.hoisted(() => ({ impl: null as null | ((url: string) => Promise<unknown>) }));
vi.mock("@/lib/listings/fetch", async (orig) => {
  const real = await orig<typeof import("../src/lib/listings/fetch")>();
  return { ...real, safeFetch: (url: string) => fetchMock.impl!(url) };
});
import { FetchFailure } from "../src/lib/listings/fetch";
import { readListing } from "../src/lib/demos/listing";
import { registerRenderProvider } from "../src/lib/listings/render";

const PAGE = `<html><head><meta property="og:title" content="Departamento en Venta en Centro - Rivadavia al 2000"></head>
  <body><h1>Departamento</h1><div class="price">USD 80.000</div><p>${"Luminoso. ".repeat(30)}</p></body></html>`;
const ok = (html: string, type = "text/html; charset=utf-8") => async (url: string) => ({ url, status: 200, type, body: Buffer.from(html), redirects: 0, durationMs: 12 });

afterEach(() => {
  delete process.env.SCRAPER_PROVIDER;
});

describe("Reading a listing", () => {
  it("direct request: diagnosis with strategy, duration and charset", async () => {
    fetchMock.impl = ok(PAGE);
    const r = await readListing("https://inmo.com.ar/ficha/1");
    expect(r.imported.price).toBe("USD 80.000");
    expect(r.imported.diagnostics).toMatchObject({ strategy: "direct_http", provider: null, durationMs: 12, charset: "utf-8", priceStatus: "published" });
  });

  it("a site that refuses us, without a provider: an actionable error, never a fake success", async () => {
    fetchMock.impl = async () => {
      throw new FetchFailure("challenge", 403);
    };
    await expect(readListing("https://inmo.com.ar/ficha/1")).rejects.toThrow(/verificación anti-robots.*Zonaprop o Argenprop/);
    fetchMock.impl = async () => {
      throw new FetchFailure("blocked", 403);
    };
    await expect(readListing("https://inmo.com.ar/ficha/1")).rejects.toThrow(/no deja leer la publicación/);
  });

  it("with a configured provider: a refused or empty page is read through it, and the diagnosis says so", async () => {
    const render = vi.fn(async (url: URL) => ({ html: PAGE, finalUrl: url.toString(), status: 200 }));
    registerRenderProvider("fake", () => ({ id: "fake", render }));
    process.env.SCRAPER_PROVIDER = "fake";
    fetchMock.impl = async () => {
      throw new FetchFailure("blocked", 403);
    };
    const r = await readListing("https://inmo.com.ar/ficha/1");
    expect(render).toHaveBeenCalledTimes(1);
    expect(r.imported.diagnostics).toMatchObject({ strategy: "render_provider", provider: "fake" });
    // An empty shell drawn by JavaScript also goes to the provider.
    fetchMock.impl = ok("<html><body><div id='root'></div><script src='/app.js'></script></body></html>");
    const shell = await readListing("https://inmo.com.ar/ficha/2");
    expect(shell.imported.diagnostics?.strategy).toBe("render_provider");
    // Addresses that are not public never reach the provider.
    fetchMock.impl = async () => {
      throw new FetchFailure("not_public");
    };
    render.mockClear();
    await expect(readListing("https://intranet.example/ficha")).rejects.toThrow(/no es un sitio público/);
    expect(render).not.toHaveBeenCalled();
  });

  it("an unknown provider name is no provider", async () => {
    process.env.SCRAPER_PROVIDER = "does-not-exist";
    fetchMock.impl = async () => {
      throw new FetchFailure("blocked", 403);
    };
    await expect(readListing("https://inmo.com.ar/ficha/1")).rejects.toThrow(/no deja leer/);
  });

  it("not a web page", async () => {
    fetchMock.impl = ok("%PDF-1.4", "application/pdf");
    await expect(readListing("https://inmo.com.ar/ficha.pdf")).rejects.toThrow(/no es una página web/);
  });
});

describe("Preview QA endpoint", () => {
  it("is off without a token, in production, with a wrong token, and only reads the QA list", async () => {
    const { GET } = await import("../src/app/api/qa/importador/route");
    const call = (q: string, token?: string) => GET(new Request(`https://x.test/api/qa/importador${q}`, { headers: token ? { "x-qa-token": token } : {} }));
    delete process.env.IMPORTER_QA_TOKEN;
    expect((await call("?i=0", "x".repeat(30))).status).toBe(404);
    process.env.IMPORTER_QA_TOKEN = "t".repeat(32);
    expect((await call("?i=0", "wrong-token-wrong-token-wrong")).status).toBe(404);
    expect((await call("?i=999", "t".repeat(32))).status).toBe(400);
    expect((await call("?url=https://evil.example", "t".repeat(32))).status).toBe(400);
    fetchMock.impl = ok(PAGE);
    const res = await call("?i=0", "t".repeat(32));
    expect(await res.json()).toMatchObject({ ok: true, price: "USD 80.000" });
    process.env.VERCEL_ENV = "production";
    expect((await call("?i=0", "t".repeat(32))).status).toBe(404);
    delete process.env.VERCEL_ENV;
    delete process.env.IMPORTER_QA_TOKEN;
  });
});

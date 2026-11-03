// The importer's transport: public addresses only (checked when connecting,
// so DNS rebinding cannot redirect it), redirects re-checked, caps after
// decompression, deadlines, block/challenge diagnosis and charsets. A local
// server stands in for the internet; the policy lets the tests reach it.
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => {
    throw new Error("not used");
  },
  currentUser: async () => null,
}));
import { checkUrl, FetchFailure, publicAddress, safeFetch, type Resolver } from "../src/lib/listings/fetch";
import { decodeHtml, normalizeCharset } from "../src/lib/listings/charset";

let server: http.Server;
let port = 0;
const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = {
  "/ok": (_q, r) => r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<h1>Casa</h1>"),
  "/latin": (_q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end(Buffer.concat([Buffer.from('<meta charset="iso-8859-1"><h1>Ba'), Buffer.from([0xf1]), Buffer.from("os</h1>")])),
  "/redirect-private": (_q, r) => r.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" }).end(),
  "/redirect-local-name": (_q, r) => r.writeHead(301, { Location: "http://localhost/admin" }).end(),
  "/redirect-ok": (_q, r) => r.writeHead(302, { Location: "/ok" }).end(),
  "/loop": (_q, r) => r.writeHead(302, { Location: "/loop" }).end(),
  "/blocked": (_q, r) => r.writeHead(403, { "Content-Type": "text/html" }).end("Forbidden"),
  "/challenge": (_q, r) => r.writeHead(403, { "Content-Type": "text/html" }).end("<title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/x.js'></script>"),
  "/missing": (_q, r) => r.writeHead(404).end("no"),
  "/slow": (_q, r) => setTimeout(() => r.writeHead(200).end("late"), 1500),
  "/bomb": (_q, r) => r.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" }).end(zlib.gzipSync(Buffer.alloc(4 * 1024 * 1024, 32))),
  "/gzip": (_q, r) => r.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" }).end(zlib.gzipSync("<h1>Comprimido</h1>")),
};
beforeAll(async () => {
  server = http.createServer((req, res) => (routes[req.url ?? ""] ?? ((_q, r) => r.writeHead(404).end()))(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** "listings.test" resolves to the local server, which this policy treats as public. */
const local = (resolver?: Resolver) => ({
  ports: ["", "80", "443", String(port)],
  allowAddress: (ip: string) => ip === "127.0.0.1" || publicAddress(ip),
  resolver: resolver ?? (async () => [{ address: "127.0.0.1", family: 4 }]),
});
const at = (path: string) => `http://listings.test:${port}${path}`;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof FetchFailure ? e.code : `other:${(e as Error).message}`;
  }
};

describe("Safe fetch", () => {
  it("reads a page and follows a redirect on the same site", async () => {
    const res = await safeFetch(at("/redirect-ok"), "page", { policy: local() });
    expect(res.body.toString()).toBe("<h1>Casa</h1>");
    expect(res.redirects).toBe(1);
    expect(res.url).toBe(at("/ok"));
  });

  it("refuses local, private and metadata addresses with the default policy, before connecting", async () => {
    const connect = vi.fn();
    server.once("connection", connect);
    expect(await code(safeFetch(`http://127.0.0.1:${port}/ok`, "page"))).toBe("invalid_url"); // port not allowed
    expect(await code(safeFetch("http://127.0.0.1/ok", "page"))).toBe("not_public");
    expect(await code(safeFetch("http://169.254.169.254/latest/meta-data", "page"))).toBe("not_public");
    expect(await code(safeFetch("http://[::1]/", "page"))).toBe("not_public");
    expect(await code(safeFetch("http://localhost/", "page"))).toBe("not_public");
    expect(await code(safeFetch("http://intranet.local/", "page"))).toBe("not_public");
    expect(await code(safeFetch("file:///etc/passwd", "page"))).toBe("invalid_url");
    expect(await code(safeFetch("http://user:pass@example.com/", "page"))).toBe("invalid_url");
    expect(connect).not.toHaveBeenCalled();
    server.removeListener("connection", connect);
  });

  it("refuses a hostname that resolves to a private address", async () => {
    const policy = { ...local(async () => [{ address: "10.0.0.5", family: 4 }]) };
    expect(await code(safeFetch(at("/ok"), "page", { policy }))).toBe("not_public");
    // One private address among public ones is enough to refuse.
    const mixed = local(async () => [{ address: "127.0.0.1", family: 4 }, { address: "192.168.1.1", family: 4 }]);
    expect(await code(safeFetch(at("/ok"), "page", { policy: mixed }))).toBe("not_public");
  });

  it("re-checks every redirect: a public page cannot send the request to a private address or a local name", async () => {
    expect(await code(safeFetch(at("/redirect-private"), "page", { policy: local() }))).toBe("not_public");
    expect(await code(safeFetch(at("/redirect-local-name"), "page", { policy: local() }))).toBe("not_public");
    expect(await code(safeFetch(at("/loop"), "page", { policy: local() }))).toBe("too_many_redirects");
  });

  it("DNS rebinding: the connection goes to the address that was checked, resolved once per request", async () => {
    let calls = 0;
    // A rebinding resolver: public (allowed) the first time, private afterwards.
    const rebinding: Resolver = async () => (calls++ === 0 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.1", family: 4 }]);
    const res = await safeFetch(at("/ok"), "page", { policy: local(rebinding) });
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
    // A second request resolves again and is refused.
    expect(await code(safeFetch(at("/ok"), "page", { policy: local(rebinding) }))).toBe("not_public");
  });

  it("tells blocked sites and bot challenges from other errors", async () => {
    expect(await code(safeFetch(at("/blocked"), "page", { policy: local() }))).toBe("blocked");
    expect(await code(safeFetch(at("/challenge"), "page", { policy: local() }))).toBe("challenge");
    expect(await code(safeFetch(at("/missing"), "page", { policy: local() }))).toBe("http_error");
  });

  it("gives up at the deadline", async () => {
    expect(await code(safeFetch(at("/slow"), "page", { policy: local(), timeoutMs: 300 }))).toBe("timeout");
  });

  it("caps the size after decompression (a small gzip bomb stops) and reads normal gzip", async () => {
    expect(await code(safeFetch(at("/bomb"), "page", { policy: local() }))).toBe("too_large");
    const res = await safeFetch(at("/gzip"), "page", { policy: local() });
    expect(res.body.toString()).toBe("<h1>Comprimido</h1>");
  });

  it("decodes the charset the page declares", async () => {
    const res = await safeFetch(at("/latin"), "page", { policy: local() });
    expect(decodeHtml(res.body, res.type).text).toContain("<h1>Baños</h1>");
  });

  it("checks URLs without a request", () => {
    expect(checkUrl("https://www.inmo.com.ar/p/1").hostname).toBe("www.inmo.com.ar");
    expect(() => checkUrl("https://inmo.com.ar:8443/")).toThrow(FetchFailure);
    expect(publicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(publicAddress("::ffff:7f00:1")).toBe(false);
    expect(publicAddress("192.0.0.8")).toBe(false);
    expect(publicAddress("200.45.1.1")).toBe(true);
  });
});

describe("Charsets", () => {
  const latin = (s: string) => Buffer.from(s, "latin1");
  it("uses the header, then the BOM, then <meta>, then UTF-8 or windows-1252", () => {
    expect(decodeHtml(latin("<p>Señal</p>"), "text/html; charset=ISO-8859-1").text).toBe("<p>Señal</p>");
    expect(decodeHtml(Buffer.from("<p>Año</p>"), "text/html; charset=utf8").text).toBe("<p>Año</p>");
    expect(decodeHtml(latin('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><p>Peñón</p>'), "text/html").text).toContain("Peñón");
    expect(decodeHtml(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("ñ")]), null).text).toBe("ñ");
    // No declaration and bytes that are not UTF-8: the old Spanish sites' charset.
    expect(decodeHtml(latin("<p>Baño</p>"), "text/html")).toEqual({ text: "<p>Baño</p>", charset: "windows-1252" });
    expect(normalizeCharset("nonsense")).toBeNull();
  });
});

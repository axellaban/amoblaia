// A GET to the public internet only, for listing pages and their photos.
//
// Safety (SSRF): http/https on ports 80/443, no credentials in the URL, and
// every address is checked *when the connection is made*: the socket uses a
// lookup that resolves the host, refuses private, local, link-local and
// metadata ranges and hands the transport exactly the address it checked, so
// a second resolution (DNS rebinding) cannot point the request elsewhere.
// Redirects are followed by hand (up to 4) and each hop is checked again.
// Bodies are capped after decompression and the whole request has a deadline.
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import zlib from "node:zlib";

export const MAX_HTML_BYTES = 3 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_REDIRECTS = 4;
/** Says who we are; sites that refuse it can be read through the render provider (if configured). */
export const USER_AGENT = "Mozilla/5.0 (compatible; HabitaBot/2.0; +https://www.habitaia.app/)";

export type FetchErrorCode =
  | "invalid_url"
  | "not_public"
  | "dns"
  | "network"
  | "timeout"
  | "too_large"
  | "too_many_redirects"
  | "blocked"
  | "challenge"
  | "http_error";

/** Why a fetch failed, in terms the importer can act on (and report without secrets). */
export class FetchFailure extends Error {
  constructor(
    readonly code: FetchErrorCode,
    readonly status: number | null = null,
    message: string = code,
  ) {
    super(message);
    this.name = "FetchFailure";
  }
}

/** True for addresses on the public internet; private, local and metadata ranges are refused. */
export function publicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return publicAddress(mapped[1]);
    // IPv4-mapped in hex form (::ffff:7f00:1) is refused outright.
    if (v.startsWith("::ffff:")) return false;
    return !(
      v === "::" ||
      v === "::1" ||
      v.startsWith("64:ff9b:") ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("fe8") ||
      v.startsWith("fe9") ||
      v.startsWith("fea") ||
      v.startsWith("feb") ||
      v.startsWith("ff")
    );
  }
  return false;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
const systemResolver: Resolver = (host) =>
  new Promise((resolve, reject) =>
    dnsLookup(host, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))),
  );

export type FetchPolicy = {
  /** Which addresses may be contacted (tests open their own local server). */
  allowAddress: (ip: string) => boolean;
  resolver: Resolver;
  /** Ports allowed besides the default of the protocol. */
  ports: string[];
};
const DEFAULT_POLICY: FetchPolicy = { allowAddress: publicAddress, resolver: systemResolver, ports: ["", "80", "443"] };

/** The URL as something we may request, or a failure saying why not. */
export function checkUrl(raw: string | URL, policy: Pick<FetchPolicy, "ports"> = DEFAULT_POLICY): URL {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new FetchFailure("invalid_url");
  }
  if (!["http:", "https:"].includes(url.protocol) || !policy.ports.includes(url.port) || url.username || url.password)
    throw new FetchFailure("invalid_url");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    throw new FetchFailure("not_public");
  return url;
}

/** The lookup the socket uses: resolve, refuse the request if any address is not allowed, connect to the one checked. */
function pinnedLookup(policy: FetchPolicy): LookupFunction {
  return (hostname, options, callback) => {
    policy
      .resolver(hostname)
      .then((addresses) => {
        if (!addresses.length) return callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), "", 4);
        if (!addresses.every((a) => policy.allowAddress(a.address)))
          return callback(Object.assign(new Error("NOT_PUBLIC"), { code: "NOT_PUBLIC" }), "", 4);
        const first = addresses[0];
        if ((options as { all?: boolean }).all) (callback as unknown as (e: null, a: typeof addresses) => void)(null, [first]);
        else callback(null, first.address, first.family);
      })
      .catch((e: NodeJS.ErrnoException) => callback(Object.assign(e, { code: e.code ?? "ENOTFOUND" }), "", 4));
  };
}

/** Pages that answer with a bot challenge instead of the listing (Cloudflare, captchas). */
export function looksLikeChallenge(status: number, headers: http.IncomingHttpHeaders, body: string) {
  if (headers["cf-mitigated"] === "challenge") return true;
  if (![403, 429, 503].includes(status)) return false;
  return /cf-chl|challenge-platform|just a moment|attention required|captcha|are you a robot|ddos-guard|px-captcha/i.test(body.slice(0, 20000));
}

type RawResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

function requestOnce(url: URL, kind: "page" | "image", deadline: number, policy: FetchPolicy): Promise<RawResponse> {
  const max = kind === "page" ? MAX_HTML_BYTES : MAX_IMAGE_BYTES;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !policy.allowAddress(host)) return Promise.reject(new FetchFailure("not_public"));
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new FetchFailure("timeout"));
  const client = url.protocol === "https:" ? https : http;
  return new Promise<RawResponse>((resolve, reject) => {
    let settled = false;
    const fail = (e: FetchFailure) => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(e);
    };
    const req = client.request(
      url,
      {
        method: "GET",
        // An IP literal never reaches the lookup; it was checked above.
        lookup: pinnedLookup(policy),
        // No connection reuse: each request resolves and checks again.
        agent: false,
        timeout: remaining,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: kind === "page" ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" : "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8",
          "Accept-Language": "es-AR,es;q=0.9,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Redirects: the body does not matter.
        if (status >= 300 && status < 400) {
          res.resume();
          settled = true;
          resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
          return;
        }
        if (Number(res.headers["content-length"] || 0) > max && !res.headers["content-encoding"]) return fail(new FetchFailure("too_large", status));
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip" || encoding === "x-gzip"
            ? res.pipe(zlib.createGunzip())
            : encoding === "deflate"
              ? res.pipe(zlib.createInflate())
              : encoding === "br"
                ? res.pipe(zlib.createBrotliDecompress())
                : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          // The cap counts decompressed bytes: a small compressed bomb stops here.
          if (size > max) return fail(new FetchFailure("too_large", status));
          chunks.push(chunk);
        });
        stream.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks) });
        });
        stream.on("error", () => fail(new FetchFailure("network", status)));
        res.on("error", () => fail(new FetchFailure("network", status)));
      },
    );
    req.on("timeout", () => fail(new FetchFailure("timeout")));
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "NOT_PUBLIC") fail(new FetchFailure("not_public"));
      else if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN" || e.code === "ENODATA") fail(new FetchFailure("dns"));
      else fail(new FetchFailure("network"));
    });
    req.end();
  });
}

export type FetchResult = {
  /** Where the content was finally read, after redirects. */
  url: string;
  status: number;
  type: string;
  body: Buffer;
  redirects: number;
  durationMs: number;
};

/**
 * GET from the public internet only, following up to 4 redirects (each one
 * checked again), with size caps and a deadline for the whole request.
 * 401/403/429/503 are "blocked" (or "challenge" when the page is a bot
 * check); any other error status is "http_error".
 */
export async function safeFetch(
  raw: string | URL,
  kind: "page" | "image",
  options: { timeoutMs?: number; policy?: Partial<FetchPolicy> } = {},
): Promise<FetchResult> {
  const policy = { ...DEFAULT_POLICY, ...options.policy };
  const started = Date.now();
  const deadline = started + (options.timeoutMs ?? (kind === "page" ? 15000 : 20000));
  let url = checkUrl(raw, policy);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(url, kind, deadline, policy);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      url = checkUrl(new URL(location, url), policy);
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      const text = kind === "page" ? res.body.toString("latin1") : "";
      if (looksLikeChallenge(res.status, res.headers, text)) throw new FetchFailure("challenge", res.status);
      if ([401, 403, 429, 503].includes(res.status)) throw new FetchFailure("blocked", res.status);
      throw new FetchFailure("http_error", res.status);
    }
    return {
      url: url.toString(),
      status: res.status,
      type: String(res.headers["content-type"] ?? ""),
      body: res.body,
      redirects: hop,
      durationMs: Date.now() - started,
    };
  }
  throw new FetchFailure("too_many_redirects");
}

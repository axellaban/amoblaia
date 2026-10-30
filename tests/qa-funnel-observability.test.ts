// QA 29/10/2026: regressions of the agency funnel's errors and measurement.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { INTERNAL_PROPERTY, internalFlagFromUrl, redactDeep, releaseProperties } from "@/lib/analytics-privacy";
import { failure, HttpError } from "@/lib/commerce/http";
import { firstViewOf } from "@/lib/demos/activity-client";
import { pixelSnippet } from "@/lib/meta-pixel-snippet";

const CODE = "dZf9meMFkvXCAed0NUr6iGpoBX9p7abc";

/** Runs the pixel snippet in a fake browser and reports what it did. */
function runPixel(href: string, referrer = "") {
  const inserted: unknown[] = [];
  const ctx: Record<string, unknown> = {
    location: { href },
    document: {
      referrer,
      createElement: () => ({}),
      getElementsByTagName: () => [{ parentNode: { insertBefore: (node: unknown) => inserted.push(node) } }],
    },
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  vm.runInContext(pixelSnippet("3147699175419885"), ctx);
  return { fbq: ctx.fbq as { queue: unknown[][] } | undefined, inserted };
}

describe("Meta Pixel snippet", () => {
  it("does nothing (and throws nothing) on a page with an invitation code", () => {
    expect(() => runPixel(`https://habitaia.vercel.app/demo/abc?presentacion=1&codigo=${CODE}`)).not.toThrow();
    const r = runPixel(`https://habitaia.vercel.app/demo/abc?presentacion=1&codigo=${CODE}`);
    expect(r.fbq).toBeUndefined();
    expect(r.inserted).toHaveLength(0);
  });
  it("does nothing when the previous page carried the code", () => {
    const r = runPixel("https://habitaia.vercel.app/panel", `https://habitaia.vercel.app/panel/empezar?codigo=${CODE}`);
    expect(r.fbq).toBeUndefined();
  });
  it("loads, inits and tracks the first PageView anywhere else", () => {
    const r = runPixel("https://habitaia.vercel.app/precios");
    expect(r.inserted).toHaveLength(1);
    expect(r.fbq?.queue.map((args) => args[0])).toEqual(["init", "track"]);
  });
  it("only accepts a numeric pixel id", () => {
    expect(() => pixelSnippet("1');alert(1);//")).toThrow();
  });
});

describe("invitation code never reaches the analytics", () => {
  it("redacts nested strings, as in a session replay snapshot", () => {
    const event = {
      $current_url: `https://habitaia.vercel.app/demo/t?presentacion=1&codigo=${CODE}`,
      $snapshot_data: [
        { type: 4, data: { href: `https://habitaia.vercel.app/demo/t?codigo=${CODE}&x=1` } },
        { type: 2, data: { node: { childNodes: [{ attributes: { href: `/panel/empezar?codigo=${CODE}&demo=t` } }] } } },
      ],
      fotos: 4,
      ok: true,
    };
    redactDeep(event);
    expect(JSON.stringify(event)).not.toContain(CODE);
    expect(event.$snapshot_data[0].data.href).toBe("https://habitaia.vercel.app/demo/t?codigo=[oculto]&x=1");
    expect(event.fotos).toBe(4);
    expect(event.ok).toBe(true);
  });
  it("leaves other text alone and survives cycles", () => {
    const a: Record<string, unknown> = { url: "https://habitaia.vercel.app/precios?plan=pro" };
    a.self = a;
    expect(() => redactDeep(a)).not.toThrow();
    expect(a.url).toBe("https://habitaia.vercel.app/precios?plan=pro");
    expect(redactDeep(null)).toBeNull();
  });
});

describe("internal sessions and releases", () => {
  it("reads ?interno=1 / ?interno=0", () => {
    expect(internalFlagFromUrl("?interno=1")).toBe(true);
    expect(internalFlagFromUrl("?a=b&interno=0")).toBe(false);
    expect(internalFlagFromUrl("?codigo=x")).toBeNull();
    expect(INTERNAL_PROPERTY).toBe("habita_internal");
  });
  it("tags events with the short commit and the environment", () => {
    expect(releaseProperties({ NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: "967bd4b1234", NEXT_PUBLIC_VERCEL_ENV: "production" })).toEqual({
      app_version: "967bd4b",
      app_env: "production",
    });
    expect(releaseProperties({})).toEqual({ app_env: "local" });
  });
});

describe("demo view counted once per page load", () => {
  it("repeats (the refreshes while an image is generated) are not new visits", () => {
    expect(firstViewOf("tok-1:p")).toBe(true);
    expect(firstViewOf("tok-1:p")).toBe(false);
    expect(firstViewOf("tok-1:p")).toBe(false);
    // The buyers' version of the same demo is its own view.
    expect(firstViewOf("tok-1:c")).toBe(true);
  });
});

describe("API failures carry route and release", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("logs a 500 with its route and the deployment, never the request", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef0123");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = failure(new Error("INVITATION_SIGNUP_FAILED"), "api/panel/invitacion");
    expect(r.status).toBe(500);
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(log.mock.calls[0][1] as string);
    expect(line).toEqual({ route: "api/panel/invitacion", status: 500, release: "abcdef0", code: "INVITATION_SIGNUP_FAILED" });
  });
  it("does not log the visitor's own mistakes (4xx), but logs a 5xx refusal", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(failure(new HttpError(404, "Esta invitación venció."), "api/panel/invitacion").status).toBe(404);
    expect(log).not.toHaveBeenCalled();
    failure(new HttpError(503, "No disponible."), "api/demo/generar");
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("team's demo list on a phone", () => {
  it("gives every block of the row its own area below 700px", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const mobile = css.slice(css.indexOf("@media (max-width: 700px) {\n  /* Every block the row uses"));
    const areas = /\.dm-row \{[^}]*grid-template-areas:([^;]+);/.exec(mobile)?.[1] ?? "";
    for (const area of ["thumb", "main", "status", "links", "bottom"]) expect(areas).toContain(area);
  });
});

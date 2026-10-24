import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const state = vi.hoisted(() => ({
  assetPath: null as string | null,
  lookups: 0,
  stamped: 0,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  owned: true,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/showcase", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/showcase")>();
  return {
    ...real,
    publicAssetPath: async () => {
      state.lookups++;
      return state.assetPath;
    },
    stampDisclosure: async (image: Buffer) => {
      state.stamped++;
      return real.stampDisclosure(image);
    },
  };
});
// A tiny chainable stand-in for the Supabase client: storage and one row.
vi.mock("@/lib/supabase/server", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "update", "order", "limit"])
    chain[m] = () => chain;
  chain.maybeSingle = async () => ({
    data: state.owned ? { id: "f", agency_logo_path: null } : null,
    error: null,
  });
  chain.then = (resolve: (v: unknown) => void) =>
    resolve({ data: null, error: null });
  return {
    adminClient: () => ({
      from: () => chain,
      storage: {
        from: () => ({
          download: async () => ({
            data: new Blob([
              new Uint8Array(
                await sharp({
                  create: {
                    width: 400,
                    height: 300,
                    channels: 3,
                    background: "#c8c8c8",
                  },
                })
                  .jpeg()
                  .toBuffer(),
              ),
            ]),
            error: null,
          }),
        }),
      },
    }),
  };
});
vi.mock("@/lib/commerce/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/commerce/http")>()),
  requireUser: async () => ({ id: "agent-1", email: "agent@example.com" }),
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ name, args });
    return null;
  },
}));

import { GET as image } from "../src/app/ficha/[token]/imagen/[ref]/route";
import { PATCH as reviewProposal } from "../src/app/api/proposals/[id]/route";
import { PATCH as editShowcase } from "../src/app/api/fichas/[id]/route";
import { loadPublicShowcase } from "../src/lib/showcase";

const token = "tok_PublicShowcaseToken_0001";
const uuid = "00000000-0000-4000-8000-000000000123";
const params = <T>(value: T) => ({ params: Promise.resolve(value) });
const json = (url: string, body: unknown) =>
  new Request(url, {
    method: "PATCH",
    headers: {
      Origin: "https://amobla.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.assetPath = null;
  state.lookups = 0;
  state.stamped = 0;
  state.rpcCalls = [];
  state.owned = true;
});
afterEach(() => vi.unstubAllEnvs());

describe("Public showcase images", () => {
  it("answers 404 for malformed references without querying", async () => {
    const r = await image(new Request("https://x"), params({ token, ref: "p-../../x" }));
    expect(r.status).toBe(404);
    expect(state.lookups).toBe(0);
  });
  it("answers 404 when the link is off or the image is not part of it", async () => {
    state.assetPath = null;
    const r = await image(new Request("https://x"), params({ token, ref: `p-${uuid}` }));
    expect(r.status).toBe(404);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
  it("burns the disclosure into proposals, not into the real photo", async () => {
    state.assetPath = "owner/project/proposal.jpg";
    const proposal = await image(new Request("https://x"), params({ token, ref: `p-${uuid}` }));
    expect(proposal.status).toBe(200);
    expect(proposal.headers.get("Content-Type")).toBe("image/jpeg");
    expect(proposal.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(proposal.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(state.stamped).toBe(1);
    const stamped = await sharp(Buffer.from(await proposal.arrayBuffer()))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(stamped.info.width).toBe(400);
    expect(stamped.info.height).toBe(300);
    // The bottom-left corner is now the dark label, the rest stays untouched.
    const at = (x: number, y: number) =>
      stamped.data[(y * stamped.info.width + x) * stamped.info.channels];
    const mean = (x0: number, x1: number, y0: number, y1: number) => {
      let sum = 0,
        n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++, n++) sum += at(x, y);
      return sum / n;
    };
    expect(mean(20, 200, 280, 289)).toBeLessThan(140);
    expect(mean(250, 390, 20, 120)).toBeGreaterThan(180);
    const original = await image(new Request("https://x"), params({ token, ref: `o-${uuid}` }));
    expect(original.status).toBe(200);
    expect(state.stamped).toBe(1);
  });
});

describe("Public showcase lookup", () => {
  it("rejects malformed tokens before touching the database", async () => {
    vi.stubEnv("SAAS_ENABLED", "true");
    expect(await loadPublicShowcase("short")).toBeNull();
    expect(await loadPublicShowcase("../../etc/passwd-0000000000000")).toBeNull();
  });
});

describe("Agent actions", () => {
  it("reviews only with a valid action and the signed-in user's id", async () => {
    const url = `https://amobla.example/api/proposals/${uuid}`;
    expect(
      (await reviewProposal(json(url, { action: "publish" }), params({ id: uuid }))).status,
    ).toBe(400);
    expect(
      (await reviewProposal(json(url, { action: "review" }), params({ id: "x" }))).status,
    ).toBe(404);
    const ok = await reviewProposal(json(url, { action: "review" }), params({ id: uuid }));
    expect(ok.status).toBe(200);
    expect(state.rpcCalls).toEqual([
      {
        name: "amobla_review_generation",
        args: { p_user: "agent-1", p_generation: uuid, p_action: "review" },
      },
    ]);
  });
  it("does not edit a showcase of another account", async () => {
    state.owned = false;
    const r = await editShowcase(
      json(`https://amobla.example/api/fichas/${uuid}`, { active: false }),
      params({ id: uuid }),
    );
    expect(r.status).toBe(404);
  });
  it("validates the WhatsApp number and the rooms", async () => {
    const url = `https://amobla.example/api/fichas/${uuid}`;
    expect(
      (await editShowcase(json(url, { whatsapp: "123" }), params({ id: uuid }))).status,
    ).toBe(400);
    expect(
      (await editShowcase(json(url, { rooms: [{ projectId: 1 }] }), params({ id: uuid })))
        .status,
    ).toBe(400);
    const ok = await editShowcase(
      json(url, { rooms: [{ projectId: uuid, label: "Living" }], active: true }),
      params({ id: uuid }),
    );
    expect(ok.status).toBe(200);
    expect(state.rpcCalls[0]).toEqual({
      name: "amobla_set_showcase_rooms",
      args: {
        p_user: "agent-1",
        p_showcase: uuid,
        p_rooms: [{ project_id: uuid, label: "Living" }],
      },
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ canSee: true, user: { id: "u1", email: "duenia@sur.test", email_confirmed_at: "2026-01-01" } as unknown, rpcs: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/commerce/http", async (original) => {
  const real = await original<typeof import("../src/lib/commerce/http")>();
  return {
    ...real,
    requireUser: async () => {
      if (!state.user) throw new real.HttpError(401, "Ingresá.");
      return state.user;
    },
    rpc: async () => {
      state.rpcs++;
      return null;
    },
  };
});
vi.mock("@/lib/agency/server", () => ({ canSeeImage: async () => state.canSee }));
vi.mock("@/lib/demos/server", () => ({
  adminImagePaths: async () => ({ original: "u/pj/g.jpg", staged: null }),
  renderImage: async () => Buffer.from([0xff, 0xd8, 0xff]),
  renderPreview: async () => null,
}));

import { GET } from "../src/app/api/admin/demos/imagen/route";
import { generationDownloadUrl, photoDownloadUrl } from "../src/lib/demos/shared";

const GEN = "00000000-0000-4000-8000-0000000000e1";
const url = (path: string) => new Request(`https://habita.test${path}`);

beforeEach(() => {
  state.canSee = true;
  state.user = { id: "u1", email: "duenia@sur.test", email_confirmed_at: "2026-01-01" };
  state.rpcs = 0;
});

describe("Downloading a created version", () => {
  it("serves the JPEG as an attachment with a useful name, without touching credits", async () => {
    const r = await GET(url(generationDownloadUrl(GEN, "Depto Güemes - Dormitorio 2 - Moderno")));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("content-disposition")).toBe(
      `attachment; filename="Depto-Guemes-Dormitorio-2-Moderno.jpg"; filename*=UTF-8''${encodeURIComponent("Depto Güemes - Dormitorio 2 - Moderno.jpg")}`,
    );
    // No balance, reservation or plan is read to download.
    expect(state.rpcs).toBe(0);
  });

  it("is refused to accounts of another agency and to visitors", async () => {
    state.canSee = false;
    expect((await GET(url(generationDownloadUrl(GEN, "x")))).status).toBe(404);
    state.user = null;
    expect((await GET(url(generationDownloadUrl(GEN, "x")))).status).toBe(401);
  });

  it("downloads the original of a photo the same way, also without touching credits", async () => {
    const r = await GET(url(photoDownloadUrl("00000000-0000-4000-8000-0000000000f1", "Casa - Living - original")));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toContain('filename="Casa-Living-original.jpg"');
    expect(state.rpcs).toBe(0);
  });

  it("keeps the regular image inline", async () => {
    const r = await GET(url(`/api/admin/demos/imagen?generacion=${GEN}&w=480`));
    expect(r.headers.get("content-disposition")).toBeNull();
  });
});

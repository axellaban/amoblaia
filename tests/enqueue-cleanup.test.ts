import { vi, it, expect, beforeEach } from "vitest";

// A minimal Supabase stand-in: every query resolves to the next queued result
// for its table, and destructive calls are recorded.
const state = vi.hoisted(() => ({
  results: {} as Record<string, unknown[]>,
  deleted: [] as string[],
  removed: [] as string[][],
  uploadError: null as null | { statusCode: string; message: string },
  reserve: async (): Promise<string[]> => ["job"],
}));
function query(table: string) {
  let destructive = false;
  const result = () => {
    if (destructive) {
      state.deleted.push(table);
      return { error: null };
    }
    return state.results[table]?.shift() ?? { data: null, error: null };
  };
  const chain: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(ok, fail),
    maybeSingle: async () => result(),
    single: async () => result(),
    delete: () => {
      destructive = true;
      return chain;
    },
  };
  for (const m of [
    "select",
    "eq",
    "is",
    "insert",
    "not",
    "lte",
    "or",
    "gt",
    "limit",
  ])
    chain[m] = () => chain;
  return chain;
}
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: query,
    storage: {
      from: () => ({
        upload: async () => ({ error: state.uploadError }),
        remove: async (paths: string[]) => {
          state.removed.push(paths);
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock("@/lib/commerce/images", () => ({
  ProviderError: class extends Error {},
  renderPhoto: vi.fn(),
  readPhoto: async () => ({
    image: Buffer.from("photo"),
    requestKey: "00000000-0000-4000-8000-000000000001",
    projectId: null,
    room: "living",
    style: "modern",
    mode: "furnish",
    notes: "",
    name: "Foto",
    batchSize: 3,
    prompt: "",
  }),
}));
vi.mock("@/lib/commerce/http", async (original) => ({
  ...(await original<typeof import("../src/lib/commerce/http")>()),
  rpc: async (name: string) =>
    name === "amobla_reserve_batch" ? state.reserve() : { credits: 0 },
}));
import { enqueuePhoto } from "../src/lib/commerce/jobs";
import { HttpError } from "../src/lib/commerce/http";

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test";
  state.deleted = [];
  state.removed = [];
  state.uploadError = null;
  state.results = {
    // Original lookup by hash, free-tier check, capacity count, insert, generations count.
    projects: [
      { data: null, error: null },
      { count: 0, error: null },
      {
        data: { id: "new-project", grant_id: null, trashed_at: null },
        error: null,
      },
    ],
    credit_grants: [{ data: [], error: null }],
    generations: [{ count: 0, error: null }],
  };
});

it("removes the project and original it just stored when the batch is refused", async () => {
  state.reserve = async () => {
    throw new HttpError(429, "Alcanzaste el límite de la prueba gratuita.");
  };
  await expect(
    enqueuePhoto(new Request("https://amoblaia.vercel.app/api/jobs"), "user"),
  ).rejects.toMatchObject({ status: 429 });
  expect(state.deleted).toEqual(["projects"]);
  expect(state.removed).toHaveLength(1);
  expect(state.removed[0][0]).toMatch(/^user\/[0-9a-f]{64}\/original\.jpg$/);
});

it("keeps an original that already existed in storage", async () => {
  state.uploadError = {
    statusCode: "409",
    message: "The resource already exists",
  };
  state.reserve = async () => {
    throw new HttpError(409, "Ya hay una tanda en curso.");
  };
  await expect(
    enqueuePhoto(new Request("https://amoblaia.vercel.app/api/jobs"), "user"),
  ).rejects.toMatchObject({ status: 409 });
  expect(state.deleted).toEqual(["projects"]);
  expect(state.removed).toHaveLength(0);
});

it("keeps everything when the batch is reserved", async () => {
  state.reserve = async () => ["a", "b", "c"];
  const batch = await enqueuePhoto(
    new Request("https://amoblaia.vercel.app/api/jobs"),
    "user",
  );
  expect(batch).toEqual({ ids: ["a", "b", "c"], projectId: "new-project" });
  expect(state.deleted).toHaveLength(0);
  expect(state.removed).toHaveLength(0);
});

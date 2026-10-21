import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookie: "token" as string | null,
  deleted: [] as string[],
  claimFails: false,
  claimed: [] as unknown[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (state.cookie ? { value: state.cookie } : undefined),
    delete: (name: string) => state.deleted.push(name),
  }),
}));
vi.mock("@/lib/guest-token", () => ({
  GUEST_COOKIE: "guest",
  verifyGuestToken: (value?: string) => (value ? "guest-id" : null),
}));
vi.mock("@/lib/supabase/server", () => ({ adminClient: () => ({}) }));
vi.mock("../src/lib/commerce/jobs", () => ({ BUCKET: "b" }));
vi.mock("../src/lib/commerce/http", () => ({
  rpc: vi.fn(async (_name: string, args: unknown) => {
    if (state.claimFails) throw new Error("DATABASE_UNAVAILABLE");
    state.claimed.push(args);
    return [];
  }),
}));
import { adoptGuest } from "../src/lib/commerce/guest";

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
  state.cookie = "token";
  state.deleted = [];
  state.claimFails = false;
  state.claimed = [];
});
const account = { id: "user-id", email_confirmed_at: "2026-10-21" };

it("hands the trial over and clears the guest cookie", async () => {
  expect(await adoptGuest(account)).toBe(true);
  expect(state.claimed).toEqual([{ p_guest: "guest-id", p_user: "user-id" }]);
  expect(state.deleted).toEqual(["guest"]);
});

it("keeps the cookie for a later retry when the hand-over fails, without throwing", async () => {
  state.claimFails = true;
  expect(await adoptGuest(account)).toBe(false);
  expect(state.deleted).toEqual([]);
});

it("never hands a trial to an unconfirmed or anonymous account", async () => {
  expect(await adoptGuest({ id: "u", email_confirmed_at: null })).toBe(false);
  expect(await adoptGuest({ ...account, is_anonymous: true })).toBe(false);
  expect(state.claimed).toEqual([]);
});

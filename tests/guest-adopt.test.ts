import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookie: "token" as string | null,
  deleted: [] as string[],
  claimFails: false,
  claimed: [] as unknown[],
  set: [] as string[],
  registered: true,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (state.cookie ? { value: state.cookie } : undefined),
    delete: (name: string) => state.deleted.push(name),
    set: (name: string, value: string) => state.set.push(`${name}=${value}`),
  }),
}));
vi.mock("@/lib/guest-token", () => ({
  GUEST_COOKIE: "guest",
  GUEST_SECONDS: 60,
  guestToken: (id: string) => `signed:${id}`,
  verifyGuestToken: (value?: string) => (value ? "guest-id" : null),
}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => {
    const q = {
      select: () => q,
      eq: () => q,
      is: () => q,
      maybeSingle: async () => ({
        data: state.registered ? { user_id: "x" } : null,
        error: null,
      }),
    };
    return { from: () => q };
  },
}));
vi.mock("../src/lib/commerce/jobs", () => ({ BUCKET: "b" }));
vi.mock("../src/lib/commerce/http", () => ({
  rpc: vi.fn(async (_name: string, args: unknown) => {
    if (state.claimFails) throw new Error("DATABASE_UNAVAILABLE");
    state.claimed.push(args);
    return [];
  }),
}));
import { adoptGuest, currentGuest } from "../src/lib/commerce/guest";

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
  state.cookie = "token";
  state.deleted = [];
  state.claimFails = false;
  state.claimed = [];
  state.set = [];
  state.registered = true;
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

it("renews the trial cookie of an anonymous session on every visit", async () => {
  state.cookie = null;
  expect(await currentGuest({ id: "anon-id", is_anonymous: true })).toBe(
    "anon-id",
  );
  expect(state.set).toEqual(["guest=signed:anon-id"]);
});

it("recognizes a trial known only by its cookie", async () => {
  expect(await currentGuest(null)).toBe("guest-id");
});

it("does not treat an account, or a trial already handed over, as a trial", async () => {
  expect(await currentGuest({ id: "user-id" })).toBeNull();
  state.registered = false;
  expect(await currentGuest(null)).toBeNull();
  expect(state.set).toEqual([]);
});

import { vi, it, expect, beforeEach } from "vitest";
const state = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email_confirmed_at?: string;
    is_anonymous?: boolean;
  },
  cookie: null as string | null,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  currentUser: async () => state.user,
  adminClient: () => ({
    auth: {
      admin: { getUserById: async () => ({ data: { user: state.user } }) },
    },
  }),
}));
vi.mock("@/lib/supabase/config", () => ({
  cloudEnabled: () => true,
  cloudConfigured: () => true,
}));
vi.mock("@/lib/commerce/guest", () => ({ guestId: async () => state.cookie }));
import { requireUser } from "../src/lib/commerce/http";
beforeEach(() => {
  state.user = null;
  state.cookie = null;
});
it("requires login for account and payment operations even with an anonymous session", async () => {
  state.user = { id: "guest", is_anonymous: true };
  await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  expect((await requireUser(undefined, true)).id).toBe("guest");
});
it("never promotes an unverified email account to a guest", async () => {
  state.user = { id: "unverified", is_anonymous: false };
  await expect(requireUser(undefined, true)).rejects.toMatchObject({
    status: 401,
  });
});
it("permits verified accounts while retaining same-origin protection", async () => {
  state.user = { id: "verified", email_confirmed_at: new Date().toISOString() };
  expect((await requireUser()).id).toBe("verified");
  await expect(
    requireUser(
      new Request("https://amoblaia.vercel.app/api/jobs", {
        headers: { origin: "https://other.example" },
      }),
      true,
    ),
  ).rejects.toMatchObject({ status: 403 });
});

import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  exchangeError: null as null | { message: string },
  verified: [] as unknown[],
  adoptFails: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  userClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: state.exchangeError }),
      getUser: async () => ({
        data: { user: { id: "u1", email_confirmed_at: "2026-10-21" } },
      }),
      verifyOtp: async (args: unknown) => {
        state.verified.push(args);
        return {
          data: { user: { id: "u1", email_confirmed_at: "2026-10-21" } },
          error: null,
        };
      },
    },
  }),
}));
vi.mock("@/lib/commerce/guest", () => ({
  adoptGuest: vi.fn(async () => {
    if (state.adoptFails) throw new Error("must never be thrown");
    return true;
  }),
}));
import { GET as callback } from "../src/app/auth/callback/route";
import {
  GET as confirmLink,
  POST as confirm,
} from "../src/app/auth/confirm/route";

beforeEach(() => {
  state.exchangeError = null;
  state.verified = [];
  state.adoptFails = false;
});
const origin = "https://amobla.example";

it("signs in and redirects even though handing over the trial is deferred", async () => {
  const r = await callback(
    new Request(`${origin}/auth/callback?code=abc&next=%2Fprecios&flow=google`),
  );
  expect(r.status).toBe(307);
  expect(r.headers.get("location")).toBe(`${origin}/precios`);
});

it("labels a failed same-tab Google sign-in as Google and keeps the destination", async () => {
  state.exchangeError = { message: "expired" };
  const r = await callback(
    new Request(`${origin}/auth/callback?code=abc&next=%2Fprecios&flow=google`),
  );
  expect(r.headers.get("location")).toBe(
    `${origin}/acceso?error=google&next=%2Fprecios`,
  );
});

it("labels a failed email link as a link problem, not Google", async () => {
  const r = await callback(
    new Request(
      `${origin}/auth/callback?error=access_denied&error_code=otp_expired`,
    ),
  );
  expect(r.headers.get("location")).toBe(`${origin}/acceso?error=enlace`);
});

it("never signs in from just opening an email link", async () => {
  const r = await confirmLink(
    new Request(
      `${origin}/auth/confirm?token_hash=t1&type=signup&next=%2Festudio`,
    ),
  );
  expect(state.verified).toEqual([]);
  expect(r.headers.get("location")).toBe(
    `${origin}/auth/confirmar?token_hash=t1&type=signup&next=%2Festudio`,
  );
});

it("signs in only from the confirmation button on this site", async () => {
  const form = () => {
    const f = new FormData();
    f.set("token_hash", "t1");
    f.set("type", "signup");
    f.set("next", "/estudio");
    return f;
  };
  const foreign = await confirm(
    new Request(`${origin}/auth/confirm`, {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: form(),
    }),
  );
  expect(state.verified).toEqual([]);
  expect(foreign.headers.get("location")).toBe(`${origin}/acceso?error=enlace`);
  const own = await confirm(
    new Request(`${origin}/auth/confirm`, {
      method: "POST",
      headers: { Origin: origin },
      body: form(),
    }),
  );
  expect(own.status).toBe(303);
  expect(own.headers.get("location")).toBe(`${origin}/estudio`);
  expect(state.verified).toEqual([{ token_hash: "t1", type: "signup" }]);
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { stamp: "s1" as string | null, fail: false, calls: 0 };
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    rpc: async (name: string) => {
      state.calls++;
      if (name !== "habita_change_stamp" || state.fail) return { data: null, error: { code: "PGRST202" } };
      return { data: state.stamp, error: null };
    },
  }),
}));
import { unlessUnchanged } from "../src/lib/change-stamp";

const req = (si?: string) => new Request(`https://habita.test/api/x${si === undefined ? "" : `?si=${si}`}`);
const load = vi.fn(async () => ({ rows: 3 }));

beforeEach(() => {
  state.stamp = "s1";
  state.fail = false;
  state.calls = 0;
  load.mockClear();
});

describe("unlessUnchanged", () => {
  it("without ?si= (or without a request) loads as always and never asks for the stamp", async () => {
    expect(await unlessUnchanged(req(), load)).toEqual({ rows: 3 });
    expect(await unlessUnchanged(undefined, load)).toEqual({ rows: 3 });
    expect(state.calls).toBe(0);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("with a stale or first stamp loads and returns the current stamp", async () => {
    expect(await unlessUnchanged(req("0"), load)).toEqual({ rows: 3, stamp: "s1" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("with the current stamp answers unchanged without loading", async () => {
    expect(await unlessUnchanged(req("s1"), load)).toEqual({ unchanged: true, stamp: "s1" });
    expect(load).not.toHaveBeenCalled();
    state.stamp = "s2";
    expect(await unlessUnchanged(req("s1"), load)).toEqual({ rows: 3, stamp: "s2" });
  });

  it("before the migration (the function is missing) always loads, with a null stamp", async () => {
    state.fail = true;
    expect(await unlessUnchanged(req("s1"), load)).toEqual({ rows: 3, stamp: null });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

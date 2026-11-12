import { describe, expect, it, vi } from "vitest";

// ~800 prospected agencies: their ids no longer fit in one request URL, so the demos are read in batches.
const agencies = Array.from({ length: 834 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
const batches: number[] = [];
let inFlight = 0;
let maxInFlight = 0;

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    rpc: async (name: string) =>
      name === "habita_prospect_dataset"
        ? { data: { accounts: agencies.map((agency_id, i) => ({ id: `a${i}`, agency_id })), attempts: [], events: [] }, error: null }
        : { data: 0, error: null },
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => {
          batches.push(ids.length);
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
          if (ids.length > 200) return { data: null, error: { message: "URI too long" } };
          return { data: ids.includes(agencies[500]) ? [{ agency_id: agencies[500], status: "published", activity_level: 2 }] : [], error: null };
        },
      }),
    }),
  }),
}));

describe("prospectDataset", () => {
  it("reads the demos of every agency in batches small enough for the request URL", async () => {
    const { prospectDataset } = await import("@/lib/prospecting/server");
    const ds = await prospectDataset({ syncConversions: false });
    expect(Math.max(...batches)).toBeLessThanOrEqual(200);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(834);
    expect(ds.accounts[500].demo).toEqual({ created: true, sent: true, level: 2 });
    expect(ds.accounts[0].demo).toEqual({ created: false, sent: false, level: 0 });
    // The batches are read at the same time, not one after the other.
    expect(maxInFlight).toBe(batches.length);
  });
});

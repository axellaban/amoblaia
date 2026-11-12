import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ adminClient: () => ({}) }));

// QA 2026-11-12 am: two batches of the same demo at once made the second
// replace hit the primary key (409) and its events stayed out of the score
// until the next batch (lead_recompute_failed). The recalculation is retried.
describe("recomputeQuietly", () => {
  it("retries a failed recalculation and does not log it when a retry works", async () => {
    const { recomputeQuietly } = await import("@/lib/leads/server");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recompute = vi.fn().mockRejectedValueOnce(new Error("LEAD_SCORES_FAILED")).mockResolvedValueOnce([]);
    expect(await recomputeQuietly("demo-1", recompute, 1)).toBe(true);
    expect(recompute).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("logs once after three failed tries", async () => {
    const { recomputeQuietly } = await import("@/lib/leads/server");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recompute = vi.fn().mockRejectedValue(new Error("LEAD_SCORES_FAILED"));
    expect(await recomputeQuietly("demo-1", recompute, 1)).toBe(false);
    expect(recompute).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

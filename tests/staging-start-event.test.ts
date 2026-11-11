// QA 6/11: «property_ai_generation_started» never reached PostHog. The editor's
// main paths (the create panel and the generate dialog) show the cost first and
// call the queue with `quoted: true`, and the event was only sent inside the
// queue's own cost confirmation. Now every start from the agency's panel counts.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useRef: <T,>(v: T) => ({ current: v }),
  useState: <T,>(v: T) => [v, () => undefined],
  useCallback: <T,>(fn: T) => fn,
}));
const track = vi.fn();
const trackMilestone = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a), trackMilestone: (...a: unknown[]) => trackMilestone(...a) }));
const api = vi.fn();
vi.mock("../src/components/admin-demos", () => {
  class ApiError extends Error {}
  return { ApiError, api: (...args: unknown[]) => api(...args) };
});
const confirm = vi.fn(() => true);
vi.stubGlobal("window", { confirm, setTimeout, clearTimeout });

import { useStagingQueue } from "../src/components/use-staging-queue";

const detail = (payer: string) =>
  ({ photos: [{ id: "a", room: "living", mode: "furnish", discarded: [], shown: {}, generations: [] }], staging: { payer, blocked: null } }) as never;
const queue = (payer: string, trackAgency = true) =>
  useStagingQueue({ base: "/api/admin/demos/d1", detail: detail(payer), poll: async () => null, report: () => undefined, trackAgency });
const started = () => track.mock.calls.filter(([e]) => e === "property_ai_generation_started");

afterEach(() => {
  track.mockReset();
  trackMilestone.mockReset();
  api.mockReset();
  confirm.mockClear();
});

describe("start of a generation from the agency's panel", () => {
  it("counts when the dialog already confirmed the cost (quoted)", async () => {
    api.mockResolvedValue({ ok: true });
    expect(await queue("agency").request([{ photoId: "a", style: "nordico" }], { quoted: true })).toBe(true);
    expect(started()).toEqual([["property_ai_generation_started", { photos: 1, versions: 1 }]]);
    expect(trackMilestone).toHaveBeenCalledWith("first_generation_started", { versions: 1, source: "panel" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("counts with the credits when the queue asks for the cost itself", async () => {
    api.mockImplementation(async (path: string) => (String(path).endsWith("/costo") ? { payer: "agency", credits: 10, newPhotos: 1, blocked: null } : { ok: true }));
    expect(await queue("agency").request([{ photoId: "a", style: "nordico" }])).toBe(true);
    expect(started()).toEqual([["property_ai_generation_started", { photos: 1, versions: 1, credits: 1 }]]);
  });

  it("does not count when the person cancels the cost", async () => {
    confirm.mockReturnValueOnce(false);
    api.mockResolvedValue({ payer: "agency", credits: 10, newPhotos: 1, blocked: null });
    expect(await queue("agency").request([{ photoId: "a", style: "nordico" }])).toBe(false);
    expect(started()).toEqual([]);
  });

  it("the team's editor does not send the agency's event", async () => {
    api.mockResolvedValue({ ok: true });
    await queue("team", false).request([{ photoId: "a", style: "nordico" }], { quoted: true });
    expect(started()).toEqual([]);
    expect(trackMilestone).not.toHaveBeenCalled();
  });
});

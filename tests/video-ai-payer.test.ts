import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const startAiVideo = vi.hoisted(() => vi.fn(async () => ({ id: "v1" })));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agency/server", () => ({
  requireDemoAccess: vi.fn(async () => access.current),
  requireDemoRead: vi.fn(),
}));
vi.mock("@/lib/video/ai", () => ({ startAiVideo, advanceAiVideos: vi.fn(), aiUploadTarget: vi.fn() }));
vi.mock("@/lib/video/server", () => ({ createVideo: vi.fn(), finishVideo: vi.fn(), listVideos: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ adminClient: vi.fn() }));

const { POST } = await import("@/app/api/panel/videos/route");

const DEMO = "00000000-0000-4000-8000-0000000000d1";
const TEAM = "00000000-0000-4000-8000-0000000000aa";
const OWNER = "00000000-0000-4000-8000-0000000000bb";
const demo = { id: DEMO, agency_id: "ag1", property_id: "pr1" };
const post = (mode: string) =>
  POST(new Request("https://www.habitaia.app/api/panel/videos", { method: "POST", body: JSON.stringify({ demoId: DEMO, key: crypto.randomUUID(), mode, format: "vertical" }) }));

describe("Who pays an AI video", () => {
  beforeEach(() => startAiVideo.mockClear());

  it("never lets the team spend an agency's credits from its edit", async () => {
    access.current = { actor: { id: TEAM }, demo, admin: true, billingUser: OWNER };
    const r = await post("clip");
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/ya tiene su cuenta/);
    expect(startAiVideo).not.toHaveBeenCalled();
  });

  it("lets a team member who owns the agency pay from their own panel", async () => {
    access.current = { actor: { id: OWNER }, demo, admin: true, billingUser: OWNER };
    const r = await post("clip");
    expect(r.status).toBe(201);
    expect(startAiVideo).toHaveBeenCalledWith(expect.objectContaining({ payerId: OWNER, actorId: OWNER }));
  });
});

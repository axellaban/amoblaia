import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/commerce/http", () => ({
  requireAdmin: async () => ({ id: "operator" }),
  failure: (e:unknown) => Response.json({error:String(e)},{status:500}),
}));
let generation = 0;
vi.mock("@/lib/followup/server", () => ({
  followupQueueView: async () => ({
    queue: [
      {agencyId:"agency-a",name:"Alfa",stage:"no-contactado",blocked:null},
      {agencyId:"agency-b",name:"Beta",stage:"no-responde",blocked:null},
    ],
    blocked: [], noInteresados: [],
    stageCounts: {"no-contactado":1,"no-responde":1},
    agencies: [{agencyId:"agency-a",name:"Alfa",phone:"2231234567",stage:"no-contactado"},{agencyId:"agency-b",name:"Beta",phone:null,stage:"no-responde"}],
    summary: {ready:2,replies:0,cap:48,newToday:0,outsideToday:0,newRemaining:48,newWaiting:0},
    rules: [],
    generatedAt: new Date(Date.now()+(++generation)*10).toISOString(),
  }),
  invalidateBoard: () => undefined,
}));
import { GET } from "../src/app/api/admin/follow-up/cola/route";

describe("GET /api/admin/follow-up/cola", () => {
  it("dos GET consecutivos sin mutaciones devuelven las mismas inmobiliarias, etapas y contadores", async () => {
    const first = await GET();
    const second = await GET();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get("cache-control")).toContain("no-store");
    const a = await first.json(), b = await second.json();
    // Timestamp can differ, but the business state must not.
    delete a.generatedAt;delete b.generatedAt;
    expect(b).toEqual(a);
    expect(a.stageCounts["no-contactado"]).toBe(1);
    expect(a.agencies.map((x:{agencyId:string})=>x.agencyId)).toEqual(a.queue.map((x:{agencyId:string})=>x.agencyId));
  });
});

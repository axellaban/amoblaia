import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  member: { agency: { id: "00000000-0000-4000-8000-000000000011" }, support: false } as { agency: { id: string }; support: boolean } | null,
  user: { id: "00000000-0000-4000-8000-000000000022" } as { id: string } | null,
  inserted: [] as Record<string, unknown>[],
}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/commerce/http", async origin => {
  const real=await origin<typeof import("../src/lib/commerce/http")>();
  return {...real, requireUser:async()=> {
    if (!state.user) throw new real.HttpError(401, "Ingresá a tu cuenta.");
    return state.user;
  }};
});
vi.mock("@/lib/agency/server",()=>({membershipFor:async()=>state.member}));
vi.mock("@/lib/supabase/server",()=>({
  adminClient:()=>({
    from:(table:string)=>({
      upsert:async(row:Record<string,unknown>,opts:{onConflict:string})=>{
        if (table!=="commercial_product_interest" || opts.onConflict!=="agency_id,user_id,product_key") return {error:new Error("Unexpected operation")};
        state.inserted.push(row);return {error:null};
      }
    })
  })
}));
import { POST } from "../src/app/api/panel/interes-comercial/route";
const request=(data:unknown)=>new Request("https://habitaia.app/api/panel/interes-comercial",{
  method:"POST",headers:{"Content-Type":"application/json","Origin":"https://habitaia.app"},body:JSON.stringify(data)
});
const valid={product:"consultas_ia",volumeBand:"11-30",primaryPain:"agendar_visitas",readiness:"esta_semana"};
describe("Commercial interest is saved only for authorized members",()=>{
  beforeEach(()=>{state.inserted.length=0;state.member={agency:{id:"00000000-0000-4000-8000-000000000011"},support:false};state.user={id:"00000000-0000-4000-8000-000000000022"};});
  it("accepts only enumerated pain and volume, scoped to signed in agency",async()=>{
    const res=await POST(request(valid));expect(res.status).toBe(200);expect(await res.json()).toEqual({registered:true});
    expect(state.inserted[0]).toMatchObject({agency_id:state.member?.agency.id,user_id:state.user?.id,product_key:"consultas_ia",volume_band:"11-30",primary_pain:"agendar_visitas",readiness:"esta_semana"});
    expect(JSON.stringify(state.inserted[0])).not.toContain("@");
  });
  it("rejects unrecognized fields and injection attempts",async()=>{
    const res=await POST(request({...valid,primaryPain:"consulta libre con teléfono"}));
    expect(res.status).toBe(400);expect(state.inserted).toHaveLength(0);
  });
  it("does not let support staff register interest as the agency",async()=>{
    state.member={agency:{id:"00000000-0000-4000-8000-000000000011"},support:true};
    const res=await POST(request(valid));expect(res.status).toBe(403);expect(state.inserted).toHaveLength(0);
  });
  it("requires membership",async()=>{
    state.member=null;
    const res=await POST(request(valid));expect(res.status).toBe(404);expect(state.inserted).toHaveLength(0);
  });
  it("requires sign in",async()=>{
    state.user=null;
    const res=await POST(request(valid));expect(res.status).toBe(401);expect(state.inserted).toHaveLength(0);
  });
});

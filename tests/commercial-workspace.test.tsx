import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ track: () => {}, registerSuperProperties: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/panel" }));

import { CommercialWorkspace } from "@/components/commercial-workspace";
import { PanelNav } from "@/components/panel-shell";
import { detectIntent, initialLeads, replyFor, propertyOf, stages } from "@/lib/habita-commercial-sandbox";

describe("Commercial workspace navigation", () => {
  it("adds the two CTAs directly under API without removing existing navigation", () => {
    const html = renderToStaticMarkup(<PanelNav section="consultas_ia" />);
    const api=html.indexOf('data-cta="panel_nav_api"');
    const consultas=html.indexOf('data-cta="panel_nav_consultas_ia"');
    const crm=html.indexOf('data-cta="panel_nav_crm_inteligente"');
    expect(api).toBeGreaterThan(0);
    expect(consultas).toBeGreaterThan(api);
    expect(crm).toBeGreaterThan(consultas);
    expect(html).toContain('data-cta="panel_nav_imagenes"');
    expect(html).toContain('href="/panel/consultas-ia"');
    expect(html).toContain('href="/panel/crm-inteligente"');
  });

  it.each(["consultas_ia","crm_inteligente"] as const)("renders %s with the sample-data disclaimer, CTA analytics and no prototype label", product => {
    const html=renderToStaticMarkup(<CommercialWorkspace product={product}/>);
    expect(html).toContain("Quiero usarlo");
    expect(html).toContain("Entorno de demostración");
    expect(html).toContain('data-cta="commercial_request_activation_header"');
    expect(html.toLowerCase()).not.toContain("prototipo");
  });
});
describe("Context-aware example responses never promise unverified real-world facts", () => {
  it("classifies visit and financing intent separately",()=>{
    expect(detectIntent("¿Podemos visitarlo?")).toBe("viewing");
    expect(detectIntent("¿Acepta financiación?")).toBe("financing");
  });
  it("only proposes a visit pending human confirmation",()=>{
    const r=replyFor("¿Lo puedo visitar mañana?",initialLeads[0]);
    expect(r.suggestedStage).toBe("Visita");
    expect(r.text).toMatch(/confirmará/);
  });
  it("does not fabricate financing terms",()=>{
    const r=replyFor("¿Ofrecen financiación?",initialLeads[1]);
    expect(r.text).toContain("No tengo información verificada");
  });
  it("only recommends known example listings",()=>{
    const r=replyFor("Busco 2 ambientes hasta USD 100.000",initialLeads[0]);
    expect(r.text).toContain("Güemes");
    expect(r.text).toContain("Centro");
    expect(r.text).not.toContain("Playa Grande");
  });
  it("keeps all stage names unique and resolves property references",()=>{
    expect(new Set(stages).size).toBe(stages.length);
    expect(propertyOf(initialLeads[0].propertyId).id).toBe("guemes");
  });
});

// The agent's name read from a listing: contact buttons and links
// ("Contáctenos", "Enviar consulta", "WhatsApp") are the heading of the
// contact block on some sites (Sendra, on Inmobiliatica) and are not a name.
// Without a real name, the agent keeps its WhatsApp or phone, nameless.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { agentName, isGenericAgentName } from "../src/lib/demos/agent-name";
import { readSettings } from "../src/lib/demos/branding";
import { importListing } from "../src/lib/demos/listing";

describe("isGenericAgentName", () => {
  it("refuses contact buttons and links", () => {
    for (const t of [
      "Contáctenos",
      "Contacto",
      "CONTACTANOS",
      "Consultar",
      "Escribinos",
      "WhatsApp",
      "Llamar",
      "Enviar consulta",
      "Consultar por WhatsApp",
      "Contactar al anunciante",
      "Más información",
      "Agendar visita",
      "Me interesa esta propiedad",
      "Asesor",
      "+54 9 223 549-9500",
      "ventas@sendra.com",
      "",
    ])
      expect(isGenericAgentName(t), t).toBe(true);
  });

  it("keeps people's names, also with an accent or a title", () => {
    for (const t of ["María Laura Sendra", "Martín Rodríguez", "Ana", "Arq. Pablo Pérez", "Juan Consultas Gómez"]) expect(isGenericAgentName(t), t).toBe(false);
    expect(agentName("  María   Laura ")).toBe("María Laura");
    expect(agentName("Contáctenos")).toBeNull();
  });
});

// The contact block of a listing as Sendra shows it: the button's text as its heading, then the WhatsApp and the phone.
const page = (heading: string) => `<!doctype html><html><head><title>Departamento en Venta en Plaza Mitre</title></head><body>
<h1>Departamento en Venta en Plaza Mitre</h1>
<div class="precio">USD 98.000</div>
<div class="descripcion"><p>Departamento de 3 ambientes a metros de Plaza Mitre.</p></div>
<div class="contacto">
  <h4>${heading}</h4>
  <a href="https://api.whatsapp.com/send?phone=5492235499500">WhatsApp</a>
  <a href="tel:+5492235499500">223 549-9500</a>
</div>
</body></html>`;
const URL = "https://www.sendrapropiedades.com/departamento-venta-plaza-mitre_424831_propiedad-inmobiliaria.html";

describe("the agent of an imported listing", () => {
  it("drops «Contáctenos» as the name and keeps the WhatsApp and the phone", () => {
    const imp = importListing(page("Contáctenos"), URL, { strategy: "fixture" });
    expect(imp.agent).toMatchObject({ name: "", whatsapp: "+5492235499500", phone: "+5492235499500" });
    // The preview says the name is missing, not «Contáctenos».
    expect(imp.report.find((r) => r.field === "Agente")).toMatchObject({ status: "missing", value: null });
    expect(imp.report.find((r) => r.field === "WhatsApp del agente")).toMatchObject({ status: "found", value: "+5492235499500" });
  });

  it("keeps a real name", () => {
    const imp = importListing(page("María Laura Sendra"), URL, { strategy: "fixture" });
    expect(imp.agent).toMatchObject({ name: "María Laura Sendra", whatsapp: "+5492235499500" });
  });

  it("a nameless agent survives being saved and read back, with its contact", () => {
    const imp = importListing(page("Enviar consulta"), URL, { strategy: "fixture" });
    const s = readSettings({ agent: imp.agent });
    expect(s.agent).toMatchObject({ name: "", whatsapp: "+5492235499500", phone: "+5492235499500" });
    // An agent with neither name nor contact is still nothing.
    expect(readSettings({ agent: { name: "", whatsapp: "", phone: null } }).agent).toBeNull();
  });
});

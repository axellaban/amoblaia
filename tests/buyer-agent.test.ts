import { describe, expect, it } from "vitest";
import {
  AGENT_SUGGESTIONS,
  BUYER_AGENT_OFF,
  agencyBucket,
  agentIntent,
  agentReply,
  buyerAgentDecision,
  leadAfter,
  readBuyerAgentMode,
  statedBudget,
  visitSlots,
  type AgentFacts,
} from "@/lib/demos/buyer-agent";
import { DEFAULT_SETTINGS, readSettings } from "@/lib/demos/branding";
import { settingsInput } from "@/lib/demos/input";

const ids = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const full: AgentFacts = {
  title: "Departamento en Güemes",
  location: "Güemes, Mar del Plata",
  operation: "Venta",
  price: "USD 139.000",
  availability: "Inmediata",
  features: "3 ambientes · 78 m²",
};
const empty: AgentFacts = { title: "Propiedad", location: null, operation: null, price: null, availability: null, features: null };

describe("who sees the property assistant", () => {
  it("is off by default: no agency sees it and no group is recorded", () => {
    expect(DEFAULT_SETTINGS.buyerAgent).toBe("auto");
    for (const id of ids.slice(0, 20)) expect(buyerAgentDecision({ settings: BUYER_AGENT_OFF, mode: "auto", agencyId: id })).toEqual({ show: false, variant: null, assignment: "off" });
  });

  it("a demo forced by the team shows or hides it whatever the general test, out of the analysis", () => {
    const on = { enabled: true, share: 50 };
    expect(buyerAgentDecision({ settings: BUYER_AGENT_OFF, mode: "show", agencyId: ids[0] })).toEqual({ show: true, variant: null, assignment: "forced" });
    expect(buyerAgentDecision({ settings: on, mode: "hide", agencyId: ids[0] })).toEqual({ show: false, variant: null, assignment: "forced" });
  });

  it("splits agencies by a stable bucket, close to the share, and the same agency always lands in the same group", () => {
    const on = { enabled: true, share: 50 };
    const shown = ids.filter((id) => buyerAgentDecision({ settings: on, mode: "auto", agencyId: id }).show).length;
    expect(shown).toBeGreaterThan(150);
    expect(shown).toBeLessThan(250);
    expect(agencyBucket(ids[7])).toBe(agencyBucket(ids[7]));
    const d = buyerAgentDecision({ settings: on, mode: "auto", agencyId: ids[7] });
    expect(d.variant).toBe(d.show ? "asistente" : "control");
    expect(buyerAgentDecision({ settings: { enabled: true, share: 0 }, mode: "auto", agencyId: ids[7] }).show).toBe(false);
    expect(buyerAgentDecision({ settings: { enabled: true, share: 100 }, mode: "auto", agencyId: ids[7] }).show).toBe(true);
  });

  it("reads and validates the per-demo mode", () => {
    expect(readBuyerAgentMode("show")).toBe("show");
    expect(readBuyerAgentMode("cualquiera")).toBe("auto");
    expect(readSettings({}).buyerAgent).toBe("auto");
    expect(settingsInput({ buyerAgent: "hide" }, DEFAULT_SETTINGS).buyerAgent).toBe("hide");
    expect(() => settingsInput({ buyerAgent: "siempre" }, DEFAULT_SETTINGS)).toThrow();
  });
});

describe("what the assistant answers", () => {
  it("classifies the four suggested questions", () => {
    expect(AGENT_SUGGESTIONS.map(agentIntent)).toEqual(["availability", "price", "measures", "viewing"]);
  });

  it("never states a measure: the staging is illustrative", () => {
    const r = agentReply("¿Entraría una mesa para seis?", full);
    expect(r.text).toContain("ilustrativa");
    expect(r.text).not.toMatch(/\d+\s*(m|cm|metros)/);
    expect(r.pending).toBe("Medidas del ambiente");
  });

  it("gives the published price only when there is one, and never invents it", () => {
    expect(agentReply("¿Cuánto sale?", full).text).toContain("USD 139.000");
    const r = agentReply("¿Cuánto sale?", empty);
    expect(r.text).toContain("se consulta con la inmobiliaria");
    expect(r.text).not.toMatch(/USD|\$/);
    expect(r.answeredFromData).toBe(false);
  });

  it("does not confirm availability nor financing that are not published", () => {
    expect(agentReply("¿Sigue disponible?", empty).text).toContain("No tengo la disponibilidad confirmada");
    expect(agentReply("¿Aceptan crédito hipotecario?", full).text).toContain("No tengo ese dato verificado");
  });

  it("answers a feature only when the listing mentions it", () => {
    expect(agentReply("¿Cuántos ambientes tiene?", full).answeredFromData).toBe(true);
    const r = agentReply("¿Tiene cochera?", full);
    expect(r.answeredFromData).toBe(false);
    expect(r.text).toContain("No tengo ese detalle publicado");
  });

  it("offers two slots on the day asked, always to be confirmed by the agent", () => {
    expect(visitSlots("¿Puedo visitarla el sábado?")).toEqual(["Sábado 10:00", "Sábado 17:00"]);
    expect(visitSlots("¿La puedo ver?")).toEqual(["Mañana 10:00", "Mañana 17:00"]);
    expect(agentReply("¿Puedo visitarla el sábado?", full).text).toContain("confirma el horario");
  });

  it("reads a budget only when the visitor says it", () => {
    expect(statedBudget("Tengo hasta USD 100.000")).toBe("USD 100.000");
    expect(statedBudget("unos 95 mil dólares")).toBe("USD 95.000");
    expect(statedBudget("¿Cuál es el precio?")).toBeNull();
  });

  it("builds the example CRM card from the conversation", () => {
    const turns = ["¿Entraría una mesa para seis?", "Tengo hasta USD 150.000, ¿puedo verla el sábado?"].map((q) => ({ question: q, reply: agentReply(q, full) }));
    const lead = leadAfter(turns, "Sábado 10:00");
    expect(lead).toMatchObject({ intent: "viewing", budget: "USD 150.000", pending: ["Medidas del ambiente"], visit: "Sábado 10:00" });
    expect(lead.nextAction).toContain("Sábado 10:00");
  });
});

import { describe, expect, it } from "vitest";
import { byPriority, currentSituation, defaultPriority, derivedSituation, groupOf, nameKey, nextAction, outsideHours, shortName, splitMessages } from "@/lib/followup/plan";

const facts = { suppressed: false, accountStage: "pending", lostReason: null, sheetStatus: "Pendiente", hasNumber: true, allInvalid: false };

describe("derivedSituation (la hoja y Adquisición, sin copiar nada)", () => {
  it("reads each fact in order: baja, pérdida, número, interés, respuesta", () => {
    expect(derivedSituation(facts)).toBe("sin_respuesta");
    expect(derivedSituation({ ...facts, suppressed: true })).toBe("no_contactar");
    expect(derivedSituation({ ...facts, accountStage: "lost", lostReason: "Cuenta con proveedor de IA" })).toBe("proveedor_ia");
    expect(derivedSituation({ ...facts, accountStage: "lost", lostReason: "No interesado" })).toBe("rechazo");
    expect(derivedSituation({ ...facts, sheetStatus: "Sin WhatsApp" })).toBe("sin_whatsapp");
    expect(derivedSituation({ ...facts, sheetStatus: "Número incorrecto" })).toBe("numero_incorrecto");
    expect(derivedSituation({ ...facts, allInvalid: true })).toBe("sin_whatsapp");
    expect(derivedSituation({ ...facts, accountStage: "interested" })).toBe("interesado");
    expect(derivedSituation({ ...facts, accountStage: "sent", sheetStatus: "Neutro" })).toBe("neutro");
    expect(derivedSituation({ ...facts, accountStage: "conversation", sheetStatus: "Responde saludo inicial" })).toBe("confirmo_numero");
  });

  it("keeps a manual situation while the funnel stays in the same step", () => {
    expect(currentSituation("sin_respuesta", { situation: "pregunta_precios", step: 0 }, 0)).toEqual({ situation: "pregunta_precios", manual: true });
    expect(currentSituation("interesado", { situation: "pregunta_precios", step: 0 }, 1)).toEqual({ situation: "interesado", manual: false });
  });
});

describe("nextAction (fija por código en la Fase 1)", () => {
  it("greets the uncontacted, presents to the ones that confirmed, answers prices", () => {
    expect(nextAction("no-contactado", "sin_respuesta").action).toBe("principal");
    expect(nextAction("no-contactado", "confirmo_numero").action).toBe("presentacion");
    expect(nextAction("no-responde", "confirmo_numero").action).toBe("presentacion");
    expect(nextAction("no-responde", "pregunta_precios").action).toBe("precios");
    expect(nextAction("no-abrio", "sin_respuesta").action).toBe("principal");
  });
  it("never writes again after a no, and leaves the ambiguous ones to a person", () => {
    for (const s of ["rechazo", "proveedor_ia", "no_contactar", "sin_whatsapp", "numero_incorrecto"] as const) expect(nextAction("no-responde", s).action).toBeNull();
    expect(nextAction("no-responde", "neutro")).toMatchObject({ action: null });
    expect(nextAction("no-responde", "neutro").reason).toMatch(/a mano/);
  });
});

describe("queue order", () => {
  it("goes by group, then score, then the longest waiting", () => {
    const q = (group: ReturnType<typeof groupOf>, score: number | null, since = "2026-11-01") => ({ group, score, since });
    const list = [q("nuevos", 99), q("seguimientos", 10), q("respuestas", 5), q("demos", 50), q("nuevos", 80, "2026-10-01"), q("nuevos", 80, "2026-09-01")].sort(byPriority);
    expect(list.map((x) => `${x.group}:${x.score}:${x.since}`)).toEqual([
      "respuestas:5:2026-11-01",
      "demos:50:2026-11-01",
      "seguimientos:10:2026-11-01",
      "nuevos:99:2026-11-01",
      "nuevos:80:2026-09-01",
      "nuevos:80:2026-10-01",
    ]);
    expect(groupOf("no-contactado", "principal")).toBe("nuevos");
    expect(groupOf("no-responde", "presentacion")).toBe("respuestas");
    expect(groupOf("sin-enviar", "principal")).toBe("demos");
  });
});

describe("priority (Alta, Media, Baja)", () => {
  it("comes from the group, and a manual one goes first", () => {
    expect(defaultPriority("respuestas")).toBe("alta");
    expect(defaultPriority("demos")).toBe("alta");
    expect(defaultPriority("seguimientos")).toBe("media");
    expect(defaultPriority("nuevos")).toBe("baja");
    const list = [
      { name: "seguimiento", group: "seguimientos" as const, score: 90, since: "2026-11-01" },
      { name: "nuevo subido", group: "nuevos" as const, score: 50, since: "2026-11-01", priority: "alta" as const },
      { name: "respuesta", group: "respuestas" as const, score: 10, since: "2026-11-01" },
    ].sort(byPriority);
    expect(list.map((x) => x.name)).toEqual(["respuesta", "nuevo subido", "seguimiento"]);
  });
});

describe("outsideHours (hora de Argentina)", () => {
  const at = (iso: string) => new Date(iso);
  it("new contacts Monday to Saturday 9 to 18, the rest until 19", () => {
    // 2026-11-09 is a Monday. 12:00 UTC = 9:00 ART.
    expect(outsideHours("nuevos", at("2026-11-09T12:00:00Z"))).toBeNull();
    expect(outsideHours("nuevos", at("2026-11-09T11:59:00Z"))).toMatch(/Fuera de horario/);
    expect(outsideHours("nuevos", at("2026-11-09T21:00:00Z"))).toMatch(/de 9 a 18/);
    expect(outsideHours("respuestas", at("2026-11-09T21:30:00Z"))).toBeNull();
    expect(outsideHours("respuestas", at("2026-11-09T22:00:00Z"))).toMatch(/de 9 a 19/);
    // Sunday.
    expect(outsideHours("respuestas", at("2026-11-08T15:00:00Z"))).toMatch(/lunes a sábado/);
  });
});

describe("messages and names", () => {
  it("splits a text into the messages that go one after the other", () => {
    expect(splitMessages("Hola\n---\nTe cuento\n\n---  \nVa?")).toEqual(["Hola", "Te cuento", "Va?"]);
    expect(splitMessages("Solo uno")).toEqual(["Solo uno"]);
  });
  it("uses the short commercial name, without the owner or the company type", () => {
    expect(shortName("Miramar Negocios Inmobiliarios (Miriam Martínez de Gómez)")).toBe("Miramar Negocios Inmobiliarios");
    expect(shortName("Depaoli Propiedades S.R.L.")).toBe("Depaoli Propiedades");
    expect(shortName("Ribera SA")).toBe("Ribera");
    expect(shortName("Casas")).toBe("Casas");
  });
  it("compares names for duplicates without the generic words", () => {
    expect(nameKey("Depaoli Propiedades")).toBe(nameKey("DEPAOLI Inmobiliaria (Juan Depaoli)"));
  });
});

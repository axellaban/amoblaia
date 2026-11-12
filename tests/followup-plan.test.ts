import { describe, expect, it } from "vitest";
import { byPriority, currentSituation, defaultPriority, replyRoute, derivedSituation, groupOf, nameKey, nextAction, outsideHours, shortName, splitMessages } from "@/lib/followup/plan";
import { DEFAULT_RULES } from "@/lib/followup/rules";

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

  it("keeps what the agency last said when the funnel moves on", () => {
    expect(currentSituation("sin_respuesta", null, 0)).toEqual({ situation: "sin_respuesta", manual: false });
    expect(currentSituation("interesado", { situation: "mas_adelante", step: 0 }, 3)).toEqual({ situation: "mas_adelante", manual: true });
    expect(currentSituation("interesado", { situation: "confirmo_numero", step: 0 }, 3)).toEqual({ situation: "confirmo_numero", manual: true });
    expect(currentSituation("interesado", { situation: "rechazo", step: 0 }, 3)).toEqual({ situation: "rechazo", manual: true });
  });

  it("a price question is answered in its step and does not follow the funnel", () => {
    expect(currentSituation("sin_respuesta", { situation: "pregunta_precios", step: 0 }, 0)).toEqual({ situation: "pregunta_precios", manual: true });
    expect(currentSituation("interesado", { situation: "pregunta_precios", step: 0 }, 1)).toEqual({ situation: "interesado", manual: false });
  });

  it("a demo sent to someone who asked for later does not get the 24 h follow-up", () => {
    const rules = DEFAULT_RULES.map((r) => (r.key === "no-abrio:principal" ? { ...r, situations: ["sin_respuesta", "confirmo_numero", "interesado"] as typeof r.situations } : r));
    const sit = currentSituation("interesado", { situation: "mas_adelante", step: 0 }, 3).situation;
    expect(nextAction("no-abrio", sit, {}, rules).action).toBeNull();
    expect(nextAction("no-abrio", "interesado", {}, rules)).toMatchObject({ action: "principal", afterHours: 24 });
  });
});

describe("nextAction (secuencias fijas por código)", () => {
  it("greets the uncontacted, presents to the ones that confirmed, answers prices", () => {
    expect(nextAction("no-contactado", "sin_respuesta")).toMatchObject({ action: "principal", afterHours: 0 });
    // Presentación no es una acción de «No contactado»: la regla es incompatible y el motor no la ejecuta.
    expect(nextAction("no-contactado", "confirmo_numero").action).toBeNull();
    expect(nextAction("no-responde", "confirmo_numero")).toMatchObject({ action: "presentacion", afterHours: 0 });
    expect(nextAction("no-responde", "pregunta_precios").action).toBe("precios");
    expect(nextAction("no-responde", "derivo").action).toBe("presentacion");
  });
  it("follows each sequence step by step, with its wait, and ends", () => {
    expect(nextAction("no-responde", "sin_respuesta")).toMatchObject({ action: "principal", afterHours: 48 });
    expect(nextAction("no-responde", "sin_respuesta", { principal: true })).toMatchObject({ action: "seguimiento_2", afterHours: 72 });
    expect(nextAction("no-responde", "sin_respuesta", { principal: true, seguimiento_2: true })).toMatchObject({ action: null });
    expect(nextAction("no-abrio", "sin_respuesta")).toMatchObject({ action: "principal", afterHours: 24 });
    expect(nextAction("no-responde", "confirmo_numero", { presentacion: true })).toMatchObject({ action: "presentacion_seguimiento", afterHours: 48 });
    expect(nextAction("no-responde", "confirmo_numero", { presentacion: true, presentacion_seguimiento: true }).reason).toMatch(/terminada/);
    expect(nextAction("no-responde", "pregunta_precios", { precios: true }).reason).toMatch(/esperá su respuesta/);
    // A neutral answer keeps the stage's sequence; it never counts as interested.
    expect(nextAction("no-responde", "neutro").action).toBe("principal");
  });
  it("never writes again after a no", () => {
    for (const s of ["rechazo", "proveedor_ia", "no_contactar", "sin_whatsapp", "numero_incorrecto"] as const) expect(nextAction("no-responde", s).action).toBeNull();
    expect(nextAction("no-responde", "interesado").reason).toMatch(/demo/);
  });
});

describe("replyRoute", () => {
  it("applies a confident classification, sends audios, uncovered questions and low confidence to Facu", () => {
    expect(replyRoute("confirmo_numero", 0.95)).toBe("aplicar");
    expect(replyRoute("confirmo_numero", null)).toBe("aplicar");
    expect(replyRoute("neutro", 0.6)).toBe("facu");
    expect(replyRoute("audio", 1)).toBe("facu");
    expect(replyRoute("pregunta_no_cubierta", 0.99)).toBe("facu");
    expect(replyRoute(null, null)).toBe("revisar");
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

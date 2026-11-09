import { describe, expect, it } from "vitest";
import { NO_FILTER, OTHER_RULES, cleanFilter, isEmptyFilter, matchesFilter, pickNext, stageRules, type Filterable } from "@/lib/followup/queue-filter";
import { groupOf, nextAction, type Action, type Situation } from "@/lib/followup/plan";
import { DEFAULT_RULES, type Rule } from "@/lib/followup/rules";
import { COMMERCIAL_STAGES, FOLLOWUP_STAGES, commercialOf, technicalOf, type StageKey } from "@/lib/followup/stages";

/** Una inmobiliaria como la arma la cola: la regla y el grupo salen del motor. */
function agency(name: string, stage: StageKey, situation: Situation, done: Partial<Record<Action, boolean>> = {}, rules: Rule[] = DEFAULT_RULES): Filterable & { action: Action | null } {
  const next = nextAction(stage, situation, done, rules);
  return { name, stage, situation, ruleKey: next.rule?.key ?? null, action: next.action, group: groupOf(stage, next.action) };
}

describe("Cola por etapa y regla", () => {
  it("la segunda etapa se llama «Contactado» y conserva su clave", () => {
    const s = FOLLOWUP_STAGES[1];
    expect(s).toMatchObject({ key: "no-responde", title: "Contactado" });
  });

  it("Contactado → Presentación muestra solo las que confirmaron el número y van a presentación", () => {
    const queue = [
      agency("Pomares Propiedades", "no-responde", "confirmo_numero"),
      agency("Oyarbide", "no-responde", "confirmo_numero"),
      agency("Luro", "no-responde", "sin_respuesta"),
      agency("Precios SA", "no-responde", "pregunta_precios"),
      agency("Nueva", "no-contactado", "sin_respuesta"),
    ];
    const f = { ...NO_FILTER, stage: "no-responde" as const, rule: "no-responde:presentacion" };
    expect(queue.filter((q) => matchesFilter(q, f, DEFAULT_RULES)).map((q) => q.name)).toEqual(["Pomares Propiedades", "Oyarbide"]);
    // Con la situación también: el mismo resultado; con otra situación, ninguna.
    expect(queue.filter((q) => matchesFilter(q, { ...f, situation: "confirmo_numero" }, DEFAULT_RULES))).toHaveLength(2);
    expect(queue.filter((q) => matchesFilter(q, { ...f, situation: "pregunta_precios" }, DEFAULT_RULES))).toHaveLength(0);
    // Toda la etapa: las cuatro de Contactado, ninguna de No contactado.
    expect(queue.filter((q) => matchesFilter(q, { ...NO_FILTER, stage: "no-responde" }, DEFAULT_RULES))).toHaveLength(4);
  });

  it("después de la presentación su próxima acción es su seguimiento: sale del filtro de Presentación", () => {
    const after = agency("Pomares", "no-responde", "confirmo_numero", { presentacion: true });
    expect(after.ruleKey).toBe("no-responde:presentacion_seguimiento");
    expect(matchesFilter(after, { ...NO_FILTER, stage: "no-responde", rule: "no-responde:presentacion" }, DEFAULT_RULES)).toBe(false);
    expect(matchesFilter(after, { ...NO_FILTER, stage: "no-responde", rule: "no-responde:presentacion_seguimiento" }, DEFAULT_RULES)).toBe(true);
  });

  it("confirmar el número no es estar interesado; una interesada no tiene acción en Contactado", () => {
    expect(agency("A", "no-responde", "confirmo_numero").action).toBe("presentacion");
    const interested = agency("B", "no-responde", "interesado");
    expect(interested.action).toBeNull();
    expect(interested.ruleKey).toBeNull();
  });

  it("dos reglas con la misma acción se distinguen por su clave", () => {
    const rules: Rule[] = [
      ...DEFAULT_RULES.filter((r) => r.stage !== "no-responde" || r.action !== "principal"),
      { ...DEFAULT_RULES.find((r) => r.key === "no-responde:principal")!, key: "no-responde:principal-neutro", situations: ["neutro"], position: 35 },
      DEFAULT_RULES.find((r) => r.key === "no-responde:principal")!,
    ];
    const a = agency("Neutra", "no-responde", "neutro", {}, rules);
    const b = agency("Sin respuesta", "no-responde", "sin_respuesta", {}, rules);
    expect([a.action, b.action]).toEqual(["principal", "principal"]);
    expect(matchesFilter(a, { ...NO_FILTER, rule: "no-responde:principal-neutro" }, rules)).toBe(true);
    expect(matchesFilter(b, { ...NO_FILTER, rule: "no-responde:principal-neutro" }, rules)).toBe(false);
  });

  it("las reglas de la etapa: activas, de su etapa y compatibles, en orden; «Otras» junta lo que no sale de ellas", () => {
    const rules = DEFAULT_RULES.map((r) => (r.key === "no-responde:precios" ? { ...r, enabled: false } : r));
    expect(stageRules(rules, "no-responde").map((r) => r.key)).toEqual(["no-responde:presentacion", "no-responde:presentacion_seguimiento", "no-responde:principal", "no-responde:seguimiento_2"]);
    // Las de No contactado con acciones que no son de la etapa no aparecen.
    expect(stageRules(DEFAULT_RULES, "no-contactado").map((r) => r.key)).toEqual(["no-contactado:principal"]);
    const off = { name: "X", stage: "no-responde" as const, situation: "pregunta_precios" as const, ruleKey: "no-responde:precios", group: "respuestas" as const };
    expect(matchesFilter(off, { ...NO_FILTER, rule: OTHER_RULES }, rules)).toBe(true);
    expect(matchesFilter(off, { ...NO_FILTER, rule: OTHER_RULES }, DEFAULT_RULES)).toBe(false);
  });

  it("tipo de trabajo y búsqueda (sin tildes ni mayúsculas) se combinan con la etapa", () => {
    const q = agency("Pérez Longo Propiedades", "no-responde", "pregunta_precios");
    expect(matchesFilter(q, { ...NO_FILTER, stage: "no-responde", group: "respuestas", search: "perez" }, DEFAULT_RULES)).toBe(true);
    expect(matchesFilter(q, { ...NO_FILTER, stage: "no-responde", group: "seguimientos" }, DEFAULT_RULES)).toBe(false);
    expect(matchesFilter(q, { ...NO_FILTER, search: "luro" }, DEFAULT_RULES)).toBe(false);
  });

  it("el filtro que llega a la API se limpia: lo desconocido se ignora", () => {
    expect(cleanFilter({ etapa: "no-responde", regla: "no-responde:presentacion", situacion: "confirmo_numero", grupo: "respuestas", buscar: " pomares " })).toEqual({
      stage: "no-responde",
      rule: "no-responde:presentacion",
      situation: "confirmo_numero",
      group: "respuestas",
      search: "pomares",
    });
    expect(cleanFilter({ etapa: "otra", situacion: "x", grupo: 3 })).toEqual(NO_FILTER);
    expect(cleanFilter(null)).toEqual(NO_FILTER);
    expect(isEmptyFilter(NO_FILTER)).toBe(true);
    expect(isEmptyFilter({ ...NO_FILTER, search: "a" })).toBe(false);
  });
});

describe("Tomar la próxima con filtros", () => {
  const now = "2026-11-09T15:00:00.000Z";
  const q = (id: string, stage: StageKey, situation: Situation, claim: { actorId: string; until: string } | null = null) => ({ ...agency(id, stage, situation), agencyId: id, claim });
  // En orden de prioridad global: las de No contactado primero, como pasaría con un saludo nuevo de prioridad alta.
  const queue = [q("nueva-1", "no-contactado", "sin_respuesta"), q("tomada", "no-responde", "confirmo_numero", { actorId: "otro", until: "2026-11-09T15:05:00.000Z" }), q("precios", "no-responde", "pregunta_precios"), q("pomares", "no-responde", "confirmo_numero"), q("oyarbide", "no-responde", "confirmo_numero")];
  const presentacion = { ...NO_FILTER, stage: "no-responde" as const, rule: "no-responde:presentacion" };

  it("toma solo lo que entra en Contactado → Presentación, sin saltar a otra etapa ni a otra acción", async () => {
    const got = await pickNext(queue, { filter: presentacion, rules: DEFAULT_RULES, actorId: "yo", now }, async () => true);
    expect(got?.agencyId).toBe("pomares");
  });

  it("no toma la que tiene otra sesión; sí la propia", async () => {
    expect((await pickNext(queue, { filter: presentacion, rules: DEFAULT_RULES, actorId: "yo", now }, async () => true))?.agencyId).not.toBe("tomada");
    expect((await pickNext(queue, { filter: presentacion, rules: DEFAULT_RULES, actorId: "otro", now }, async () => true))?.agencyId).toBe("tomada");
  });

  it("«Siguiente contacto» salta las ya trabajadas y sigue con el mismo filtro hasta que no queda ninguna", async () => {
    const lock = async () => true;
    const f = { filter: presentacion, rules: DEFAULT_RULES, actorId: "yo", now };
    expect((await pickNext(queue, { ...f, skip: ["pomares"] }, lock))?.agencyId).toBe("oyarbide");
    expect(await pickNext(queue, { ...f, skip: ["pomares", "oyarbide"] }, lock)).toBeNull();
  });

  it("si otra sesión la gana al reservarla, pasa a la siguiente; si ninguna se puede, termina", async () => {
    const tried: string[] = [];
    const got = await pickNext(queue, { filter: presentacion, rules: DEFAULT_RULES, actorId: "yo", now }, async (it) => (tried.push(it.agencyId), it.agencyId !== "pomares"));
    expect(got?.agencyId).toBe("oyarbide");
    expect(tried).toEqual(["pomares", "oyarbide"]);
    expect(await pickNext(queue, { filter: presentacion, rules: DEFAULT_RULES, actorId: "yo", now }, async () => false)).toBeNull();
  });

  it("sin filtro, la primera libre de la cola, como antes", async () => {
    expect((await pickNext(queue, { filter: NO_FILTER, rules: DEFAULT_RULES, actorId: "yo", now }, async () => true))?.agencyId).toBe("nueva-1");
  });
});


describe("Etapas comerciales agrupadas sin perder el funnel técnico", () => {
  it("agrupa los nueve pasos técnicos en siete etapas visibles sin repetir ninguno", () => {
    expect(COMMERCIAL_STAGES.map((s) => s.title)).toEqual(["Prospectado", "Contactado", "Interesado", "Demo enviada", "Cuenta creada", "Cuenta activa", "Cliente"]);
    expect(COMMERCIAL_STAGES.flatMap((s) => [...s.technical])).toEqual(FOLLOWUP_STAGES.map((s) => s.key));
    expect(technicalOf("interesado")).toEqual(["sin-demo", "sin-enviar"]);
    expect(technicalOf("demo-enviada")).toEqual(["no-abrio", "sin-interaccion", "sin-cuenta"]);
    expect(technicalOf("cliente")).toEqual([]);
    expect(commercialOf("sin-enviar")).toBe("interesado");
    expect(commercialOf("sin-cuenta")).toBe("demo-enviada");
  });

  it("la API acepta el filtro comercial nuevo y mantiene el formato anterior", () => {
    expect(cleanFilter({ etapaComercial: "demo-enviada" })).toEqual({ ...NO_FILTER, commercial: "demo-enviada" });
    expect(cleanFilter({ etapaComercial: "desconocida" })).toEqual(NO_FILTER);
    expect(isEmptyFilter({ ...NO_FILTER, commercial: "demo-enviada" })).toBe(false);
  });

  it("Contactado no incluye prospectados, Interesado abarca tareas de demo y Demo enviada abarca visitas e interacciones", async () => {
    const queue = [
      agency("A", "no-contactado", "sin_respuesta"),
      agency("B", "no-responde", "confirmo_numero"),
      agency("C", "sin-demo", "interesado"),
      agency("D", "sin-enviar", "interesado"),
      agency("E", "no-abrio", "sin_respuesta"),
      agency("F", "sin-interaccion", "sin_respuesta"),
      agency("G", "sin-cuenta", "sin_respuesta"),
      agency("H", "sin-uso", "sin_respuesta"),
      agency("I", "sin-suscripcion", "sin_respuesta"),
    ];
    const matching = (commercial: "prospectado" | "contactado" | "interesado" | "demo-enviada" | "cuenta-creada" | "cuenta-activa" | "cliente") =>
      queue.filter((q) => matchesFilter(q, { ...NO_FILTER, commercial }, DEFAULT_RULES)).map((q) => q.name);
    expect(matching("prospectado")).toEqual(["A"]);
    expect(matching("contactado")).toEqual(["B"]);
    expect(matching("interesado")).toEqual(["C", "D"]);
    expect(matching("demo-enviada")).toEqual(["E", "F", "G"]);
    expect(matching("cliente")).toEqual([]);
    expect((await pickNext(queue.map((q) => ({ ...q, agencyId: q.name, claim: null })), {
      filter: { ...NO_FILTER, commercial: "contactado" }, rules: DEFAULT_RULES, actorId: "facu", now: "2026-11-09T15:00:00Z",
    }, async () => true))?.agencyId).toBe("B");
  });
});


describe("Filtro de generación confirmada", () => {
  it("distingue imágenes generadas de clics comunes", () => {
    const normal = { ...agency("Normal", "sin-cuenta", "sin_respuesta"), demoGenerated: false };
    const generated = { ...agency("Generó", "sin-cuenta", "sin_respuesta"), demoGenerated: true };
    const panel = { ...agency("Panel", "sin-uso", "sin_respuesta"), demoGenerated: true };
    const list = [normal, generated, panel];
    expect(list.filter((q) => matchesFilter(q, { ...NO_FILTER, commercial: "demo-enviada", demoImage: "generated" }, DEFAULT_RULES)).map((q) => q.name)).toEqual(["Generó"]);
    expect(list.filter((q) => matchesFilter(q, { ...NO_FILTER, commercial: "demo-enviada", demoImage: "interacted" }, DEFAULT_RULES)).map((q) => q.name)).toEqual(["Normal"]);
  });
});

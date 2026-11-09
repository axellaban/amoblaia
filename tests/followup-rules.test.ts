import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { actionLabel, byPriority, nextAction } from "@/lib/followup/plan";
import { DEFAULT_RULES, cleanRule, compatible, outsideWindow, pickRule, type Rule } from "@/lib/followup/rules";

const SITS = ["sin_respuesta", "confirmo_numero", "interesado", "neutro", "pregunta_precios", "mas_adelante", "derivo"];
const ACTS = ["principal", "seguimiento_2", "presentacion", "presentacion_seguimiento", "precios"];
const STAGES = ["no-contactado", "no-responde", "sin-demo", "sin-enviar", "no-abrio", "sin-interaccion", "sin-cuenta", "sin-uso", "sin-suscripcion"];

describe("rules (Fase 3)", () => {
  it("are seeded in the database exactly as in code", () => {
    const sql = readFileSync("supabase/migrations/202612050001_followup_rules.sql", "utf8");
    const rows = [...sql.matchAll(/\('([^']+)', '([^']+)', '\{([^}]*)\}', '([^']+)', ([\d.]+), (null|'[^']+'), (\d+), (true|false), (\d+), (\d+), '\{([^}]*)\}'\)/g)].map((m) => ({
      key: m[1],
      stage: m[2],
      situations: m[3] ? m[3].split(",") : [],
      action: m[4],
      after_hours: Number(m[5]),
      after_action: m[6] === "null" ? null : m[6].slice(1, -1),
      position: Number(m[7]),
      enabled: m[8] === "true",
      hours_from: Number(m[9]),
      hours_to: Number(m[10]),
      days: m[11].split(",").map(Number),
    }));
    expect(rows).toEqual(DEFAULT_RULES);
  });

  it("change a wait without a deploy: the next reading uses it", () => {
    const rules = DEFAULT_RULES.map((r) => (r.key === "no-abrio:principal" ? { ...r, after_hours: 48 } : r));
    expect(nextAction("no-abrio", "sin_respuesta", {}, rules)).toMatchObject({ action: "principal", afterHours: 48 });
    expect(nextAction("no-abrio", "sin_respuesta", {})).toMatchObject({ action: "principal", afterHours: 24 });
  });

  it("skip a rule that is off, and never write to a closed conversation whatever the rules say", () => {
    const off = DEFAULT_RULES.map((r) => (r.key === "no-responde:principal" ? { ...r, enabled: false } : r));
    // With the first follow-up off, the second still needs it: nothing goes out.
    expect(nextAction("no-responde", "sin_respuesta", {}, off).action).toBeNull();
    const greedy: Rule[] = [{ ...DEFAULT_RULES[0], key: "x", stage: "no-responde", situations: [], action: "principal", after_hours: 0, after_action: null, position: 0 }];
    expect(nextAction("no-responde", "rechazo", {}, greedy).action).toBeNull();
    expect(nextAction("no-responde", "interesado", {}, greedy).action).toBeNull();
  });

  it("covers every stage and situation without throwing", () => {
    for (const st of STAGES) for (const si of SITS) for (const a of [{}, { principal: true }, { principal: true, seguimiento_2: true }]) expect(() => pickRule(DEFAULT_RULES, st as Rule["stage"], si as Rule["situations"][number], a)).not.toThrow();
  });

  it("checks the window in Argentina's time", () => {
    const r = { hours_from: 9, hours_to: 19, days: [1, 2, 3, 4, 5, 6] };
    expect(outsideWindow(r, new Date("2026-11-09T12:00:00Z"))).toBeNull();
    expect(outsideWindow(r, new Date("2026-11-09T22:00:00Z"))).toMatch(/lunes a sábado de 9 a 19/);
    expect(outsideWindow({ ...r, days: [1, 2, 3, 4, 5] }, new Date("2026-11-14T15:00:00Z"))).toMatch(/lunes a viernes/);
  });

  it("validate what the panel sends", () => {
    const ok = cleanRule({ stage: "no-abrio", action: "seguimiento_2", situations: ["sin_respuesta", "rechazo"], after_hours: "48", after_action: "principal", position: 50, hours_from: 9, hours_to: 19, days: [1, 2] }, SITS, ACTS, STAGES);
    expect(ok).toMatchObject({ stage: "no-abrio", situations: ["sin_respuesta"], after_hours: 48, days: [1, 2] });
    expect(ok).toMatchObject({ name: null });
    const base = { stage: "no-abrio", action: "principal", after_hours: 1, hours_from: 9, hours_to: 19 };
    expect(cleanRule({ ...base, name: "  Primer   recordatorio " }, SITS, ACTS, STAGES)).toMatchObject({ name: "Primer recordatorio" });
    expect(cleanRule({ ...base, name: "   " }, SITS, ACTS, STAGES)).toMatchObject({ name: null });
    expect(cleanRule({ ...base, name: "x".repeat(81) }, SITS, ACTS, STAGES)).toMatchObject({ error: expect.stringMatching(/80/) });
    expect(cleanRule({ stage: "x", action: "principal" }, SITS, ACTS, STAGES)).toEqual({ error: "Etapa desconocida." });
    expect(cleanRule({ stage: "no-abrio", action: "principal", after_hours: 1000, hours_from: 9, hours_to: 19 }, SITS, ACTS, STAGES)).toMatchObject({ error: expect.stringMatching(/720/) });
    expect(cleanRule({ stage: "no-abrio", action: "principal", after_hours: 1, hours_from: 19, hours_to: 9 }, SITS, ACTS, STAGES)).toMatchObject({ error: expect.stringMatching(/ventana/) });
    expect(cleanRule({ stage: "no-abrio", action: "principal", after_hours: 1, hours_from: 9, hours_to: 19, after_action: "principal" }, SITS, ACTS, STAGES)).toMatchObject({ error: expect.stringMatching(/propio paso/) });
  });
});

describe("a promised demo", () => {
  it("goes first of the queue, the oldest promise first", () => {
    const q = (name: string, extra: Record<string, unknown> = {}) => ({ name, group: "respuestas" as const, score: 99, since: "2026-11-01", ...extra });
    const list = [q("respuesta"), q("demo nueva", { group: "demos", score: 1, promisedAt: "2026-11-09T12:20:00Z" }), q("demo vieja", { group: "demos", score: 1, promisedAt: "2026-11-09T12:00:00Z" })].sort(byPriority);
    expect(list.map((x) => x.name)).toEqual(["demo vieja", "demo nueva", "respuesta"]);
  });
});

describe("incompatible rules (acción fuera de su etapa)", () => {
  it("the engine never picks one: in No contactado, Presentación and Precios are skipped, Saludo goes", () => {
    // Confirmó número en «No contactado»: la regla de Presentación está encendida en la base, pero no es de esta etapa.
    expect(pickRule(DEFAULT_RULES, "no-contactado", "confirmo_numero", {}).action).toBeNull();
    expect(nextAction("no-contactado", "pregunta_precios", {}).action).toBeNull();
    // Sin respuesta sigue yendo al Saludo, que es la acción válida.
    expect(nextAction("no-contactado", "sin_respuesta", {})).toMatchObject({ action: "principal" });
  });

  it("a rule whose previous step is incompatible does not run either", () => {
    const rules = [...DEFAULT_RULES, { ...DEFAULT_RULES[0], key: "x", stage: "no-abrio" as const, situations: [], action: "seguimiento_2" as const, after_action: "precios" as const, position: 1 }];
    expect(pickRule(rules, "no-abrio", "sin_respuesta", {}).action).not.toBe("seguimiento_2");
  });

  it("the panel can keep one off, but cannot turn it on or create it", () => {
    const base = { stage: "no-contactado", situations: ["confirmo_numero"], after_hours: 0, after_action: null, position: 10, hours_from: 9, hours_to: 18, days: [1, 2, 3, 4, 5, 6] };
    expect(cleanRule({ ...base, action: "presentacion", enabled: false }, SITS, ACTS, STAGES)).toMatchObject({ action: "presentacion", enabled: false });
    expect(cleanRule({ ...base, action: "presentacion", enabled: true }, SITS, ACTS, STAGES)).toMatchObject({ error: expect.stringMatching(/no se puede activar/) });
    expect(cleanRule({ ...base, action: "principal", enabled: true, after_action: "precios" }, SITS, ACTS, STAGES)).toMatchObject({ error: expect.stringMatching(/paso previo/) });
  });

  it("compatibility follows the stage's own actions", () => {
    expect(compatible("no-contactado", "principal")).toBe(true);
    expect(compatible("no-contactado", "presentacion")).toBe(false);
    expect(compatible("no-responde", "precios")).toBe(true);
    expect(compatible("sin-demo", "seguimiento_2")).toBe(false);
  });
});


describe("Generación real frente a interacción", () => {
  it("no ejecuta una regla especial antes de una generación confirmada", () => {
    const rule = { ...DEFAULT_RULES.find((x) => x.key === "no-abrio:principal")!, key: "solo-generacion", position: 1, min_demo_activity_level: 3 };
    expect(pickRule([rule], "no-abrio", "sin_respuesta", {}, false).action).toBeNull();
    expect(pickRule([rule], "no-abrio", "sin_respuesta", {}, true).action).toBe("principal");
  });
  it("preserva la estructura sembrada históricamente", () => {
    expect(DEFAULT_RULES.every((r) => r.min_demo_activity_level === undefined)).toBe(true);
  });
});

describe("Acciones de tareas internas en Follow-up", () => {
  it("presenta los dos pasos de Interesado como acciones distintas", () => {
    expect(actionLabel("sin-demo", "principal")).toBe("Crear demo");
    expect(actionLabel("sin-enviar", "principal")).toBe("Enviar demo");
    expect(actionLabel("no-contactado", "principal")).toBe("Saludo");
    expect(actionLabel("no-responde", "principal")).toBe("Saludo sin respuesta");
  });
  it("conserva la compatibilidad de acciones existentes sin crear una nueva clave técnica", () => {
    expect(compatible("sin-demo", "principal")).toBe(true);
    expect(compatible("sin-enviar", "principal")).toBe(true);
    expect(compatible("no-abrio", "principal")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { leadStateOf, leadsView, type LeadInput } from "../src/lib/followup/leads";

// La pestaña «Leads»: el estado de cada lead en la cola y las reglas activas que dejaron de salir.
// Datos sintéticos.
const NOW = new Date("2026-11-19T15:00:00Z");
const base = (o: Partial<LeadInput> = {}): LeadInput => ({
  agencyId: "a1", name: "Inmobiliaria Uno", stage: "sin-cuenta", situation: "interesado",
  action: "principal", actionLabel: "Envío panel", actionReason: null, ruleKey: "sin-cuenta:principal",
  blocked: null, handoffTo: null, dueAt: null, snoozedUntil: null, claim: null, owner: null, execution: null, ...o,
});
const stages = [
  { key: "sin-interaccion", title: "Visitó, sin interactuar", goal: "Con interacción" },
  { key: "sin-cuenta", title: "Interactuó, sin cuenta", goal: "Cuenta creada" },
];
const rules = [
  { key: "sin-cuenta:principal", name: "Envío panel", stage: "sin-cuenta" as const, action: "principal" as const, enabled: true },
  { key: "sin-interaccion:principal", name: "Recordatorio demo interactiva", stage: "sin-interaccion" as const, action: "principal" as const, enabled: true },
];

describe("estado de cada lead", () => {
  it("separa lo que espera al equipo, una respuesta, una toma, lo programado y lo bloqueado", () => {
    expect(leadStateOf(base({ blocked: "Pasada a Facu. Retomar para volver a ejecutar.", handoffTo: "Facu" }), NOW)).toMatchObject({ state: "equipo", who: "Facu" });
    expect(leadStateOf(base({ blocked: "Asignada a Facu: tiene una respuesta que no se resuelve con el script." }), NOW)).toMatchObject({ state: "equipo", who: "Facu" });
    expect(leadStateOf(base({ blocked: "Tiene una respuesta sin clasificar en la bandeja." }), NOW).state).toBe("respuesta");
    expect(leadStateOf(base({ claim: { by: "Sofi", until: "2026-11-19T15:05:00Z" } }), NOW)).toMatchObject({ state: "tomada", who: "Sofi" });
    expect(leadStateOf(base({ dueAt: "2026-11-20T15:00:00Z", blocked: "Programada para el 20/11." }), NOW).state).toBe("programada");
    expect(leadStateOf(base({ blocked: "Sin WhatsApp: cargalo en la ficha o marcala «Sin WhatsApp»." }), NOW).state).toBe("bloqueada");
    expect(leadStateOf(base(), NOW).state).toBe("lista");
    expect(leadStateOf(base({ execution: { status: "sent", at: "2026-11-18T12:00:00Z" } }), NOW).state).toBe("hecha");
    expect(leadStateOf(base({ action: null, actionReason: "Secuencia terminada." }), NOW)).toMatchObject({ state: "sin_accion", reason: "Secuencia terminada." });
  });
});

describe("la vista de Leads", () => {
  const items = [
    base({ agencyId: "a1", blocked: "Pasada a Facu. Retomar para volver a ejecutar.", handoffTo: "Facu" }),
    base({ agencyId: "a2", blocked: "Asignada a Facu: tiene una respuesta que no se resuelve con el script." }),
    base({ agencyId: "a3", dueAt: "2026-11-20T15:00:00Z", blocked: "Programada para el 20/11." }),
    base({ agencyId: "a4", stage: "sin-interaccion", ruleKey: "sin-interaccion:principal" }),
  ];
  const executions = [
    { agency_id: "a1", stage: "sin-interaccion", action: "principal", status: "sent", sent_at: "2026-11-12T14:00:00Z" },
    { agency_id: "a9", stage: "sin-cuenta", action: "principal", status: "sent", sent_at: "2026-11-12T16:00:00Z" },
    { agency_id: "a4", stage: "sin-interaccion", action: "principal", status: "opened", sent_at: null },
  ];
  const queueDays = ["2026-11-17", "2026-11-18", "2026-11-19"].map((day) => ({ day, agency_id: "a4", stage: "sin-interaccion", action: "principal", state: "lista" as const }));
  const view = leadsView({ items, executions, rules, queueDays, stages, now: NOW });

  it("cuenta cada etapa por estado y da la última regla que le salió a cada lead", () => {
    const panel = view.stages.find((s) => s.key === "sin-cuenta")!;
    expect(panel.count).toBe(3);
    expect(panel.states).toEqual({ equipo: 2, programada: 1 });
    expect(view.rows.find((r) => r.agencyId === "a1")!.lastRule).toEqual({ label: "Recordatorio demo interactiva", stage: "sin-interaccion", at: "2026-11-12T14:00:00Z" });
    expect(view.rows.find((r) => r.agencyId === "a2")!.lastRule).toBeNull();
  });

  it("avisa la regla activa con leads que no sale hace más de 3 días, y las listas que nadie mandó", () => {
    expect(view.alerts.find((a) => a.kind === "regla" && a.ruleKey === "sin-cuenta:principal")).toMatchObject({ kind: "regla", ruleKey: "sin-cuenta:principal", days: 7, pending: 3, states: { equipo: 2, programada: 1 } });
    // «Recordatorio demo interactiva» salió por última vez el 12/11 y tiene un lead listo: también se avisa.
    expect(view.alerts.find((a) => a.kind === "regla" && a.ruleKey === "sin-interaccion:principal")).toMatchObject({ days: 7, pending: 1 });
    expect(view.alerts.find((a) => a.kind === "listas")).toEqual({ kind: "listas", stage: "sin-interaccion", count: 1, oldest: 3 });
    expect(view.rows.find((r) => r.agencyId === "a4")!.days).toBe(3);
    // Primero las reglas (la que lleva más días sin salir primero); al final, las listas.
    expect(view.alerts.map((a) => (a.kind === "regla" ? a.ruleKey : a.kind))).toEqual(["sin-cuenta:principal", "sin-interaccion:principal", "listas"]);
    const never = leadsView({ items, executions: [], rules, queueDays, stages, now: NOW });
    expect(never.alerts.find((a) => a.kind === "regla" && a.ruleKey === "sin-cuenta:principal")).toMatchObject({ days: null });
  });

  it("una regla apagada o sin leads no se avisa", () => {
    const off = leadsView({ items: items.slice(0, 3), executions, rules: [{ ...rules[0], enabled: false }, rules[1]], queueDays: null, stages, now: NOW });
    expect(off.alerts).toEqual([]);
  });
});

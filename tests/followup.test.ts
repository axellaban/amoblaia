import { describe, expect, it } from "vitest";
import { AGENCY_STEPS } from "@/lib/agency/demo-funnel";
import { FOLLOWUP_STAGES, byScore, cleanVersion, fillMessage, lastAction, personName, placement, linksNeeded, missingVariables, pct, stageOf, versionFor, versionStats, type FollowupExecution, type FollowupVersion } from "@/lib/followup/stages";

const base = { lost: false, test: false, suppressed: false, pendingProspect: false };
const v = (id: string, version: number, status: FollowupVersion["status"], body = "Hola {{decisor}}"): FollowupVersion => ({
  id,
  stage: "no-responde",
  version,
  channel: "whatsapp",
  trigger_label: "",
  body,
  ctas: ["whatsapp"],
  status,
  created_at: "2026-11-01T00:00:00Z",
  status_at: "2026-11-01T00:00:00Z",
  notes: "",
  edited_at: null,
});
const ex = (agency: string, version: string, status: FollowupExecution["status"], from = 0, at = "2026-11-02T00:00:00Z"): FollowupExecution => ({
  id: `${agency}-${version}`,
  version_id: version,
  stage: "no-responde",
  agency_id: agency,
  from_step: from,
  status,
  reason: null,
  created_at: at,
  updated_at: at,
  sent_at: status === "sent" ? at : null,
});

describe("follow-up stages", () => {
  it("has one stage per funnel step that has a next one, plus «No contactado»", () => {
    expect(FOLLOWUP_STAGES.map((s) => s.step)).toEqual([-1, 0, 1, 2, 3, 4, 5, 6, 7]);
    expect(FOLLOWUP_STAGES.at(-1)!.goal).toBe("Suscripción");
    expect(AGENCY_STEPS.length).toBe(9);
  });

  it("puts an agency in the stage of its highest step, like the orange part of the funnel", () => {
    expect(stageOf({ ...base, reached: 0 })).toBe("no-responde");
    expect(stageOf({ ...base, reached: 2 })).toBe("sin-enviar");
    expect(stageOf({ ...base, reached: 7 })).toBe("sin-suscripcion");
    // Subscribed: nothing after it.
    expect(stageOf({ ...base, reached: 8 })).toBeNull();
  });

  it("lists a prospect never contacted as «No contactado», and nothing for an agency outside prospecting", () => {
    expect(stageOf({ ...base, reached: null, pendingProspect: true })).toBe("no-contactado");
    expect(stageOf({ ...base, reached: null })).toBeNull();
  });

  it("leaves out lost, test and suppressed agencies", () => {
    expect(stageOf({ ...base, reached: 0, lost: true })).toBeNull();
    expect(stageOf({ ...base, reached: 3, test: true })).toBeNull();
    expect(stageOf({ ...base, reached: null, pendingProspect: true, suppressed: true })).toBeNull();
  });
});

describe("version for an agency", () => {
  it("is the active one without a test", () => {
    expect(versionFor("a", [v("1", 1, "archived"), v("2", 2, "active")])!.id).toBe("2");
  });

  it("splits agencies about half and half with a test, always the same for each one", () => {
    const vs = [v("2", 2, "active"), v("3", 3, "test")];
    const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const test = ids.filter((id) => versionFor(id, vs)!.id === "3").length;
    expect(test).toBeGreaterThan(70);
    expect(test).toBeLessThan(130);
    expect(ids.map((id) => versionFor(id, vs)!.id)).toEqual(ids.map((id) => versionFor(id, vs)!.id));
  });

  it("keeps the version an agency started with while it is still offered", () => {
    const vs = [v("2", 2, "active"), v("3", 3, "test")];
    const other = versionFor("x", vs)!.id === "2" ? "3" : "2";
    expect(versionFor("x", vs, [ex("x", other, "opened")])!.id).toBe(other);
    // Archived since: the agency gets the current ones.
    expect(versionFor("x", [v("2", 2, "active")], [ex("x", "1", "sent")])!.id).toBe("2");
  });
});

describe("messages", () => {
  it("fills the variables and leaves a missing one visible", () => {
    expect(fillMessage("Hola {{decisor}}, mirá {{demo}}", { decisor: "Laura", demo: "https://habitaia.app/demo/x" })).toBe("Hola Laura, mirá https://habitaia.app/demo/x");
    const half = fillMessage("Hola {{decisor}}, mirá {{ demo }}", { decisor: "Laura", demo: " " });
    expect(missingVariables(half)).toEqual(["demo"]);
  });

  it("drops {{decisor}} with its comma when there is no name", () => {
    expect(fillMessage("Hola {{decisor}}, soy {{sdr}} de habita.", { sdr: "Facu" })).toBe("Hola, soy Facu de habita.");
    expect(fillMessage("{{decisor}}, te dejo {{demo}}", { demo: "x" })).toBe("Te dejo x");
    expect(fillMessage("{{decisor}}, ¿pudiste verla?", { decisor: "Laura" })).toBe("Laura, ¿pudiste verla?");
  });

  it("only takes a real first name as the decisor, never the sheet's categories", () => {
    for (const v of ["Por confirmar", "Familiar (apellido)", "Dueño/a con nombre propio", "Marca comercial", "Franquicia / corporativa", "", null, "ventas@x.com"]) expect(personName(v)).toBeNull();
    expect(personName("Laura Bustos")).toBe("Laura");
    expect(personName("  María José ")).toBe("María");
  });

  it("knows which links a version needs, from its text and its CTAs", () => {
    expect(linksNeeded({ body: "{{demo}}", ctas: [] })).toEqual({ demo: true, panel: false });
    expect(linksNeeded({ body: "Hola", ctas: ["panel"] })).toEqual({ demo: false, panel: true });
  });

  it("rejects an empty text, an unknown variable and an unknown stage", () => {
    expect(cleanVersion({ stage: "no-responde", channel: "whatsapp", body: " " })).toEqual({ error: "Escribí la next best action." });
    expect("error" in cleanVersion({ stage: "no-responde", channel: "whatsapp", body: "Hola {{nombre}}" })).toBe(true);
    expect("error" in cleanVersion({ stage: "otra", channel: "whatsapp", body: "Hola" })).toBe(true);
    expect(cleanVersion({ stage: "sin-uso", channel: "whatsapp", body: " Tu panel: {{panel}} ", ctas: ["panel", "nada"], status: "test", trigger: " 2 días " })).toEqual({
      stage: "sin-uso",
      channel: "whatsapp",
      trigger: "2 días",
      body: "Tu panel: {{panel}}",
      ctas: ["panel"],
      status: "test",
      notes: "",
    });
  });
});

describe("version numbers", () => {
  it("counts sent executions and the agencies that went past their step since", () => {
    const vs = [v("1", 1, "archived"), v("2", 2, "active")];
    const executions = [ex("a", "1", "sent", 0), ex("b", "1", "sent", 0), ex("c", "2", "sent", 0), ex("d", "2", "opened", 0), ex("e", "2", "failed", 0)];
    const now = new Map([
      ["a", 1],
      ["b", 0],
      ["c", 4],
      ["d", 3],
    ]);
    const [one, two] = versionStats(vs, executions, now);
    expect(one).toMatchObject({ executions: 2, conversions: 1, rate: 0.5, smallSample: true });
    // Opened and failed are not executions, even when the agency moved on.
    expect(two).toMatchObject({ executions: 1, conversions: 1, rate: 1, opened: 1 });
  });

  it("counts «No contactado» as converted once the agency is contacted", () => {
    const [s] = versionStats([v("1", 1, "active")], [ex("a", "1", "sent", -1), ex("b", "1", "sent", -1)], new Map([["a", 0], ["b", -1]]));
    expect(s).toMatchObject({ executions: 2, conversions: 1 });
  });

  it("has no rate without executions", () => {
    expect(versionStats([v("1", 1, "active")], [], new Map())[0].rate).toBeNull();
    expect(pct(null)).toBe("—");
    expect(pct(0.125)).toBe("13%");
    expect(pct(0.045)).toBe("4,5%");
  });
});

describe("corrected stage", () => {
  it("holds while the funnel says the same, and the funnel rules again when something real happens", () => {
    const funnel = { reached: 0, stage: "no-responde" as const };
    expect(placement(funnel, null)).toEqual({ stage: "no-responde", step: 0, manual: false });
    // The extension saw in the chat that it is interested: corrected to «Interesado, sin demo».
    expect(placement(funnel, { stage: "sin-demo", step: 0 })).toEqual({ stage: "sin-demo", step: 1, manual: true });
    // Out of Follow-up (lost, a duplicate).
    expect(placement(funnel, { stage: "fuera", step: 0 })).toMatchObject({ stage: null, manual: true });
    // Later it got its demo created: the correction no longer applies.
    expect(placement({ reached: 2, stage: "sin-enviar" }, { stage: "sin-demo", step: 0 })).toEqual({ stage: "sin-enviar", step: 2, manual: false });
    // Added by hand (no funnel yet).
    expect(placement({ reached: null, stage: null }, { stage: "no-contactado", step: -1 })).toEqual({ stage: "no-contactado", step: -1, manual: true });
  });

  it("orders by score from highest to lowest, without a score last", () => {
    const q = (score: number | null, wa: string | null = "549", status: string | null = null, since = "2026-11-01") => ({ score, wa, since, execution: status ? { status } : null });
    const list = [q(null), q(40), q(90), q(70, null), q(70)].sort(byScore);
    expect(list.map((x) => `${x.score}:${x.wa ?? "-"}`)).toEqual(["90:549", "70:549", "70:-", "40:549", "null:549"]);
  });
});

describe("last action", () => {
  const agency = { lastActivity: null, createdAt: "2026-10-20T10:00:00Z" };
  const versions = [{ id: "v2", version: 2, stage: "no-responde" as const }];
  it("is the latest of our sends and what the agency did", () => {
    expect(
      lastAction(
        { ...agency, lastActivity: { at: "2026-11-05T10:00:00Z", text: "Vio la demo" } },
        { created_at: "2026-10-28T00:00:00Z" },
        false,
        versions,
        [{ version_id: "v2", status: "sent", reason: null, updated_at: "2026-11-06T12:00:00Z" }],
        [{ status: "sent", sent_at: "2026-11-01T12:00:00Z", step: 1 }],
      ),
    ).toEqual({ text: "Follow-up «Contactado, no responde» V2: enviado", at: "2026-11-06T12:00:00Z" });
    expect(lastAction(agency, undefined, false, versions, [{ version_id: "v2", status: "failed", reason: "Sin WhatsApp", updated_at: "2026-11-06T12:00:00Z" }], []).text).toBe(
      "Follow-up «Contactado, no responde» V2: no se envió (Sin WhatsApp)",
    );
    expect(lastAction(agency, undefined, false, [], [], [{ status: "sent", sent_at: "2026-11-02T00:00:00Z", step: 2 }]).text).toBe("Seguimiento enviado");
  });

  it("without anything, says when it entered the list", () => {
    expect(lastAction(agency, { created_at: "2026-10-28T00:00:00Z" }, false, [], [], [])).toEqual({ text: "Cargada en prospección", at: "2026-10-28T00:00:00Z" });
    expect(lastAction(agency, undefined, true, [], [], []).text).toBe("Agregada a mano");
  });
});

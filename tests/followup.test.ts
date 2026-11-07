import { describe, expect, it } from "vitest";
import { AGENCY_STEPS } from "@/lib/agency/demo-funnel";
import { FOLLOWUP_STAGES, cleanVersion, fillMessage, personName, linksNeeded, missingVariables, pct, stageOf, versionFor, versionStats, type FollowupExecution, type FollowupVersion } from "@/lib/followup/stages";

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

import { describe, expect, it } from "vitest";
import { lastActionOf } from "@/lib/followup/stages";

const exec = (status: "opened" | "sent" | "failed", at: string, reason: string | null = null) => ({
  stage: "no-responde" as const,
  status,
  reason,
  updated_at: at,
  sent_at: status === "sent" ? at : null,
  version_id: "v2",
});

describe("lastActionOf", () => {
  it("takes the most recent of Follow-up, Adquisición and the agency", () => {
    const a = lastActionOf({
      executions: [exec("sent", "2026-11-05T10:00:00Z")],
      versions: [{ id: "v2", version: 2 }],
      attempts: [{ status: "sent", sent_at: "2026-11-03T10:00:00Z", step: 2 }],
      activity: { at: "2026-11-04T10:00:00Z", text: "Abrió la demo" },
    });
    expect(a).toEqual({ at: "2026-11-05T10:00:00Z", text: "Follow-up enviado: Contactado, no responde (V2)", source: "followup" });
  });

  it("uses the Adquisición send or the agency's activity when they are newer", () => {
    expect(lastActionOf({ executions: [], attempts: [{ status: "sent", sent_at: "2026-11-06T10:00:00Z", step: 1 }], activity: { at: "2026-11-04T10:00:00Z", text: "Abrió la demo" } })).toMatchObject({
      text: "Mensaje 1 de la secuencia (Adquisición)",
      source: "adquisicion",
    });
    expect(lastActionOf({ executions: [exec("sent", "2026-11-01T00:00:00Z")], attempts: [], activity: { at: "2026-11-02T00:00:00Z", text: "Creó su cuenta" } })).toMatchObject({
      text: "Creó su cuenta",
      source: "inmobiliaria",
    });
  });

  it("ignores opened executions and unsent attempts, and says why one failed", () => {
    expect(lastActionOf({ executions: [exec("opened", "2026-11-09T00:00:00Z")], attempts: [{ status: "prepared", sent_at: null, step: 1 }], activity: null })).toBeNull();
    expect(lastActionOf({ executions: [exec("failed", "2026-11-09T00:00:00Z", "Número equivocado")], attempts: [], activity: null })?.text).toBe("Follow-up no salió: Número equivocado");
  });
});

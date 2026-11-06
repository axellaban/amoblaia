import { describe, expect, it } from "vitest";
import { isProposalAnswer } from "@/lib/prospecting/metrics";
import type { ProspectEvent } from "@/lib/prospecting/types";

const ev = (over: Partial<ProspectEvent>): ProspectEvent => ({
  id: "e",
  account_id: "a",
  attempt_id: null,
  type: "reply",
  occurred_at: "2026-11-03T15:00:00Z",
  precision: "day",
  channel: "whatsapp",
  human: true,
  source: "import",
  details: {},
  corrected: false,
  ...over,
});

describe("«Respondieron la propuesta» (/api/metricas)", () => {
  it("is an interest, a «not interested» or a reply marked as an answer to the proposal (the sheet's «Neutro»)", () => {
    expect(isProposalAnswer(ev({ type: "interest", human: null }))).toBe(true);
    expect(isProposalAnswer(ev({ type: "not_interested" }))).toBe(true);
    expect(isProposalAnswer(ev({ details: { sheet: true, proposal: true } }))).toBe(true);
  });
  it("a reply to the greeting, an auto-reply or a corrected event are not", () => {
    expect(isProposalAnswer(ev({ details: { sheet: true } }))).toBe(false);
    expect(isProposalAnswer(ev({ human: false, details: { proposal: true } }))).toBe(false);
    expect(isProposalAnswer(ev({ type: "interest", corrected: true }))).toBe(false);
  });
});

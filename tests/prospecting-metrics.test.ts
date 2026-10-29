import { describe, expect, it } from "vitest";
import { messageReport, summarize, today } from "@/lib/prospecting/metrics";
import type { Dataset, OutreachAttempt, ProspectAccount, ProspectEvent } from "@/lib/prospecting/types";

// Synthetic, clearly fictitious data: only the rules are under test.
const NOW = "2026-11-30T15:00:00-03:00";
let n = 0;
const uid = () => `id-${++n}`;

function account(over: Partial<ProspectAccount> = {}): ProspectAccount {
  return {
    id: uid(), agency_id: uid(), name: `Cuenta sintética ${n}`, website: null, linked: false, campaign: "c1", sdr: "SDR A",
    priority: null, score: 50, score_components: {}, scoring_version: null, zone: "Zona 1", decision_maker: null,
    decision_maker_role: null, stage: "sent", lost_reason: null, next_action: null, due_at: null, due_precision: "time",
    version: 1, created_at: "2026-10-01T10:00:00-03:00", imported: false, demos: 0, suppressed: false,
    contacts: [{ id: uid(), channel: "whatsapp", address: "+5490000000000", address_original: null, person_name: null,
      is_decision_maker: false, confidence: null, source: null, needs_review: false, review_reason: null, verified: true,
      invalid: false, is_primary: true, blocked: null }],
    ...over,
  };
}
function send(acc: ProspectAccount, at: string, over: Partial<OutreachAttempt> = {}): OutreachAttempt {
  return {
    id: uid(), account_id: acc.id, contact_id: null, campaign: "c1", step: 1, ordinal: 1, template_version_id: "v2",
    template_id: "t1", is_custom: false, variant_label: "Corto v2", channel: "whatsapp", recipient: null, sender: "SDR A",
    subject: null, body: "x", status: "sent", status_reason: null, prepared_at: at, opened_at: at, lock_holder: null,
    lock_expires_at: null, sent_at: at, sent_precision: "time", verification_method: "channel_observed", legacy: false, version: 3,
    ...over,
  };
}
function event(acc: ProspectAccount, type: ProspectEvent["type"], at: string, over: Partial<ProspectEvent> = {}): ProspectEvent {
  return { id: uid(), account_id: acc.id, attempt_id: null, type, occurred_at: at, precision: "time", channel: "whatsapp",
    human: type === "reply" ? true : null, source: "manual", details: {}, corrected: false, ...over };
}
function ds(accounts: ProspectAccount[], attempts: OutreachAttempt[], events: ProspectEvent[] = []): Dataset {
  return { now: NOW, settings: { version: 1, message_window_days: 7, account_window_days: 30, small_sample: 30 }, accounts, attempts, events, templates: [], last_import: null };
}

describe("Account funnel", () => {
  it("counts confirmed sends only: opening a chat, failures and bounces are not sends", () => {
    const a = account(), b = account(), c = account(), d = account();
    const data = ds([a, b, c, d], [
      send(a, "2026-10-02T10:00:00-03:00"),
      send(b, "2026-10-02T10:00:00-03:00", { status: "opened", sent_at: null }),
      send(c, "2026-10-02T10:00:00-03:00", { status: "failed", sent_at: null }),
      send(d, "2026-10-02T10:00:00-03:00", { status: "bounced" }),
    ]);
    const s = summarize(data, {});
    expect(s.prospected).toBe(4);
    expect(s.sent).toBe(1);
    expect(s.messages).toBe(1);
  });

  it("an account reached by WhatsApp and email counts once and its reply once", () => {
    const a = account();
    const data = ds([a], [
      send(a, "2026-10-02T10:00:00-03:00"),
      send(a, "2026-10-03T10:00:00-03:00", { channel: "email", step: 2, template_version_id: "e1", variant_label: "Mail v1" }),
    ], [event(a, "reply", "2026-10-04T10:00:00-03:00", { channel: "email" })]);
    const s = summarize(data, {});
    expect(s.sent).toBe(1);
    expect(s.messages).toBe(2);
    expect(s.replied.mature).toEqual({ num: 1, den: 1, rate: 1 });
    const m = messageReport(data, {});
    expect(m.global).toEqual({ exposed: 1, replied: 1 });
    const wa = m.channels.find((c) => c.channel === "whatsapp")!;
    const em = m.channels.find((c) => c.channel === "email")!;
    expect([wa.exposed, em.exposed]).toEqual([1, 1]); // bases overlap: not added up
    expect(em.replies.num).toBe(1); // last touch
    expect(wa.replies.num).toBe(0);
    expect(wa.assisted).toBe(1);
  });

  it("losing the account later keeps its reply and interest", () => {
    const a = account({ stage: "lost", lost_reason: "Otro proveedor" });
    const data = ds([a], [send(a, "2026-10-02T10:00:00-03:00")], [
      event(a, "reply", "2026-10-03T10:00:00-03:00"),
      event(a, "interest", "2026-10-03T11:00:00-03:00"),
      event(a, "lost", "2026-10-20T11:00:00-03:00"),
    ]);
    const s = summarize(data, {});
    expect(s.replied.observed).toBe(1);
    expect(s.interested.observed).toBe(1);
    expect(s.lossReasons).toEqual([["Otro proveedor", 1]]);
  });

  it("keeps recent sends in observation, out of mature rates, and reports late replies apart", () => {
    const old = account(), recent = account(), late = account();
    const data = ds([old, recent, late], [
      send(old, "2026-10-02T10:00:00-03:00"),
      send(recent, "2026-11-25T10:00:00-03:00"),
      send(late, "2026-10-01T10:00:00-03:00"),
    ], [
      event(old, "reply", "2026-10-05T10:00:00-03:00"),
      event(recent, "reply", "2026-11-26T10:00:00-03:00"),
      event(late, "reply", "2026-11-20T10:00:00-03:00"),
    ]);
    const s = summarize(data, {});
    expect(s.sent).toBe(3);
    expect(s.observing).toBe(1);
    expect(s.replied.mature).toEqual({ num: 1, den: 2, rate: 0.5 });
    expect(s.replied.observed).toBe(2);
    expect(s.replied.late).toBe(1);
  });

  it("filters the cohort by first send and its numerators belong to that cohort", () => {
    const early = account(), later = account({ sdr: "SDR B" });
    const data = ds([early, later], [send(early, "2026-10-02T10:00:00-03:00"), send(later, "2026-10-12T10:00:00-03:00")]);
    expect(summarize(data, { from: "2026-10-01", to: "2026-10-05" }).sent).toBe(1);
    expect(summarize(data, { sdr: "SDR B" }).sent).toBe(1);
    expect(summarize(data, { sdr: "SDR B", from: "2026-10-01", to: "2026-10-05" }).sent).toBe(0);
    // Prospected is the current base of the scope, not the cohort.
    expect(summarize(data, { from: "2026-10-01", to: "2026-10-05" }).prospected).toBe(2);
  });

  it("does not measure activation or purchase without a verified link", () => {
    const a = account(), b = account({ linked: true });
    const data = ds([a, b], [send(a, "2026-10-02T10:00:00-03:00"), send(b, "2026-10-02T10:00:00-03:00")], [
      event(b, "activated", "2026-10-10T10:00:00-03:00", { source: "server" }),
    ]);
    const s = summarize(data, {});
    expect(s.linked).toBe(1);
    expect(s.activated.mature).toEqual({ num: 1, den: 1, rate: 1 });
  });

  it("a corrected reply and an auto-reply are not replies", () => {
    const a = account();
    const data = ds([a], [send(a, "2026-10-02T10:00:00-03:00")], [
      event(a, "reply", "2026-10-03T10:00:00-03:00", { corrected: true }),
      event(a, "auto_reply", "2026-10-03T10:00:00-03:00", { human: false }),
    ]);
    expect(summarize(data, {}).replied.observed).toBe(0);
  });
});

describe("Message report", () => {
  it("sent v2 then v3: a reply after v3 credits v3 and v2 assists; nothing is double counted", () => {
    const a = account();
    const v2 = send(a, "2026-10-02T10:00:00-03:00");
    const v3 = send(a, "2026-10-05T10:00:00-03:00", { step: 2, template_version_id: "v3", variant_label: "Demo propia v3" });
    const m = messageReport(ds([a], [v2, v3], [event(a, "reply", "2026-10-06T10:00:00-03:00")]), {});
    const row = (label: string) => m.rows.find((r) => r.label === label)!;
    expect(row("Corto v2")).toMatchObject({ base: 1, replies: 0, assists: 1 });
    expect(row("Demo propia v3")).toMatchObject({ base: 1, replies: 1 });
  });

  it("a reply before v3 belongs to v2; the later message is not in the follow-up base", () => {
    const a = account();
    const v2 = send(a, "2026-10-02T10:00:00-03:00");
    const v3 = send(a, "2026-10-05T10:00:00-03:00", { step: 2, template_version_id: "v3", variant_label: "Demo propia v3" });
    const m = messageReport(ds([a], [v2, v3], [event(a, "reply", "2026-10-03T10:00:00-03:00")]), {});
    expect(m.rows.find((r) => r.label === "Corto v2")).toMatchObject({ base: 1, replies: 1 });
    expect(m.rows.find((r) => r.label === "Demo propia v3")).toMatchObject({ confirmed: 1, base: 0, replies: 0 });
  });

  it("custom and legacy (unknown variant) messages never mix with template versions", () => {
    const a = account(), b = account(), c = account();
    const m = messageReport(ds([a, b, c], [
      send(a, "2026-10-02T10:00:00-03:00"),
      send(b, "2026-10-02T10:00:00-03:00", { template_version_id: null, is_custom: true, variant_label: "Personalizado" }),
      send(c, "2026-10-02T00:00:00-03:00", { template_version_id: null, variant_label: null, channel: "unknown", legacy: true, sent_precision: "day" }),
    ]), {});
    expect(m.rows.map((r) => r.variant).sort()).toEqual(["custom", "template", "unknown"]);
    expect(m.coverage).toEqual({ template: 1, custom: 1, unknown: 1 });
  });

  it("leaves a same-day reply to a day-precision legacy send unattributed, keeping the account result", () => {
    const a = account();
    const data = ds([a], [send(a, "2026-10-02T00:00:00-03:00", { sent_precision: "day", legacy: true, channel: "unknown", template_version_id: null, variant_label: null })], [
      event(a, "reply", "2026-10-02T18:00:00-03:00"),
    ]);
    const m = messageReport(data, {});
    expect(m.unattributed.ambiguous).toBe(1);
    expect(m.rows[0].replies).toBe(0);
    expect(summarize(data, {}).replied.observed).toBe(1);
  });

  it("several replies to one message credit it once; late replies are separate", () => {
    const a = account(), b = account();
    const m = messageReport(ds([a, b], [send(a, "2026-10-02T10:00:00-03:00"), send(b, "2026-10-02T10:00:00-03:00")], [
      event(a, "reply", "2026-10-03T10:00:00-03:00"),
      event(a, "reply", "2026-10-04T10:00:00-03:00"),
      event(b, "reply", "2026-10-20T10:00:00-03:00"),
    ]), {});
    expect(m.rows[0]).toMatchObject({ base: 2, replies: 1, lateReplies: 1, small: true });
    expect(m.unattributed.late).toBe(1);
  });

  it("keeps recent sends out of the denominator while observing", () => {
    const a = account();
    const m = messageReport(ds([a], [send(a, "2026-11-28T10:00:00-03:00")]), {});
    expect(m.rows[0]).toMatchObject({ confirmed: 1, base: 0, observing: 1 });
  });
});

describe("Para hoy", () => {
  it("orders overdue, then unanswered replies, then new accounts by score, each with its reason", () => {
    const fresh = account({ stage: "pending", score: 90 });
    const freshLow = account({ stage: "pending", score: 40 });
    const overdue = account({ due_at: "2026-11-29T10:00:00-03:00", next_action: "Llamar" });
    const replied = account({ stage: "conversation" });
    const lost = account({ stage: "lost", due_at: "2026-11-01T10:00:00-03:00" });
    const data = ds([fresh, freshLow, overdue, replied, lost], [send(overdue, "2026-11-01T10:00:00-03:00"), send(replied, "2026-11-01T10:00:00-03:00")], [
      event(replied, "reply", "2026-11-02T10:00:00-03:00"),
    ]);
    const t = today(data, {});
    expect(t.map((i) => i.account.id)).toEqual([overdue.id, replied.id, fresh.id, freshLow.id]);
    expect(t[0].reason).toMatch(/vencido/);
    expect(t[2].reason).toMatch(/score 90/);
  });
});

describe("Demo steps in the funnel", () => {
  it("counts each demo step over the cohort, by the highest step its agency reached", () => {
    const a = account({ demo: { created: true, sent: true, level: 2 } });
    const b = account({ demo: { created: true, sent: false, level: 0 } });
    const c = account({ demo: { created: true, sent: true, level: 4 } });
    const d = account();
    const data = ds([a, b, c, d], [
      send(a, "2026-10-02T10:00:00-03:00"),
      send(b, "2026-10-02T10:00:00-03:00"),
      send(c, "2026-10-02T10:00:00-03:00"),
      send(d, "2026-10-02T10:00:00-03:00"),
    ]);
    const { demo } = summarize(data, {});
    expect(demo).toEqual({ created: 3, sent: 2, entered: 2, interacted: 2, generated: 1, panel: 1, subscribed: 0 });
  });

  it("a demo outside the cohort does not count", () => {
    const a = account({ demo: { created: true, sent: true, level: 3 } });
    const data = ds([a], []);
    expect(summarize(data, {}).demo.created).toBe(0);
  });
});

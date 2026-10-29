// Prospecting metrics, computed from the persisted dataset only. Pure: the
// same functions run in tests and in the panel, so the summary and the
// message report always share data, filters and rules. Rules are documented
// in docs/PROSPECCION.md (diccionario de métricas).
import { artDate, dayEnd, dayStart, days, isDate } from "./time";
import type { AttemptChannel, Dataset, DemoProgress, OutreachAttempt, ProspectAccount, ProspectEvent } from "./types";

export type Filters = {
  /** Cohort: first confirmed send between these Buenos Aires dates (inclusive). */
  from?: string | null;
  to?: string | null;
  channel?: string | null;
  sdr?: string | null;
  campaign?: string | null;
  zone?: string | null;
};

export type Ratio = { num: number; den: number; rate: number | null };
const ratio = (num: number, den: number): Ratio => ({ num, den, rate: den ? num / den : null });

const time = (iso: string) => Date.parse(iso);
/** When the observation window of something that happened at `iso` closes. Day precision counts from the end of the day. */
const windowEnd = (iso: string, precision: "time" | "day" | null, windowDays: number) =>
  (precision === "day" ? dayEnd(artDate(iso)) : time(iso)) + days(windowDays);

const sent = (a: OutreachAttempt) => a.status === "sent" && !!a.sent_at;
/** A human reply that was not corrected away. Auto-replies, bounces and delivery receipts are not replies. */
export const isHumanReply = (e: ProspectEvent) => e.type === "reply" && e.human !== false && !e.corrected;
const valid = (e: ProspectEvent) => !e.corrected;

export function inScope(a: ProspectAccount, f: Filters) {
  return (!f.sdr || (a.sdr ?? "") === f.sdr) && (!f.campaign || (a.campaign ?? "") === f.campaign) && (!f.zone || (a.zone ?? "") === f.zone);
}
function inCohort(iso: string, f: Filters) {
  const t = time(iso);
  return (!isDate(f.from) || t >= dayStart(f.from)) && (!isDate(f.to) || t < dayEnd(f.to));
}

/** Indexes the dataset once. */
export function index(ds: Dataset) {
  const sends = new Map<string, OutreachAttempt[]>();
  for (const a of ds.attempts) if (sent(a)) (sends.get(a.account_id) ?? sends.set(a.account_id, []).get(a.account_id)!).push(a);
  for (const list of sends.values()) list.sort((x, y) => time(x.sent_at!) - time(y.sent_at!));
  const events = new Map<string, ProspectEvent[]>();
  for (const e of ds.events) (events.get(e.account_id) ?? events.set(e.account_id, []).get(e.account_id)!).push(e);
  for (const list of events.values()) list.sort((x, y) => time(x.occurred_at) - time(y.occurred_at));
  return { sends, events };
}

/**
 * Whether `a` (send) certainly happened before `b` (reply), given precision.
 * Returns null when it cannot be known (same Buenos Aires day and one side
 * has no time).
 */
function before(aIso: string, aPrec: string | null, bIso: string, bPrec: string | null): boolean | null {
  if (aPrec !== "day" && bPrec !== "day") return time(aIso) <= time(bIso);
  const da = artDate(aIso);
  const db = artDate(bIso);
  if (da < db) return true;
  if (da > db) return false;
  return null;
}

export type Attribution = {
  /** Event id → attempt id that gets the credit (last eligible touch). */
  credit: Map<string, string>;
  /** Event id → earlier touches of the same run (assists, not credited). */
  assists: Map<string, string[]>;
  /** Event ids left without attribution, and why. */
  unattributed: Map<string, "ambiguous" | "late" | "no_send">;
};

/**
 * Last-touch attribution of replies (and interest) to confirmed sends:
 * the last confirmed send before the event, within `windowDays`, at most one
 * event of each type per send. Ambiguous chronology stays unattributed; the
 * account-level result is kept anyway.
 */
export function attribute(ds: Dataset, idx: ReturnType<typeof index>, type: "reply" | "interest", windowDays: number): Attribution {
  const out: Attribution = { credit: new Map(), assists: new Map(), unattributed: new Map() };
  for (const [account, events] of idx.events) {
    const touches = idx.sends.get(account) ?? [];
    const used = new Set<string>();
    let lastReply: ProspectEvent | null = null;
    for (const e of events) {
      const relevant = type === "reply" ? isHumanReply(e) : e.type === "interest" && valid(e);
      if (relevant) {
        let chosen: OutreachAttempt | null = null;
        let ambiguous = false;
        for (const s of touches) {
          const b = before(s.sent_at!, s.sent_precision, e.occurred_at, e.precision);
          if (b === null) ambiguous = true;
          else if (b) {
            chosen = s;
            ambiguous = false;
          }
        }
        if (ambiguous) out.unattributed.set(e.id, "ambiguous");
        else if (!chosen) out.unattributed.set(e.id, "no_send");
        else if (time(e.occurred_at) > windowEnd(chosen.sent_at!, chosen.sent_precision, windowDays)) out.unattributed.set(e.id, "late");
        else if (!used.has(chosen.id)) {
          used.add(chosen.id);
          out.credit.set(e.id, chosen.id);
          // Earlier touches since the previous reply, inside the window, assisted.
          const since = lastReply ? time(lastReply.occurred_at) : -Infinity;
          const assists = touches.filter(
            (s) => s !== chosen && time(s.sent_at!) > since && time(s.sent_at!) <= time(chosen!.sent_at!) &&
              time(e.occurred_at) <= windowEnd(s.sent_at!, s.sent_precision, windowDays),
          );
          if (assists.length) out.assists.set(e.id, assists.map((s) => s.id));
        }
      }
      if (isHumanReply(e)) lastReply = e;
    }
  }
  return out;
}

export type Summary = ReturnType<typeof summarize>;

/** Account-level funnel of a first-send cohort, plus what needs action. */
export function summarize(ds: Dataset, f: Filters, nowIso = ds.now) {
  const now = time(nowIso);
  const win = ds.settings.account_window_days;
  const idx = index(ds);
  const scope = ds.accounts.filter((a) => inScope(a, f));
  const channel = f.channel || null;

  type Row = { account: ProspectAccount; first: OutreachAttempt; mature: boolean };
  const cohort: Row[] = [];
  let messages = 0;
  let unknownChannel = 0;
  for (const account of scope) {
    const all = idx.sends.get(account.id) ?? [];
    const list = channel ? all.filter((s) => s.channel === channel) : all;
    if (!list.length) continue;
    const first = list[0];
    if (!inCohort(first.sent_at!, f)) continue;
    cohort.push({ account, first, mature: windowEnd(first.sent_at!, first.sent_precision, win) <= now });
    messages += list.length;
    if (all.some((s) => s.channel === "unknown")) unknownChannel++;
  }

  /** First valid milestone of `test` at or after the first send: in window, late, or none. */
  const milestone = (r: Row, test: (e: ProspectEvent) => boolean) => {
    const e = (idx.events.get(r.account.id) ?? []).find((x) => test(x) && before(r.first.sent_at!, r.first.sent_precision, x.occurred_at, x.precision) !== false);
    if (!e) return null;
    return time(e.occurred_at) <= windowEnd(r.first.sent_at!, r.first.sent_precision, win) ? "in" : "late";
  };
  const stage = (test: (e: ProspectEvent) => boolean, rows = cohort) => {
    let observed = 0;
    let late = 0;
    let matureNum = 0;
    for (const r of rows) {
      const m = milestone(r, test);
      if (m === "in") {
        observed++;
        if (r.mature) matureNum++;
      } else if (m === "late") late++;
    }
    const matureDen = rows.filter((r) => r.mature).length;
    return { observed, late, mature: ratio(matureNum, matureDen) };
  };

  // Demo steps are presence, not timed: the demo table keeps the highest step reached, not when it was reached.
  const demoCount = (test: (d: DemoProgress) => boolean) => cohort.filter((r) => r.account.demo && test(r.account.demo)).length;
  const demo = {
    created: demoCount((d) => d.created),
    sent: demoCount((d) => d.sent),
    entered: demoCount((d) => d.level >= 1),
    interacted: demoCount((d) => d.level >= 2),
    generated: demoCount((d) => d.level >= 3),
    panel: demoCount((d) => d.level >= 4),
    subscribed: demoCount((d) => d.level >= 5),
  };
  const replied = stage(isHumanReply);
  const interested = stage((e) => e.type === "interest" && valid(e));
  const linkedRows = cohort.filter((r) => r.account.linked);
  const activated = stage((e) => e.type === "activated" && valid(e), linkedRows);
  const customers = stage((e) => e.type === "purchased" && valid(e), linkedRows);
  const matureReplied = cohort.filter((r) => r.mature && milestone(r, isHumanReply) === "in");
  const interestOfReplies = ratio(matureReplied.filter((r) => milestone(r, (e) => e.type === "interest" && valid(e)) === "in").length, matureReplied.length);

  // Work to do, over the whole scope (not the cohort): it is today's queue.
  const open = new Set(["lost", "discarded", "customer"]);
  const overdue = scope.filter((a) => a.due_at && time(a.due_at) < now && !open.has(a.stage)).length;
  const unanswered = scope.filter((a) => !open.has(a.stage) && awaitingAnswer(a, idx)).length;
  const usable = (a: ProspectAccount) => a.contacts.some((c) => c.address && !c.invalid && !c.needs_review && !c.blocked);
  const quality = {
    withoutUsableContact: scope.filter((a) => !usable(a) && !a.suppressed).length,
    contactsToReview: scope.reduce((n, a) => n + a.contacts.filter((c) => c.needs_review && !c.invalid).length, 0),
    invalidContacts: scope.reduce((n, a) => n + a.contacts.filter((c) => c.invalid).length, 0),
    withoutDecisionMaker: scope.filter((a) => !a.decision_maker && !a.contacts.some((c) => c.is_decision_maker)).length,
    withoutScore: scope.filter((a) => a.score == null).length,
    legacyUnknownChannel: unknownChannel,
  };
  const scopeIds = new Set(scope.map((a) => a.id));
  const uncertain = ds.attempts.filter((a) => a.status === "uncertain" && scopeIds.has(a.account_id)).length;
  const live = ds.attempts.filter((a) => (a.status === "prepared" || a.status === "opened") && scopeIds.has(a.account_id)).length;
  const lossReasons = new Map<string, number>();
  for (const a of scope) if (a.stage === "lost") lossReasons.set(a.lost_reason || "Sin motivo", (lossReasons.get(a.lost_reason || "Sin motivo") ?? 0) + 1);
  const recentSends = ds.attempts.filter(
    (a) => sent(a) && scopeIds.has(a.account_id) && (!channel || a.channel === channel) && time(a.sent_at!) > now - days(ds.settings.message_window_days),
  ).length;

  return {
    window: win,
    prospected: scope.length,
    sent: cohort.length,
    matureSent: cohort.filter((r) => r.mature).length,
    observing: cohort.filter((r) => !r.mature).length,
    messages,
    replied,
    interested,
    interestOfReplies,
    demo,
    linked: linkedRows.length,
    activated,
    customers,
    recentSends,
    todo: { overdue, unanswered, uncertain, live },
    quality,
    lossReasons: [...lossReasons.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/** A human reply after the last confirmed send: the team owes an answer. */
export function awaitingAnswer(a: ProspectAccount, idx: ReturnType<typeof index>) {
  const replies = (idx.events.get(a.id) ?? []).filter(isHumanReply);
  if (!replies.length) return null;
  const last = replies[replies.length - 1];
  const sends = idx.sends.get(a.id) ?? [];
  const lastSend = sends[sends.length - 1];
  if (lastSend && before(last.occurred_at, last.precision, lastSend.sent_at!, lastSend.sent_precision) !== false) return null;
  return last;
}

export type MessageRow = {
  key: string;
  campaign: string;
  step: number;
  channel: AttemptChannel;
  variant: "template" | "custom" | "unknown";
  label: string;
  templateId: string | null;
  confirmed: number;
  bounced: number;
  /** Confirmed, eligible (no earlier reply) and with a full window: the denominator. */
  base: number;
  observing: number;
  replies: number;
  interests: number;
  assists: number;
  lateReplies: number;
  small: boolean;
};

/** Results by campaign + step + channel + version, with visible denominators. */
export function messageReport(ds: Dataset, f: Filters, nowIso = ds.now) {
  const now = time(nowIso);
  const win = ds.settings.message_window_days;
  const idx = index(ds);
  const accounts = new Map(ds.accounts.filter((a) => inScope(a, f)).map((a) => [a.id, a]));
  const replies = attribute(ds, idx, "reply", win);
  const interests = attribute(ds, idx, "interest", win);
  const creditBy = (m: Map<string, string>) => {
    const out = new Map<string, number>();
    for (const attempt of m.values()) out.set(attempt, (out.get(attempt) ?? 0) + 1);
    return out;
  };
  const replyCredit = creditBy(replies.credit);
  const interestCredit = creditBy(interests.credit);
  const assistCount = new Map<string, number>();
  for (const list of replies.assists.values()) for (const id of list) assistCount.set(id, (assistCount.get(id) ?? 0) + 1);
  const lateBySend = new Map<string, number>();
  for (const [eventId, why] of replies.unattributed) {
    if (why !== "late") continue;
    const e = ds.events.find((x) => x.id === eventId)!;
    const last = (idx.sends.get(e.account_id) ?? []).filter((s) => time(s.sent_at!) <= time(e.occurred_at)).pop();
    if (last) lateBySend.set(last.id, (lateBySend.get(last.id) ?? 0) + 1);
  }

  const rows = new Map<string, MessageRow>();
  let confirmed = 0;
  const coverage = { template: 0, custom: 0, unknown: 0 };
  for (const a of ds.attempts) {
    if (!accounts.has(a.account_id) || (a.status !== "sent" && a.status !== "bounced") || !a.sent_at) continue;
    if (f.channel && a.channel !== f.channel) continue;
    if (!inCohort(a.sent_at, f)) continue;
    const variant = a.template_version_id ? "template" : a.is_custom ? "custom" : "unknown";
    const key = `${a.campaign}|${a.step}|${a.channel}|${a.template_version_id ?? variant}`;
    const row =
      rows.get(key) ??
      rows
        .set(key, {
          key,
          campaign: a.campaign,
          step: a.step,
          channel: a.channel,
          variant,
          label: variant === "template" ? (a.variant_label ?? "Plantilla") : variant === "custom" ? "Personalizado" : "Sin atribuir (legado)",
          templateId: a.template_id,
          confirmed: 0,
          bounced: 0,
          base: 0,
          observing: 0,
          replies: 0,
          interests: 0,
          assists: 0,
          lateReplies: 0,
          small: true,
        })
        .get(key)!;
    if (a.status === "bounced") {
      row.bounced++;
      continue;
    }
    row.confirmed++;
    confirmed++;
    coverage[variant]++;
    // A send after a reply is conversation, not a sequence step to compare.
    const priorReply = (idx.events.get(a.account_id) ?? []).some(
      (e) => isHumanReply(e) && before(e.occurred_at, e.precision, a.sent_at!, a.sent_precision) === true,
    );
    if (priorReply && a.step > 0) continue;
    if (windowEnd(a.sent_at, a.sent_precision, win) > now) {
      row.observing++;
      continue;
    }
    row.base++;
    row.replies += replyCredit.get(a.id) ?? 0;
    row.interests += interestCredit.get(a.id) ?? 0;
    row.assists += assistCount.get(a.id) ?? 0;
    row.lateReplies += lateBySend.get(a.id) ?? 0;
  }
  for (const r of rows.values()) r.small = r.base < ds.settings.small_sample;
  const list = [...rows.values()].sort((x, y) => x.campaign.localeCompare(y.campaign) || x.step - y.step || x.channel.localeCompare(y.channel) || x.label.localeCompare(y.label));

  // By channel: unique accounts exposed (bases overlap and are never added up).
  const byChannel = new Map<AttemptChannel, { exposed: Set<string>; initial: Set<string>; lastTouchReplies: Set<string>; assisted: Set<string> }>();
  const ch = (c: AttemptChannel) =>
    byChannel.get(c) ?? byChannel.set(c, { exposed: new Set(), initial: new Set(), lastTouchReplies: new Set(), assisted: new Set() }).get(c)!;
  const attemptById = new Map(ds.attempts.map((a) => [a.id, a]));
  const globalExposed = new Set<string>();
  const globalReplied = new Set<string>();
  for (const [account, list2] of idx.sends) {
    if (!accounts.has(account)) continue;
    const inRange = list2.filter((s) => inCohort(s.sent_at!, f));
    if (!inRange.length) continue;
    globalExposed.add(account);
    ch(inRange[0].channel).initial.add(account);
    for (const s of inRange) ch(s.channel).exposed.add(account);
  }
  for (const [eventId, attemptId] of replies.credit) {
    const at = attemptById.get(attemptId)!;
    if (!globalExposed.has(at.account_id) || !inCohort(at.sent_at!, f)) continue;
    ch(at.channel).lastTouchReplies.add(at.account_id);
    globalReplied.add(at.account_id);
    for (const assist of replies.assists.get(eventId) ?? []) {
      const s = attemptById.get(assist)!;
      if (s.channel !== at.channel) ch(s.channel).assisted.add(at.account_id);
    }
  }
  const channels = [...byChannel.entries()]
    .filter(([c]) => !f.channel || c === f.channel)
    .map(([channel, v]) => ({
      channel,
      exposed: v.exposed.size,
      initial: v.initial.size,
      replies: ratio(v.lastTouchReplies.size, v.exposed.size),
      assisted: v.assisted.size,
    }));

  // Whole sequence, per campaign: accounts that started it, and how far they went.
  const sequences = new Map<string, { started: number; reached: number[]; replied: number; observing: number }>();
  for (const [account, list2] of idx.sends) {
    if (!accounts.has(account)) continue;
    const steps = list2.filter((s) => s.step > 0 && (!f.channel || s.channel === f.channel));
    const first = steps.find((s) => s.step === 1);
    if (!first || !inCohort(first.sent_at!, f)) continue;
    const seq = sequences.get(first.campaign) ?? sequences.set(first.campaign, { started: 0, reached: [0, 0, 0], replied: 0, observing: 0 }).get(first.campaign)!;
    const last = steps[steps.length - 1];
    if (windowEnd(last.sent_at!, last.sent_precision, win) > now) {
      seq.observing++;
      continue;
    }
    seq.started++;
    for (const step of [1, 2, 3]) if (steps.some((s) => s.step === step && s.campaign === first.campaign)) seq.reached[step - 1]++;
    const any = [...replies.credit.values()].some((id) => steps.some((s) => s.id === id));
    if (any) seq.replied++;
  }

  return {
    window: win,
    smallSample: ds.settings.small_sample,
    confirmed,
    coverage,
    rows: list,
    channels,
    global: { exposed: globalExposed.size, replied: globalReplied.size },
    unattributed: {
      ambiguous: [...replies.unattributed.values()].filter((v) => v === "ambiguous").length,
      late: [...replies.unattributed.values()].filter((v) => v === "late").length,
      noSend: [...replies.unattributed.values()].filter((v) => v === "no_send").length,
    },
    sequences: [...sequences.entries()].map(([campaign, v]) => ({ campaign, ...v })),
  };
}

export type TodayItem = { account: ProspectAccount; rank: number; reason: string };

/** "Para hoy": overdue commitments, unanswered replies, then new accounts by score. Each item says why. */
export function today(ds: Dataset, f: Filters, nowIso = ds.now): TodayItem[] {
  const now = time(nowIso);
  const idx = index(ds);
  const todayDate = artDate(now);
  const live = new Map(ds.attempts.filter((a) => ["prepared", "opened", "uncertain"].includes(a.status)).map((a) => [a.account_id, a]));
  const out: TodayItem[] = [];
  for (const a of ds.accounts) {
    if (!inScope(a, f) || ["lost", "discarded", "customer"].includes(a.stage) || a.suppressed) continue;
    const attempt = live.get(a.id);
    const reply = awaitingAnswer(a, idx);
    if (attempt?.status === "uncertain") out.push({ account: a, rank: 0, reason: "Resultado incierto: revisá el canal y conciliá antes de reintentar" });
    else if (a.due_at && time(a.due_at) < (a.due_precision === "day" ? dayStart(todayDate) : now))
      out.push({ account: a, rank: 1, reason: `Compromiso vencido: ${a.next_action ?? "próxima acción"}` });
    else if (reply) out.push({ account: a, rank: 2, reason: "Respondió y falta contestar" });
    else if (a.due_at && artDate(a.due_at) === todayDate) out.push({ account: a, rank: 3, reason: `Para hoy: ${a.next_action ?? "próxima acción"}` });
    else if (!(idx.sends.get(a.id) ?? []).length && !attempt && a.contacts.some((c) => c.address && !c.invalid && !c.needs_review && !c.blocked))
      out.push({ account: a, rank: 4, reason: a.score != null ? `Sin envíos · score ${a.score}` : "Sin envíos · sin score" });
  }
  return out.sort((x, y) => x.rank - y.rank || (y.account.score ?? -1) - (x.account.score ?? -1) || x.account.name.localeCompare(y.account.name));
}

export const percent = (r: Ratio) => (r.rate == null ? "—" : `${(r.rate * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`);

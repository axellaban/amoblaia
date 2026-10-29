// The batch of imported photos: what a generation would create across
// several photo groups, what it would cost and how a run went. Client-safe
// and pure, so the tray, its confirmation and the tests share one rule.
import { cellState } from "@/lib/demos/editor-logic";
import type { EditorPhoto } from "@/lib/demos/shared";
import { PROPERTY_TYPE_NAMES, demoStyleName, styleFits, type PropertyType } from "@/lib/demos/styles";

export type BatchGroup = {
  id: string;
  title: string;
  propertyType: PropertyType;
  /** Why this account cannot create versions here (the editor's same rule), or null. */
  blocked: string | null;
  photos: EditorPhoto[];
};
export type BatchMode = "furnish" | "redesign";
export type BatchTask = { demoId: string; photoId: string; room: string; mode: BatchMode; style: string };

/**
 * The room a photo is known to be: the one its newest version was created
 * as. A photo never staged has none: the stored default is not a choice.
 */
export const knownRoom = (p: Pick<EditorPhoto, "generations">) => p.generations[0]?.room ?? null;

/**
 * What "Revisar y generar" would send: one version per chosen photo in the
 * chosen style. Photos without a room are asked for, never guessed; a style
 * that does not fit a group's kind of property, or a group this account may
 * not stage, stops only that group. Versions that exist, are running or
 * need a technical review are never sent again.
 */
export function planBatch(
  groups: BatchGroup[],
  picks: Record<string, string[]>,
  rooms: Record<string, string | null>,
  choice: { style: string; mode: BatchMode },
) {
  const tasks: BatchTask[] = [];
  const missingRoom: { demoId: string; photoId: string }[] = [];
  const incompatible: { demoId: string; title: string; reason: string }[] = [];
  const blocked: { demoId: string; title: string; reason: string }[] = [];
  const skipped = { exists: 0, running: 0, uncertain: 0 };
  let photos = 0;
  for (const g of groups) {
    const ids = new Set(picks[g.id] ?? []);
    const chosen = g.photos.filter((p) => ids.has(p.id));
    if (!chosen.length) continue;
    photos += chosen.length;
    if (g.blocked) {
      blocked.push({ demoId: g.id, title: g.title, reason: g.blocked });
      continue;
    }
    if (!styleFits(choice.style, g.propertyType)) {
      incompatible.push({
        demoId: g.id,
        title: g.title,
        reason: `${demoStyleName(choice.style)} no es un estilo para ${PROPERTY_TYPE_NAMES[g.propertyType].toLowerCase()}.`,
      });
      continue;
    }
    for (const p of chosen) {
      const room = rooms[p.id] ?? null;
      if (!room) {
        missingRoom.push({ demoId: g.id, photoId: p.id });
        continue;
      }
      const state = cellState(p, choice.style, false);
      if (state.kind === "uncertain") skipped.uncertain++;
      else if (state.kind === "running" || state.kind === "queued" || (state.kind === "ready" && state.running)) skipped.running++;
      else if (state.kind === "ready") skipped.exists++;
      else tasks.push({ demoId: g.id, photoId: p.id, room, mode: choice.mode, style: choice.style });
    }
  }
  const groupsWithTasks = new Set(tasks.map((t) => t.demoId)).size;
  return { tasks, missingRoom, incompatible, blocked, skipped, photos, groups: groupsWithTasks };
}

export type Quote = { payer: "team" | "agency"; credits: number | null; newPhotos: number; blocked: string | null };

/**
 * One cost for the whole batch from each group's quote. All groups of an
 * agency are paid by the same account, so its balance is checked against the
 * sum: two groups that fit separately may not fit together.
 */
export function combineQuotes(quotes: { title: string; quote: Quote }[]) {
  const agency = quotes.filter((q) => q.quote.payer === "agency");
  const payer: Quote["payer"] = agency.length ? "agency" : "team";
  const credits = agency.length ? agency[0].quote.credits : null;
  const newPhotos = agency.reduce((n, q) => n + q.quote.newPhotos, 0);
  const own = quotes.find((q) => q.quote.blocked);
  let blocked = own ? (quotes.length > 1 ? `${own.title}: ${own.quote.blocked}` : own.quote.blocked) : null;
  if (!blocked && payer === "agency") {
    if (credits === null) blocked = "No pudimos consultar el saldo. Probá de nuevo.";
    else if (credits < newPhotos)
      blocked = `${newPhotos === 1 ? "Hace" : "Hacen"} falta ${newPhotos} ${newPhotos === 1 ? "crédito" : "créditos"} y la inmobiliaria tiene ${credits}.`;
  }
  return { payer, credits, newPhotos, after: credits === null ? null : credits - newPhotos, blocked };
}

/**
 * Where each version of a run stands. "uncertain": the request got no
 * answer, so it may have been received; its retry uses the same key and is
 * never reserved twice. "lost": it was received but its progress could not be
 * followed; it is looked at in the editor, never sent again from here.
 * "unsent": the run stopped before sending it.
 */
export type RunState = "waiting" | "sending" | "generating" | "ready" | "failed" | "review" | "uncertain" | "lost" | "unsent";

/** The outcome of a version that finished, from its newest attempt in that style. */
export function finished(photo: Pick<EditorPhoto, "generations"> | null, style: string): "ready" | "failed" | "review" {
  const newest = photo?.generations.find((g) => g.style === style);
  if (newest?.status === "succeeded") return "ready";
  if (newest?.status === "needs_review") return "review";
  return "failed";
}

/** Counts of a run: what is ready, what needs attention and what is still on its way. */
export function runSummary(states: RunState[]) {
  const count = (...s: RunState[]) => states.filter((x) => s.includes(x)).length;
  const pending = count("waiting", "sending", "generating");
  const attention = count("failed", "review", "uncertain", "lost", "unsent");
  return { total: states.length, ready: count("ready"), attention, pending, finished: pending === 0, allReady: pending === 0 && attention === 0 && states.length > 0 };
}

/** Versions a person can retry from the batch: confirmed failures, unanswered requests and the ones never sent. */
export const retryable = (s: RunState) => s === "failed" || s === "uncertain" || s === "unsent";

// Rules of the photo import that the panel shows and the tests check: which
// links are read, what a selection covers and whether a file can be uploaded.
// Client-safe: the server enforces the same limits again.
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES } from "@/lib/photo-limits";

export const MAX_LISTINGS = 10;

/**
 * The links pasted in the "varias URLs" box: one per line, repeated links read once.
 * `extra` counts the links beyond the limit: they are reported, never dropped silently.
 */
export function splitListings(text: string, max = MAX_LISTINGS) {
  const all = text
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);
  const urls = [...new Set(all)];
  return { urls, repeated: all.length - urls.length, extra: Math.max(0, urls.length - max) };
}

/** What a selection covers: photos, and the listings or file groups they belong to. */
export function selectionTotals(groups: { picks: ReadonlySet<string> }[]) {
  const chosen = groups.filter((g) => g.picks.size > 0);
  return { photos: chosen.reduce((n, g) => n + g.picks.size, 0), groups: chosen.length };
}

/** A file can be uploaded when it is a JPG, PNG or WebP of at most the limit, and not empty. */
export function fileProblem(file: { type: string; size: number }): string | null {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) return "Solo JPG, PNG o WebP.";
  if (!file.size) return "El archivo está vacío.";
  if (file.size > MAX_UPLOAD_BYTES) return `Pesa más de ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`;
  return null;
}

/** Counts of the readings, from their real states. */
export function readCounts(list: { state: "waiting" | "reading" | "ready" | "duplicate" | "error" }[]) {
  const count = (s: string) => list.filter((l) => l.state === s).length;
  return {
    total: list.length,
    ready: count("ready"),
    duplicate: count("duplicate"),
    error: count("error"),
    pending: count("waiting") + count("reading"),
  };
}

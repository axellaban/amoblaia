import "server-only";
import { adminClient } from "@/lib/supabase/server";
import { compactOriginal, compactStaging } from "./images";
import { BUCKET } from "./jobs";

/**
 * Recompresses the photos stored before the current compression, the photos without staging first
 * (they shrink the most) and then the stagings. Each file is replaced only when it gets at least 10%
 * smaller, and its size is saved where the storage budget counts it. Runs in slices until `deadline`.
 */
type Kind = "original" | "staging";
type Target = { path: string; kind: Kind; bytes: number };

const MIN_GAIN = 0.9;

/** Every row of a query, 1000 at a time (the API's ceiling per request). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error("COMPACT_LOOKUP_FAILED");
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

type Row = { path: string | null; bytes: number | null };
/** What is left to recompress: the photos without staging first, the largest first. */
async function pending(): Promise<Target[]> {
  const db = adminClient();
  const [done, originals, results, retouches] = await Promise.all([
    all<{ path: string }>((a, b) => db.from("image_compactions").select("path").order("path").range(a, b)),
    all<Row>((a, b) =>
      db.from("projects").select("path:original_path,bytes:original_bytes").is("deleted_at", null).order("id").range(a, b),
    ),
    all<Row>((a, b) =>
      db
        .from("generations")
        .select("path:result_path,bytes:result_bytes")
        .eq("status", "succeeded")
        .not("result_path", "is", null)
        .order("id")
        .range(a, b),
    ),
    all<Row>((a, b) => db.from("photo_retouches").select("path:result_path,bytes:result_bytes").order("id").range(a, b)),
  ]);
  const seen = new Set(done.map((r) => r.path));
  const out: Target[] = [];
  for (const [rows, kind] of [[originals, "original"], [results, "staging"], [retouches, "staging"]] as const) {
    const fresh: Target[] = [];
    for (const r of rows)
      if (r.path && !seen.has(r.path)) {
        seen.add(r.path);
        fresh.push({ path: r.path, kind, bytes: r.bytes ?? 0 });
      }
    out.push(...fresh.sort((x, y) => y.bytes - x.bytes));
  }
  // Stagings after every original: a kind is sorted on its own.
  return [...out.filter((t) => t.kind === "original"), ...out.filter((t) => t.kind === "staging")];
}

async function compactOne(t: Target) {
  const db = adminClient();
  const file = await db.storage.from(BUCKET).download(t.path);
  if (file.error || !file.data) return { saved: 0, missing: true };
  const before = Buffer.from(await file.data.arrayBuffer());
  const after = t.kind === "original" ? await compactOriginal(before) : await compactStaging(before);
  const replaced = after.length < before.length * MIN_GAIN;
  if (replaced) {
    const up = await db.storage.from(BUCKET).upload(t.path, after, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error("COMPACT_UPLOAD_FAILED");
    // The budget reads these sizes: every row pointing at this file gets the new one.
    const updates =
      t.kind === "original"
        ? [db.from("projects").update({ original_bytes: after.length }).eq("original_path", t.path)]
        : [
            db.from("generations").update({ result_bytes: after.length }).eq("result_path", t.path),
            db.from("photo_retouches").update({ result_bytes: after.length }).eq("result_path", t.path),
          ];
    for (const r of await Promise.all(updates)) if (r.error) throw new Error("COMPACT_BYTES_FAILED");
  }
  const mark = await db.from("image_compactions").upsert({
    path: t.path,
    kind: t.kind,
    before_bytes: before.length,
    after_bytes: replaced ? after.length : before.length,
    replaced,
  });
  if (mark.error) throw new Error("COMPACT_MARK_FAILED");
  return { saved: replaced ? before.length - after.length : 0, missing: false };
}

export async function compactStoredImages(deadline: number) {
  const list = await pending();
  let done = 0, savedBytes = 0, missing = 0, failed = 0;
  for (const t of list) {
    // Each photo takes about a second: leave margin to finish the one in hand.
    if (Date.now() > deadline - 8000) break;
    try {
      const r = await compactOne(t);
      savedBytes += r.saved;
      if (r.missing) missing++;
      done++;
    } catch (error) {
      failed++;
      console.error("compact_failed", error instanceof Error ? error.message : "unknown");
    }
  }
  const left = list.length - done;
  return { done, savedMb: Math.round(savedBytes / 104857.6) / 10, missing, failed, left };
}

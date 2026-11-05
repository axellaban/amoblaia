import "server-only";
import { createHash } from "node:crypto";
import { HttpError } from "@/lib/commerce/http";
import type { ImportedDemo } from "@/lib/demos/import";
import { adminClient } from "@/lib/supabase/server";

/** Text compared as read: spacing and line breaks a page re-renders differently don't count. */
const sameText = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

/**
 * A photo's address without what some sites change on every visit (a
 * cache-busting query or fragment, upper/lower case in the host), so the same
 * photo read twice is the same photo.
 */
export function photoKey(src: string) {
  try {
    const u = new URL(src);
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname}`;
  } catch {
    return src.split(/[?#]/)[0];
  }
}

/** The fields a person reviews on the preview; a change in any of them is worth asking again. */
const REVIEWED = {
  title: "título",
  price: "precio",
  operation: "operación",
  location: "ubicación",
  description: "descripción",
} as const;
type Reviewed = keyof typeof REVIEWED;
const short = (v: string) => createHash("sha256").update(v).digest("base64url").slice(0, 12);
const reviewedValue = (imp: ImportedDemo, k: Reviewed) => sameText(k === "price" ? (imp.price ?? imp.priceConflict) : imp[k]);

/**
 * What the person saw on the preview, to tell on confirming whether the
 * listing really changed: one short hash per reviewed field and one per
 * photo (by address, without what sites change on every visit). It travels
 * through the browser and back; nothing in it is trusted beyond comparing.
 */
export function snapshotOf(imp: ImportedDemo) {
  const f = Object.fromEntries((Object.keys(REVIEWED) as Reviewed[]).map((k) => [k, short(reviewedValue(imp, k))]));
  // At most SNAPSHOT_PHOTOS photos, so it always fits the column (12000 characters).
  const p = [...new Set(imp.images.map((src) => short(photoKey(src))))].sort().slice(0, SNAPSHOT_PHOTOS);
  return `v2.${Buffer.from(JSON.stringify({ f, p })).toString("base64url")}`;
}

/**
 * What property_imports.snapshot accepts (its check, in
 * 202611260001_import_snapshot_v2.sql): the old sha256 in hex or v2, up to
 * SNAPSHOT_MAX characters. Change both together; a test compares them.
 */
export const SNAPSHOT_PATTERN = /^([0-9a-f]{64}|v2\.[A-Za-z0-9_-]+)$/;
export const SNAPSHOT_MAX = 12000;
/** Photos kept in a snapshot: 500 hashes are about 10 000 characters. */
const SNAPSHOT_PHOTOS = 500;
export const storableSnapshot = (s: string) => s.length <= SNAPSHOT_MAX && SNAPSHOT_PATTERN.test(s);

/** The single hash a tab opened before v2 still sends: compared as it was. */
export function legacySnapshotOf(imp: ImportedDemo) {
  const round = (n: number | null) => (n == null ? null : Math.round(n * 1e5) / 1e5);
  const seen = {
    title: sameText(imp.title),
    location: sameText(imp.location),
    operation: sameText(imp.operation),
    price: sameText(imp.price),
    priceConflict: imp.priceConflict,
    description: sameText(imp.description),
    images: [...new Set(imp.images.map(photoKey))].sort(),
    map: imp.map ? [round(imp.map.lat), round(imp.map.lng), imp.map.precision, imp.mapStatus] : null,
  };
  return createHash("sha256").update(JSON.stringify(seen)).digest("hex");
}

export type SnapshotChange = {
  /** Reviewed fields that read differently now, in Spanish ("precio", "descripción"). */
  fields: string[];
  /** Every photo the person chose is gone from the page (some were chosen). */
  chosenGone: boolean;
  /** How many of the chosen photos are no longer on the page. */
  chosenMissing: number;
};

/**
 * What changed between the preview and the listing as read now. Photos the
 * person did not choose, new photos and photos no longer on the page do not
 * count as a change (the chosen ones still there are imported); only the
 * reviewed fields, or all the chosen photos being gone, do.
 */
export function snapshotChanges(sent: unknown, now: ImportedDemo, chosen: string[] | null): SnapshotChange {
  const none: SnapshotChange = { fields: [], chosenGone: false, chosenMissing: 0 };
  if (typeof sent !== "string" || !sent) return none;
  if (!sent.startsWith("v2.")) return legacySnapshotOf(now) === sent ? none : { ...none, fields: ["la publicación"] };
  let seen: { f?: Record<string, string>; p?: string[] };
  try {
    seen = JSON.parse(Buffer.from(sent.slice(3), "base64url").toString("utf8"));
  } catch {
    return none;
  }
  const fields = (Object.keys(REVIEWED) as Reviewed[])
    .filter((k) => typeof seen.f?.[k] === "string" && seen.f[k] !== short(reviewedValue(now, k)))
    .map((k) => REVIEWED[k]);
  const present = new Set(now.images.map((src) => short(photoKey(src))));
  const wanted = chosen ? [...new Set(chosen.map((src) => short(photoKey(src))))] : (seen.p ?? []);
  const missing = wanted.filter((h) => !present.has(h)).length;
  return { fields, chosenGone: wanted.length > 0 && missing === wanted.length, chosenMissing: missing };
}

export type ImportRow = {
  id: string;
  agency_id: string;
  url: string;
  status: "started" | "completed" | "partial" | "failed" | "duplicate";
  demo_id: string | null;
  photos_total: number | null;
  photos_done: number | null;
  pending_images: string[];
  settings_saved: boolean | null;
  error: string | null;
};
const FIELDS = "id,agency_id,url,status,demo_id,photos_total,photos_done,pending_images,settings_saved,error";

/**
 * Starts an import of `url` for the agency. The same request key returns the
 * import already made (a confirm sent twice creates one property); another
 * import of the same URL still running is refused. Imports left running by a
 * crash are closed after 10 minutes.
 */
export async function startImport(agencyId: string, userId: string, url: string, key: string) {
  const db = adminClient();
  const replay = await db.from("property_imports").select(FIELDS).eq("agency_id", agencyId).eq("request_key", key).maybeSingle();
  if (replay.error) throw new Error("IMPORT_LOOKUP_FAILED");
  if (replay.data) return { row: replay.data as unknown as ImportRow, replay: true };
  await db
    .from("property_imports")
    .update({ status: "failed", error: "La importación se interrumpió. Volvé a intentarlo." })
    .eq("agency_id", agencyId)
    .eq("status", "started")
    .lt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  let source: string | null = null;
  try {
    source = new URL(url).hostname.replace(/^www\./, "").slice(0, 120);
  } catch {
    // Logged as pasted.
  }
  const made = await db
    .from("property_imports")
    .insert({ agency_id: agencyId, user_id: userId, url, source, status: "started", request_key: key })
    .select(FIELDS)
    .single();
  if (made.error) {
    if (made.error.code === "23505") {
      // The same key raced with itself: return that import; otherwise the URL is being imported.
      const again = await db.from("property_imports").select(FIELDS).eq("agency_id", agencyId).eq("request_key", key).maybeSingle();
      if (again.data) return { row: again.data as unknown as ImportRow, replay: true };
      throw new HttpError(409, "Esta propiedad ya se está importando. Esperá unos segundos y revisá Mis demostraciones.");
    }
    throw new Error("IMPORT_START_FAILED");
  }
  return { row: made.data as unknown as ImportRow, replay: false };
}

export async function updateImport(
  id: string,
  patch: Partial<Omit<ImportRow, "id" | "agency_id" | "url">> & { finished_at?: string; property_id?: string | null; snapshot?: string },
) {
  const { error } = await adminClient().from("property_imports").update(patch).eq("id", id);
  if (error) throw new Error("IMPORT_UPDATE_FAILED");
}

/** The import's state from what is still missing: its data, its photos. */
export const importStatus = (r: { settings_saved: boolean | null; pending_images: string[] }): "partial" | "completed" =>
  r.settings_saved === false || r.pending_images.length ? "partial" : "completed";

/**
 * The photos the panel downloaded (or could not) for an import of this
 * agency. Only listed photos of that import count; the rest is ignored.
 */
export async function reportPhotos(agencyId: string, importId: string, done: unknown, failed: unknown) {
  const db = adminClient();
  const { data, error } = await db.from("property_imports").select(FIELDS).eq("id", importId).eq("agency_id", agencyId).maybeSingle();
  if (error) throw new Error("IMPORT_LOOKUP_FAILED");
  const row = data as unknown as ImportRow | null;
  if (!row) throw new HttpError(404, "No encontramos esa importación.");
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const ok = new Set(list(done));
  const pending = (row.pending_images ?? []).filter((src) => !ok.has(src));
  const failedNow = list(failed).filter((src) => pending.includes(src)).length;
  const total = row.photos_total ?? pending.length;
  const next = {
    pending_images: pending,
    photos_done: total - pending.length,
    error: failedNow ? `${failedNow} ${failedNow === 1 ? "foto no se pudo descargar" : "fotos no se pudieron descargar"}.` : row.settings_saved === false ? row.error : null,
    finished_at: new Date().toISOString(),
  };
  const status = importStatus({ settings_saved: row.settings_saved, pending_images: pending });
  await updateImport(row.id, { ...next, status });
  return { ...row, ...next, status };
}

/**
 * An empty property that a failed import of this agency left (it has no
 * photos, and every import linked to it failed): a new attempt of the same
 * listing fills it instead of being refused as a duplicate. Null otherwise.
 */
export async function leftoverOf(agencyId: string, demoId: string) {
  const db = adminClient();
  const [imports, demo] = await Promise.all([
    db.from("property_imports").select("status").eq("agency_id", agencyId).eq("demo_id", demoId),
    db.from("demos").select("id,property_id").eq("id", demoId).eq("agency_id", agencyId).maybeSingle(),
  ]);
  if (imports.error || demo.error || !demo.data) return null;
  const rows = (imports.data ?? []) as { status: string }[];
  if (!rows.length || rows.some((r) => r.status !== "failed")) return null;
  const propertyId = (demo.data as { property_id: string }).property_id;
  const photos = await db.from("demo_photos").select("id", { count: "exact", head: true }).eq("property_id", propertyId);
  if (photos.error || (photos.count ?? 0) > 0) return null;
  return { demoId, propertyId };
}

/** After the property's data was completed from its listing: its imports no longer miss it. */
export async function markSettingsSaved(demoId: string) {
  const db = adminClient();
  const { data } = await db.from("property_imports").select(FIELDS).eq("demo_id", demoId).eq("settings_saved", false);
  for (const row of (data ?? []) as unknown as ImportRow[])
    await updateImport(row.id, {
      settings_saved: true,
      status: importStatus({ settings_saved: true, pending_images: row.pending_images ?? [] }),
      error: null,
    }).catch(() => null);
}

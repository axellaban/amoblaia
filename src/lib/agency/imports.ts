import "server-only";
import { createHash } from "node:crypto";
import { HttpError } from "@/lib/commerce/http";
import type { ImportedDemo } from "@/lib/demos/import";
import { adminClient } from "@/lib/supabase/server";

/**
 * What the admin saw on the preview, to tell whether the listing changed
 * before confirming: the fields that are saved and the photos offered.
 */
export function snapshotOf(imp: ImportedDemo) {
  const seen = {
    title: imp.title,
    location: imp.location,
    operation: imp.operation,
    price: imp.price,
    priceConflict: imp.priceConflict,
    description: imp.description,
    images: imp.images,
    map: imp.map ? [imp.map.lat, imp.map.lng, imp.map.precision, imp.mapStatus] : null,
  };
  return createHash("sha256").update(JSON.stringify(seen)).digest("hex");
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
      throw new HttpError(409, "Esta propiedad ya se está importando. Esperá unos segundos y revisá Mis propiedades.");
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

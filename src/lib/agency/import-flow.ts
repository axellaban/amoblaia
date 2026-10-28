import "server-only";
import { failure, HttpError, rpc } from "@/lib/commerce/http";
import { DEFAULT_SETTINGS } from "@/lib/demos/branding";
import { applyImport, IMPORT_FIELDS } from "@/lib/demos/import";
import { importedMap, readJson } from "@/lib/demos/input";
import { readListing } from "@/lib/demos/listing";
import { completeAgency, createDemo, MAX_PHOTOS_PER_DEMO, saveJson } from "@/lib/demos/server";
import { cleanText, cleanUrl, isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { reportPhotos, snapshotOf, startImport, updateImport, type ImportRow } from "./imports";
import { existingImport, logImport } from "./panel";

const PRIVATE = { "Cache-Control": "private, no-store" };
const result = (row: ImportRow, extra: Record<string, unknown> = {}) => ({
  importId: row.id,
  id: row.demo_id,
  status: row.status,
  settingsSaved: row.settings_saved !== false,
  photosTotal: row.photos_total ?? 0,
  photosDone: row.photos_done ?? 0,
  images: row.pending_images ?? [],
  ...extra,
});

/** Who imports into which agency: the agency's member from its panel, or the team from administration. */
export type ImportTarget = { agencyId: string; userId: string; origin: "agency" | "admin" };

/**
 * A property of the agency from the URL of its listing, with the same reader
 * the team uses for demos (public addresses only, size and time limits).
 *
 * { url, preview: true } only reads: everything found, field by field, the
 * property already imported from that URL (if any) and a snapshot of what
 * was shown. { url, key, snapshot, overrides, images } creates the property
 * as a draft with the preview's corrections and kept photos, once per key;
 * if the listing changed since the preview it answers 409 with the new one.
 * The photos are then downloaded by the browser and reported with PATCH, so
 * the import says what really happened: completed, or partial with the
 * photos (or data) still missing. Nothing is staged and no credit is used.
 * The agency comes from the caller (the member's own, or the one the team
 * is editing), never from the request body.
 */
export async function importListing(request: Request, target: ImportTarget, onCreated?: (demoId: string) => Promise<void>) {
  let ctx: { agencyId: string; userId: string; url: string } | null = null;
  let started: ImportRow | null = null;
  try {
    const body = await readJson(request, 32768);
    const pasted = cleanUrl(body.url);
    if (!pasted) throw new HttpError(400, "Pegá la URL de la ficha de la propiedad.");
    ctx = { agencyId: target.agencyId, userId: target.userId, url: pasted };
    if (body.preview === true) {
      const listing = await readListing(pasted);
      const duplicateOf = await existingImport(target.agencyId, listing.listingUrl);
      return Response.json(
        { ...listing.imported, listingUrl: listing.listingUrl, duplicateOf, snapshot: snapshotOf(listing.imported) },
        { headers: PRIVATE },
      );
    }
    if (!isUuid(body.key)) throw new HttpError(400, "Volvé a leer la publicación e intentá de nuevo.");
    const { row, replay } = await startImport(target.agencyId, target.userId, pasted, body.key);
    // The same confirm again: what that import did, nothing new.
    if (replay) return Response.json(result(row, { replay: true }), { status: row.demo_id ? 200 : 409, headers: PRIVATE });
    started = row;

    const listing = await readListing(pasted);
    const imp = listing.imported;
    const duplicateOf = await existingImport(target.agencyId, listing.listingUrl);
    if (duplicateOf) {
      await updateImport(row.id, { status: "duplicate", demo_id: duplicateOf, error: null });
      started = null;
      return Response.json({ error: "Esta propiedad ya está en tu panel.", duplicateOf }, { status: 409, headers: PRIVATE });
    }
    const snapshot = snapshotOf(imp);
    if (typeof body.snapshot === "string" && body.snapshot !== snapshot) {
      await updateImport(row.id, { status: "failed", error: "La publicación cambió desde la vista previa." });
      started = null;
      return Response.json(
        {
          error: "La publicación cambió desde que la revisaste. Mirá los datos nuevos antes de importarla.",
          changed: true,
          preview: { ...imp, listingUrl: listing.listingUrl, duplicateOf: null, snapshot },
        },
        { status: 409, headers: PRIVATE },
      );
    }

    // The preview's corrections. Nothing the admin left empty is invented.
    const edits = (body.overrides ?? {}) as Record<string, unknown>;
    const fixed = applyImport(
      { title: imp.title, location: imp.location, settings: DEFAULT_SETTINGS, generated: { title: null, location: null, description: null } },
      imp,
      [...IMPORT_FIELDS],
    );
    const title = "title" in edits ? cleanText(edits.title, 160) : fixed.title;
    if (!title) throw new HttpError(400, "Ingresá el título de la propiedad.");
    const location = "location" in edits ? cleanText(edits.location, 160) : fixed.location;
    const settings = { ...fixed.settings };
    if ("price" in edits) {
      // A price confirmed on the preview settles a published contradiction.
      settings.price = cleanText(edits.price, 40);
      settings.priceConflict = settings.price ? null : settings.priceConflict;
    }
    if ("operation" in edits) settings.operation = cleanText(edits.operation, 40);
    if ("description" in edits) settings.description = cleanText(edits.description, 6000, true);
    // The map as confirmed on the preview (validated here; links are only read for their coordinates).
    settings.map = importedMap(imp, edits.map, settings.map);
    const kept = Array.isArray(body.images)
      ? imp.images.filter((src) => (body.images as unknown[]).includes(src))
      : imp.images;
    const images = kept.slice(0, MAX_PHOTOS_PER_DEMO);

    await rpc("amobla_account", { p_user: target.userId, p_trial: false });
    const id = await createDemo({
      actorId: target.userId,
      agencyId: target.agencyId,
      agency: null,
      property: {
        title,
        location,
        listing_url: listing.listingUrl,
        description: cleanText(listing.description, 1000, true),
        origin: target.origin,
      },
    });
    // From here the property exists: whatever fails is recorded as missing, never lost.
    const saved = await saveJson("demos", "settings", id, settings).then(
      () => true,
      () => false,
    );
    await completeAgency(target.agencyId, imp).catch(() => null);
    const { data: demo } = await adminClient().from("demos").select("property_id").eq("id", id).single();
    const done: ImportRow = {
      ...row,
      status: !saved || images.length ? "partial" : "completed",
      demo_id: id,
      photos_total: images.length,
      photos_done: 0,
      pending_images: images,
      settings_saved: saved,
      error: saved ? null : "No pudimos guardar los datos de la ficha. Completalos desde la publicación.",
    };
    await updateImport(row.id, {
      status: done.status,
      demo_id: id,
      photos_total: done.photos_total,
      photos_done: 0,
      pending_images: images,
      settings_saved: saved,
      error: done.error,
      property_id: (demo as { property_id: string } | null)?.property_id ?? null,
      snapshot,
    });
    started = null;
    await onCreated?.(id);
    return Response.json(result(done, { title }), { status: 201, headers: PRIVATE });
  } catch (e) {
    if (started)
      await updateImport(started.id, {
        status: "failed",
        error: e instanceof HttpError ? e.message.slice(0, 300) : "No pudimos completar la importación.",
      }).catch(() => null);
    else if (ctx && e instanceof HttpError && ![401, 403, 409].includes(e.status))
      await logImport({ ...ctx, status: "failed", error: e.message });
    return failure(e);
  }
}

/** The photos the browser downloaded for an import of this agency: { importId, done: [...], failed: [...] }. */
export async function reportImportPhotos(request: Request, agencyId: string) {
  const body = await readJson(request, 65536);
  if (!isUuid(body.importId)) throw new HttpError(400, "Importación inválida.");
  const row = await reportPhotos(agencyId, body.importId, body.done, body.failed);
  return Response.json(result(row), { headers: PRIVATE });
}

import "server-only";
import { failure, HttpError, rpc } from "@/lib/commerce/http";
import { DEFAULT_SETTINGS } from "@/lib/demos/branding";
import { applyImport, IMPORT_FIELDS } from "@/lib/demos/import";
import { importedMap, readJson } from "@/lib/demos/input";
import { readListing } from "@/lib/demos/listing";
import { completeAgency, createDemo, MAX_PHOTOS_PER_DEMO, saveJson } from "@/lib/demos/server";
import { cleanText, cleanUrl, isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { photoKey, reportPhotos, snapshotChanges, snapshotOf, startImport, updateImport, type ImportRow } from "./imports";
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
/** The same, from a guest of the panel (no account yet): it may only read the preview. */
type ListingTarget = Omit<ImportTarget, "userId"> & { userId: string | null };

/**
 * A property of the agency from the URL of its listing, with the same reader
 * the team uses for demos (public addresses only, size and time limits).
 *
 * { url, preview: true } only reads: everything found, field by field, the
 * property already imported from that URL (if any) and a snapshot of what
 * was shown. { url, key, snapshot, overrides, images } creates the property
 * as a draft with the preview's corrections and kept photos, once per key;
 * if the listing changed since the preview it answers 409 with the new one,
 * and the confirm of that new one ({ accept: true }) goes ahead with what it reads.
 * The photos are then downloaded by the browser and reported with PATCH, so
 * the import says what really happened: completed, or partial with the
 * photos (or data) still missing. Nothing is staged and no credit is used.
 * The agency comes from the caller (the member's own, or the one the team
 * is editing), never from the request body.
 */
export async function importListing(request: Request, target: ListingTarget, onCreated?: (demoId: string) => Promise<void>) {
  let ctx: { agencyId: string; userId: string; url: string } | null = null;
  // A guest's failed preview is not logged as an import attempt of the agency.
  let started: ImportRow | null = null;
  try {
    const body = await readJson(request, 32768);
    const pasted = cleanUrl(body.url);
    if (!pasted) throw new HttpError(400, "Pegá la URL de la ficha de la propiedad.");
    ctx = target.userId ? { agencyId: target.agencyId, userId: target.userId, url: pasted } : null;
    if (body.preview === true) {
      const listing = await readListing(pasted);
      const duplicateOf = await existingImport(target.agencyId, listing.listingUrl);
      return Response.json(
        { ...listing.imported, listingUrl: listing.listingUrl, duplicateOf, snapshot: snapshotOf(listing.imported) },
        { headers: PRIVATE },
      );
    }
    // Creating needs the account: the preview alone is allowed to a guest of the panel.
    const userId = target.userId;
    if (!userId) throw new HttpError(401, "Accedé a tu cuenta para importar la propiedad.");
    if (!isUuid(body.key)) throw new HttpError(400, "Volvé a leer la publicación e intentá de nuevo.");
    const { row, replay } = await startImport(target.agencyId, userId, pasted, body.key);
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
    const chosenList = Array.isArray(body.images) ? body.images.filter((x): x is string => typeof x === "string") : null;
    const change = snapshotChanges(body.snapshot, imp, chosenList);
    // Only a real change asks again: a reviewed field that reads differently, or every chosen photo gone.
    // { accept: true }: the person already saw the listing as it changed and confirmed it.
    if ((change.fields.length || change.chosenGone) && body.accept !== true) {
      await updateImport(row.id, { status: "failed", error: "La publicación cambió desde la vista previa." });
      started = null;
      const what = change.fields.length ? `Cambió ${change.fields.join(", ")}` : "Las fotos elegidas ya no están en la publicación";
      return Response.json(
        {
          error: `${what} desde que la revisaste. Mirá los datos nuevos antes de importarla.`,
          changed: true,
          changes: change.fields,
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
    // The photos kept on the preview, matched by address without the parts some sites change
    // on every visit. If none of them is found anymore, every photo read now (never none).
    const chosen = chosenList ? new Set(chosenList.map(photoKey)) : null;
    const matched = chosen ? imp.images.filter((src) => chosen.has(photoKey(src))) : imp.images;
    const kept = chosen && chosen.size && !matched.length ? imp.images : matched;
    const images = kept.slice(0, MAX_PHOTOS_PER_DEMO);

    await rpc("amobla_account", { p_user: userId, p_trial: false });
    const id = await createDemo({
      actorId: userId,
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

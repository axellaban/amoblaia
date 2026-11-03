import "server-only";
import { HttpError, rpc } from "@/lib/commerce/http";
import { createDemo, MAX_PHOTOS_PER_DEMO } from "@/lib/demos/server";
import { readJson } from "@/lib/demos/input";
import { readListing } from "@/lib/demos/listing";
import { cleanText, cleanUrl, isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { startImport, updateImport, type ImportRow } from "./imports";
import { existingImport, logImport } from "./panel";
import type { ImportTarget } from "./import-flow";

const PRIVATE = { "Cache-Control": "private, no-store" };
const FALLBACK_TITLE = "Fotos importadas";

/**
 * Photos of a listing without a ficha: a photo group of the agency (demos
 * with kind 'fotos') that keeps the listing's address and the photos kept.
 * The browser downloads them and reports with PATCH /api/panel/importar, as
 * for any import. No ficha is created, nothing is staged and no credit is
 * used. The same key returns the group already made; a listing that already
 * has a property in the agency is not copied again (409 with its id).
 */
export async function importPhotoGroup(request: Request, target: ImportTarget) {
  let started: ImportRow | null = null;
  let ctx: { url: string } | null = null;
  try {
    const body = await readJson(request, 32768);
    const pasted = cleanUrl(body.url);
    if (!pasted) throw new HttpError(400, "Pegá la URL de la publicación.");
    if (!isUuid(body.key)) throw new HttpError(400, "Volvé a leer la publicación e intentá de nuevo.");
    ctx = { url: pasted };
    const { row, replay } = await startImport(target.agencyId, target.userId, pasted, body.key);
    if (replay) return Response.json(groupResult(row, { replay: true }), { status: row.demo_id ? 200 : 409, headers: PRIVATE });
    started = row;

    const listing = await readListing(pasted);
    const imp = listing.imported;
    const duplicateOf = await existingImport(target.agencyId, listing.listingUrl);
    if (duplicateOf) {
      await updateImport(row.id, { status: "duplicate", demo_id: duplicateOf, error: null });
      started = null;
      return Response.json({ error: "Esta publicación ya está en tu panel.", duplicateOf }, { status: 409, headers: PRIVATE });
    }

    // The photos kept on the panel: only offered ones count (never a picture the listing did not show).
    const offered = new Set(imp.images);
    const kept = Array.isArray(body.images) ? imp.images.filter((src) => (body.images as unknown[]).includes(src)) : imp.images;
    const images = kept.filter((src) => offered.has(src)).slice(0, MAX_PHOTOS_PER_DEMO);

    await rpc("amobla_account", { p_user: target.userId, p_trial: false });
    const id = await createDemo({
      actorId: target.userId,
      agencyId: target.agencyId,
      agency: null,
      kind: "fotos",
      property: {
        title: cleanText(imp.title, 160) || FALLBACK_TITLE,
        location: cleanText(imp.location, 160),
        listing_url: listing.listingUrl,
        description: null,
        origin: target.origin,
      },
    });
    const { data: demo } = await adminClient().from("demos").select("property_id").eq("id", id).single();
    const propertyId = (demo as { property_id: string } | null)?.property_id ?? null;
    const done = {
      ...row,
      status: images.length ? "partial" : "completed",
      demo_id: id,
      photos_total: images.length,
      photos_done: 0,
      pending_images: images,
      settings_saved: true,
      error: null,
    } as ImportRow;
    await updateImport(row.id, {
      status: done.status,
      demo_id: id,
      photos_total: done.photos_total,
      photos_done: 0,
      pending_images: images,
      settings_saved: true,
      error: null,
      property_id: propertyId,
    });
    started = null;
    return Response.json(groupResult(done, { title: cleanText(imp.title, 160) || FALLBACK_TITLE }), { status: 201, headers: PRIVATE });
  } catch (e) {
    if (started)
      await updateImport(started.id, {
        status: "failed",
        error: e instanceof HttpError ? e.message.slice(0, 300) : "No pudimos leer las fotos de esa publicación.",
      }).catch(() => null);
    else if (ctx && e instanceof HttpError && ![401, 403, 409].includes(e.status))
      await logImport({ agencyId: target.agencyId, userId: target.userId, url: ctx.url, status: "failed", error: e.message });
    throw e;
  }
}

/** The group made for uploaded files: an empty photo group the browser then fills, one file per request. */
export async function createUploadGroup(request: Request, target: ImportTarget) {
  const body = await readJson(request, 2048);
  await rpc("amobla_account", { p_user: target.userId, p_trial: false });
  const id = await createDemo({
    actorId: target.userId,
    agencyId: target.agencyId,
    agency: null,
    kind: "fotos",
    property: {
      title: cleanText(body.name, 160) || FALLBACK_TITLE,
      location: null,
      listing_url: null,
      description: null,
      origin: target.origin,
    },
  });
  return Response.json({ id }, { status: 201, headers: PRIVATE });
}

/**
 * Turns a photo group into a ficha (a draft, as any new property). Its photos,
 * versions and link are kept; nothing is published here.
 */
export async function makeFicha(agencyId: string, demoId: string) {
  if (!isUuid(demoId)) throw new HttpError(404, "No encontramos ese grupo de fotos.");
  const db = adminClient();
  const { data, error } = await db.from("demos").select("id,kind").eq("id", demoId).eq("agency_id", agencyId).maybeSingle();
  if (error) throw new Error("PHOTO_GROUP_LOOKUP_FAILED");
  const group = data as { id: string; kind: string } | null;
  if (!group) throw new HttpError(404, "No encontramos ese grupo de fotos.");
  if (group.kind === "ficha") throw new HttpError(409, "Ese grupo ya es una ficha.");
  const { error: updateError } = await db.from("demos").update({ kind: "ficha" }).eq("id", demoId).eq("agency_id", agencyId).eq("kind", "fotos");
  if (updateError) throw new Error("PHOTO_GROUP_FICHA_FAILED");
  return Response.json({ id: demoId, kind: "ficha" }, { headers: PRIVATE });
}

/** Result of an import or a group, in the words the panel shows. */
function groupResult(row: ImportRow, extra: Record<string, unknown> = {}) {
  return {
    importId: row.id,
    id: row.demo_id,
    status: row.status,
    photosTotal: row.photos_total ?? 0,
    photosDone: row.photos_done ?? 0,
    images: row.pending_images ?? [],
    ...extra,
  };
}

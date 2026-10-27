import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { cleanText, isUuid, SPACE_TYPES } from "./shared";
import { spacesOf } from "./server";

/** Most spaces a property may have: rooms of a home or an office, never a building. */
export const MAX_SPACES = 40;
const MIGRATION = "Para organizar por espacios falta aplicar la migración 202610310001_property_spaces.sql en Supabase.";

const validType = (v: unknown): v is string => typeof v === "string" && SPACE_TYPES.some((t) => t.id === v);

/** What the editor needs after a change: the spaces in order and where each photo is. */
export async function spaceState(propertyId: string) {
  const s = await spacesOf(propertyId);
  if (!s.ready) throw new HttpError(409, MIGRATION);
  return { spaces: s.list, assignments: Object.fromEntries(s.photoSpace) as Record<string, string> };
}

export async function createSpace(propertyId: string, raw: Record<string, unknown>) {
  const name = cleanText(raw.name, 60);
  if (!name) throw new HttpError(400, "Poné un nombre al espacio, por ejemplo «Dormitorio 2».");
  const roomType = validType(raw.roomType) ? raw.roomType : "other";
  const current = await spacesOf(propertyId);
  if (!current.ready) throw new HttpError(409, MIGRATION);
  if (current.list.length >= MAX_SPACES) throw new HttpError(400, `Una propiedad admite hasta ${MAX_SPACES} espacios.`);
  const position = current.list.reduce((max, s) => Math.max(max, s.position + 1), 0);
  const { data, error } = await adminClient()
    .from("property_spaces")
    .insert({ property_id: propertyId, name, room_type: roomType, position })
    .select("id")
    .single();
  if (error) throw new Error("SPACE_CREATE_FAILED");
  return (data as { id: string }).id;
}

export async function updateSpace(propertyId: string, spaceId: string, raw: Record<string, unknown>) {
  if (!isUuid(spaceId)) throw new HttpError(404, "No encontramos el espacio.");
  const changes: Record<string, unknown> = {};
  if ("name" in raw) {
    const name = cleanText(raw.name, 60);
    if (!name) throw new HttpError(400, "El espacio necesita un nombre.");
    changes.name = name;
  }
  if ("roomType" in raw) {
    if (!validType(raw.roomType)) throw new HttpError(400, "Elegí un tipo de espacio válido.");
    changes.room_type = raw.roomType;
  }
  if (!Object.keys(changes).length) throw new HttpError(400, "No hay cambios para guardar.");
  const { data, error } = await adminClient()
    .from("property_spaces")
    .update(changes)
    .eq("id", spaceId)
    .eq("property_id", propertyId)
    .select("id");
  if (error) throw new Error("SPACE_UPDATE_FAILED");
  if (!(data ?? []).length) throw new HttpError(404, "No encontramos el espacio.");
}

/** New order of the property's spaces: every id once. */
export async function orderSpaces(propertyId: string, ids: unknown) {
  const current = await spacesOf(propertyId);
  if (!current.ready) throw new HttpError(409, MIGRATION);
  const list = Array.isArray(ids) ? ids : [];
  const known = new Set(current.list.map((s) => s.id));
  if (list.length !== known.size || new Set(list).size !== list.length || !list.every((x) => known.has(x as string)))
    throw new HttpError(400, "El orden no coincide con los espacios de la propiedad.");
  const db = adminClient();
  for (const [position, id] of (list as string[]).entries()) {
    const { error } = await db.from("property_spaces").update({ position }).eq("id", id).eq("property_id", propertyId);
    if (error) throw new Error("SPACE_ORDER_FAILED");
  }
}

/**
 * Moves photos of this property to a space of it (or to "Sin organizar").
 * Only the grouping changes: no project, version or credit is touched.
 */
export async function assignPhotos(propertyId: string, photoIds: unknown, spaceId: unknown) {
  const ids = Array.isArray(photoIds) ? [...new Set(photoIds.filter(isUuid))] : [];
  if (!ids.length || ids.length > 200) throw new HttpError(400, "Elegí las fotos a mover.");
  const target = spaceId === null || spaceId === "" ? null : spaceId;
  const db = adminClient();
  if (target !== null) {
    if (!isUuid(target)) throw new HttpError(404, "No encontramos el espacio.");
    const { data, error } = await db.from("property_spaces").select("id").eq("id", target).eq("property_id", propertyId).maybeSingle();
    if (error) throw new HttpError(409, MIGRATION);
    if (!data) throw new HttpError(404, "No encontramos el espacio.");
  }
  const { data: own, error: ownError } = await db.from("demo_photos").select("id").eq("property_id", propertyId).in("id", ids);
  if (ownError) throw new Error("DEMO_PHOTOS_LOOKUP_FAILED");
  if ((own ?? []).length !== ids.length) throw new HttpError(404, "Alguna foto no es de esta propiedad.");
  const { error } = await db.from("demo_photos").update({ space_id: target }).eq("property_id", propertyId).in("id", ids);
  if (error) throw new HttpError(409, MIGRATION);
}

/**
 * Deletes a space. Its photos go to another space of the property, or to
 * "Sin organizar"; no photo, project or version is deleted.
 */
export async function deleteSpace(propertyId: string, spaceId: string, moveTo: string | null) {
  if (!isUuid(spaceId)) throw new HttpError(404, "No encontramos el espacio.");
  if (moveTo === spaceId) throw new HttpError(400, "Elegí otro espacio para sus fotos.");
  const db = adminClient();
  const { data: photos, error } = await db.from("demo_photos").select("id").eq("property_id", propertyId).eq("space_id", spaceId);
  if (error) throw new HttpError(409, MIGRATION);
  const ids = ((photos ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length) await assignPhotos(propertyId, ids, moveTo);
  const removed = await db.from("property_spaces").delete().eq("id", spaceId).eq("property_id", propertyId).select("id");
  if (removed.error) throw new Error("SPACE_DELETE_FAILED");
  if (!(removed.data ?? []).length) throw new HttpError(404, "No encontramos el espacio.");
  return ids.length;
}

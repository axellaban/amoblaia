// La demo armada sola, del lado del servidor:
// - las fotos de la publicación, con el mismo lector de «Completar desde la publicación» (una lectura
//   nueva, con las direcciones de foto de ahora) y reintentos;
// - qué fotos se ambientan, mirando cada imagen: el mejor living, comedor y dormitorio, y la portada.
// La tanda de estilos y la publicación las hace el editor («Preparar demo completa»), que ya sabe
// seguir cada versión hasta que termina.
import "server-only";
import sharp from "sharp";
import { BUCKET } from "@/lib/commerce/jobs";
import { HttpError } from "@/lib/commerce/http";
import { checkPhoto } from "@/lib/listings/photo-check";
import { photoKey, reportPhotos } from "@/lib/agency/imports";
import { adminClient } from "@/lib/supabase/server";
import { cleanClasses, pickForDemo, AUTO_STYLES, CLASS_ROOMS, type PhotoClass } from "./auto-prep-logic";
import { fetchPublic, readListing } from "./listing";
import { addPhoto, adminImagePaths, demoRow, MAX_PHOTOS_PER_DEMO } from "./server";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PhotoImport = { total: number; added: number; already: number; failed: number; reasons: string[]; attempts: number };

/**
 * Trae a la propiedad las fotos de su publicación. Cada vuelta vuelve a leer la publicación (las
 * direcciones de algunas webs vencen o cambian) y pide solo las que faltan; hasta `attempts`
 * vueltas, con una pausa creciente. Las fotos que ya están no se duplican ni pierden sus versiones.
 * Las fotos quedan del dueño de la inmobiliaria si tiene cuenta; si no, de `actorId` (el equipo).
 * Al terminar, las importaciones de esa propiedad que esperaban fotos quedan al día.
 */
export async function importListingPhotos(
  demoId: string,
  actorId: string,
  { attempts = 3, deadline = Date.now() + 240_000 }: { attempts?: number; deadline?: number } = {},
): Promise<PhotoImport> {
  const demo = await demoRow(demoId);
  const db = adminClient();
  const [{ data: prop }, { data: agency }] = await Promise.all([
    db.from("demo_properties").select("listing_url").eq("id", demo.property_id).maybeSingle(),
    db.from("agencies").select("owner_id").eq("id", demo.agency_id).maybeSingle(),
  ]);
  const url = (prop as { listing_url: string | null } | null)?.listing_url;
  if (!url) throw new HttpError(400, "La propiedad no tiene la URL de su publicación.");
  const owner = (agency as { owner_id: string | null } | null)?.owner_id ?? null;
  const done = new Set<string>();
  const reasons = new Map<string, string>();
  let total = 0, added = 0, already = 0, round = 0;
  let images: string[] = [];
  while (round < attempts && Date.now() < deadline) {
    if (round) await sleep(1500 * round);
    round++;
    try {
      images = (await readListing(url)).imported.images.slice(0, MAX_PHOTOS_PER_DEMO);
    } catch (e) {
      reasons.set("publicacion", e instanceof Error ? e.message : "No se pudo leer la publicación.");
      continue;
    }
    reasons.delete("publicacion");
    total = images.length;
    const missing = images.filter((src) => !done.has(photoKey(src)));
    if (!missing.length) break;
    for (const src of missing) {
      if (Date.now() > deadline) break;
      try {
        const image = await fetchPublic(src, "image");
        await checkPhoto(image.body, image.type);
        const file = new URL(image.url).pathname.split("/").pop() || "";
        let name = file;
        try {
          name = decodeURIComponent(file);
        } catch {
          // Un nombre mal escapado queda como viene.
        }
        const row = await addPhoto(demo, owner ?? actorId, image.body, name.replace(/\.[^.]+$/, ""), { reuse: true, ownOnly: Boolean(owner) });
        if (row.reused) already++;
        else added++;
        done.add(photoKey(src));
        reasons.delete(src);
      } catch (e) {
        // «Ya está en la demo» es lo que se buscaba.
        if (e instanceof HttpError && e.status === 409 && /ya está en la demo/.test(e.message)) {
          already++;
          done.add(photoKey(src));
          continue;
        }
        if (e instanceof HttpError && e.status === 409) {
          reasons.set(src, e.message);
          round = attempts; // The demo is full: another round would not help.
          break;
        }
        reasons.set(src, e instanceof Error ? e.message : "No se pudo descargar.");
      }
    }
    if (images.every((src) => done.has(photoKey(src)))) break;
  }
  await settleImports(demo.agency_id, demoId, images, done).catch((e) => console.error("AUTO_PREP_IMPORT_SETTLE_FAILED", e));
  const failed = images.filter((src) => !done.has(photoKey(src))).length;
  return { total, added, already, failed, reasons: [...reasons.values()].slice(0, 5), attempts: round };
}

/** Las importaciones de esa propiedad que esperaban fotos: las que ya están dejan de figurar como pendientes. */
async function settleImports(agencyId: string, demoId: string, images: string[], done: Set<string>) {
  const { data, error } = await adminClient()
    .from("property_imports")
    .select("id,pending_images")
    .eq("agency_id", agencyId)
    .eq("demo_id", demoId);
  if (error) return;
  const everything = images.length > 0 && images.every((src) => done.has(photoKey(src)));
  for (const row of (data ?? []) as { id: string; pending_images: string[] | null }[]) {
    const pending = row.pending_images ?? [];
    if (!pending.length) continue;
    // With every photo of the listing in, the old addresses are in too, even if they changed since.
    const ok = everything ? pending : pending.filter((src) => done.has(photoKey(src)));
    await reportPhotos(agencyId, row.id, ok, pending.filter((src) => !ok.includes(src)));
  }
}

// ── Qué fotos se ambientan ──────────────────────────────────────────────────

const VISION_MODELS = () => [...new Set([process.env.OPENAI_VISION_MODEL?.trim() || "gpt-4.1-mini", "gpt-4o-mini"])];
const MAX_CLASSIFIED = 24;
const INSTRUCTIONS = [
  "You classify real-estate listing photos from Argentina for virtual staging.",
  "For each photo (by its index) answer: room, furnished and score.",
  `room is one of: ${CLASS_ROOMS.join(", ")}. Use living_dining for one open space with both. exterior is a façade or street; outdoor is a patio, balcony or terrace; plan is a floor plan or a graphic.`,
  "furnished is true when the room already has furniture (sofa, bed, table), false when it is empty or almost empty.",
  "score from 0 to 10: how good the photo is to show a staging of that room: interior, wide, well lit, level, sharp, showing floor and walls, not a close-up, not cut by a door frame. Bathrooms, kitchens, exteriors and plans can still be scored, they are simply not staged.",
].join(" ");

async function thumbnail(photoId: string) {
  const paths = await adminImagePaths({ photoId });
  if (!paths) return null;
  const file = await adminClient().storage.from(BUCKET).download(paths.original);
  if (file.error || !file.data) return null;
  const small = await sharp(Buffer.from(await file.data.arrayBuffer()), { limitInputPixels: 40_000_000 })
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
  return `data:image/jpeg;base64,${small.toString("base64")}`;
}

/** El texto de una respuesta de la API de Responses. */
function outputText(data: unknown) {
  const out = (data as { output?: { content?: { type?: string; text?: string }[] }[] })?.output ?? [];
  return out.flatMap((o) => o.content ?? []).find((c) => c.type === "output_text")?.text ?? null;
}

/**
 * Clasifica las fotos mirando cada imagen (una sola consulta, en miniatura). Sin la clave de OpenAI o
 * si no responde, usa el ambiente que ya tiene cada foto y su orden: nunca deja la demo sin preparar.
 */
export async function classifyPhotos(photos: { id: string; room: string }[]): Promise<{ classes: PhotoClass[]; byImage: boolean }> {
  const list = photos.slice(0, MAX_CLASSIFIED);
  const fallback = () => ({
    byImage: false,
    classes: list.map((p, i) => ({ photoId: p.id, room: p.room, furnished: false, score: Math.max(0, 10 - i) })),
  });
  if (!process.env.OPENAI_API_KEY || !list.length) return fallback();
  const thumbs = await Promise.all(list.map((p) => thumbnail(p.id).catch(() => null)));
  const content: Record<string, unknown>[] = [{ type: "input_text", text: `There are ${list.length} photos, indexed from 0.` }];
  thumbs.forEach((t, i) => {
    content.push({ type: "input_text", text: `Photo ${i}${t ? "" : " (could not be loaded: room other, score 0)"}` });
    if (t) content.push({ type: "input_image", image_url: t, detail: "low" });
  });
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["photos"],
    properties: {
      photos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "room", "furnished", "score"],
          properties: {
            index: { type: "integer" },
            room: { type: "string", enum: [...CLASS_ROOMS] },
            furnished: { type: "boolean" },
            score: { type: "number" },
          },
        },
      },
    },
  };
  for (const model of VISION_MODELS()) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          instructions: INSTRUCTIONS,
          input: [{ role: "user", content }],
          text: { format: { type: "json_schema", name: "listing_photos", strict: true, schema } },
          max_output_tokens: 2000,
          store: false,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        console.error("auto_prep_classify_error", model, response.status);
        if ([400, 403, 404].includes(response.status)) continue;
        break;
      }
      const text = outputText(await response.json());
      if (!text) continue;
      const classes = cleanClasses(JSON.parse(text), list.map((p) => p.id));
      return { classes: classes.map((c, i) => (thumbs[i] ? c : { ...c, room: "other", score: 0 })), byImage: true };
    } catch (e) {
      console.error("auto_prep_classify_failed", model, e instanceof Error ? e.name : e);
    }
  }
  return fallback();
}

export type AutoPrepChoice = {
  picks: { photoId: string; room: string; mode: "furnish" | "redesign" }[];
  cover: string | null;
  styles: string[];
  byImage: boolean;
  classes: PhotoClass[];
};

/**
 * Elige qué se ambienta y deja la propiedad lista para la tanda: ambiente y operación de las 3 fotos
 * elegidas, la mejor de portada (y primera en la galería), y Nórdico como estilo principal.
 * Nada se genera acá ni se usan créditos.
 */
export async function chooseForDemo(demoId: string): Promise<AutoPrepChoice> {
  const demo = await demoRow(demoId);
  const db = adminClient();
  const { data, error } = await db
    .from("demo_photos")
    .select("id,room,visible,position")
    .eq("property_id", demo.property_id)
    .order("position");
  if (error) throw new Error("DEMO_PHOTOS_LOOKUP_FAILED");
  const all = (data ?? []) as { id: string; room: string; visible: boolean; position: number }[];
  const visible = all.filter((p) => p.visible);
  if (!visible.length) throw new HttpError(409, "La propiedad todavía no tiene fotos: importalas primero.");
  const { classes, byImage } = await classifyPhotos(visible);
  const { picks, cover } = pickForDemo(classes);
  if (!picks.length) throw new HttpError(409, "No encontramos fotos de living, comedor ni dormitorio para ambientar. Elegilas a mano.");
  const updates = await Promise.all(picks.map((p) => db.from("demo_photos").update({ room: p.room, mode: p.mode }).eq("id", p.photoId)));
  if (updates.some((r) => r.error)) throw new Error("DEMO_PHOTO_UPDATE_FAILED");
  // The cover first in the gallery, then the other picks, then everything else as it was.
  const first = [cover, ...picks.map((p) => p.photoId)].filter((id, i, a): id is string => Boolean(id) && a.indexOf(id) === i);
  const order = [...first, ...all.map((p) => p.id).filter((id) => !first.includes(id))];
  const positions = await Promise.all(order.map((id, position) => db.from("demo_photos").update({ position }).eq("id", id)));
  if (positions.some((r) => r.error)) throw new Error("DEMO_ORDER_FAILED");
  const [coverSaved, mainSaved] = await Promise.all([
    db.from("demos").update({ cover_photo_id: cover }).eq("id", demo.id),
    db.from("demo_photos").update({ style: AUTO_STYLES[0] }).eq("property_id", demo.property_id),
  ]);
  if (coverSaved.error) throw new Error("DEMO_COVER_FAILED");
  if (mainSaved.error) throw new Error("DEMO_STYLE_FAILED");
  return { picks: picks.map(({ photoId, room, mode }) => ({ photoId, room, mode })), cover, styles: [...AUTO_STYLES], byImage, classes };
}

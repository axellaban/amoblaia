// Precargas automáticas: con el sitio de la inmobiliaria, dos publicaciones más con fotos interiores,
// para dejarlas en su panel como «Lista para importar». Se leen con el mismo lector de las
// importaciones; no se crea nada acá.
import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { fetchPublic, readListing } from "@/lib/demos/listing";
import { listingLinks } from "@/lib/listings/discover";
import { portalOfListing, sameListing } from "@/lib/prospecting/pool";
import { adminClient } from "@/lib/supabase/server";

export type PreloadCandidate = { url: string; title: string | null; photos: number; interiors: number | null };

/** Mínimo de fotos de una publicación para dejarla precargada. */
const MIN_PHOTOS = 4;
/** Cuántas fichas se leen como mucho para encontrar las que sirven. */
const MAX_PROBES = 8;

async function pageLinks(url: string, exclude: string[]) {
  const page = await fetchPublic(url, "page");
  return listingLinks(Buffer.from(page.body).toString("utf8"), page.url, exclude);
}

/**
 * Cuántas de estas fotos (hasta 5, sin la primera, que suele ser la fachada) muestran un ambiente
 * interior para ambientar. Sin la clave de OpenAI o sin respuesta: null (no se sabe, no se descarta).
 */
async function interiorCount(images: string[]) {
  if (!process.env.OPENAI_API_KEY) return null;
  const sample = images.slice(1, 6);
  if (!sample.length) return 0;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL?.trim() || "gpt-4.1-mini",
        instructions:
          "Count how many of these real-estate photos show an interior living room, dining room or bedroom that could be virtually staged (not bathrooms, kitchens, façades, plans or close-ups).",
        input: [{ role: "user", content: sample.map((u) => ({ type: "input_image", image_url: u, detail: "low" })) }],
        text: {
          format: {
            type: "json_schema",
            name: "interiors",
            strict: true,
            schema: { type: "object", additionalProperties: false, required: ["interiors"], properties: { interiors: { type: "integer" } } },
          },
        },
        max_output_tokens: 50,
        store: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { output?: { content?: { type?: string; text?: string }[] }[] };
    const text = (data.output ?? []).flatMap((o) => o.content ?? []).find((c) => c.type === "output_text")?.text;
    const n = text ? Number((JSON.parse(text) as { interiors?: unknown }).interiors) : NaN;
    return Number.isFinite(n) ? Math.max(0, Math.min(sample.length, Math.round(n))) : null;
  } catch {
    return null;
  }
}

/**
 * Hasta `want` publicaciones de la web de la inmobiliaria que se pueden importar y tienen fotos
 * interiores, distintas de `exclude` y de las que ya están en su panel. Lee la portada del sitio y,
 * si ahí no hay fichas suficientes, su página de propiedades.
 */
export async function findPreloads(
  agencyId: string,
  { want = 2, exclude = [], deadline = Date.now() + 90_000 }: { want?: number; exclude?: string[]; deadline?: number } = {},
): Promise<PreloadCandidate[]> {
  const db = adminClient();
  const [{ data: agency }, { data: props }] = await Promise.all([
    db.from("agencies").select("website").eq("id", agencyId).maybeSingle(),
    db.from("demo_properties").select("listing_url").eq("agency_id", agencyId),
  ]);
  const site = (agency as { website: string | null } | null)?.website?.trim();
  if (!site) throw new HttpError(409, "La inmobiliaria no tiene su sitio web cargado: cargalo en su ficha o pegá las publicaciones a mano.");
  const home = /^https?:\/\//i.test(site) ? site : `https://${site}`;
  if (portalOfListing(home)) throw new HttpError(409, "El sitio cargado es un portal: hace falta la web propia de la inmobiliaria.");
  const skip = [...exclude, ...((props ?? []) as { listing_url: string | null }[]).map((p) => p.listing_url).filter((u): u is string => Boolean(u))];
  let found: { listings: string[]; indexes: string[] };
  try {
    found = await pageLinks(home, skip);
  } catch (e) {
    throw new HttpError(502, `No pudimos leer el sitio de la inmobiliaria (${e instanceof Error ? e.message : "sin respuesta"}).`);
  }
  let candidates = found.listings;
  for (const index of found.indexes.slice(0, 2)) {
    if (candidates.length >= MAX_PROBES || Date.now() > deadline) break;
    const more = await pageLinks(index, skip).catch(() => null);
    if (more) candidates = [...candidates, ...more.listings.filter((u) => !candidates.some((c) => sameListing(c, u)))];
  }
  const out: PreloadCandidate[] = [];
  for (const url of candidates.filter((u) => !skip.some((s) => sameListing(s, u))).slice(0, MAX_PROBES)) {
    if (out.length >= want || Date.now() > deadline) break;
    try {
      const read = await readListing(url);
      const photos = read.imported.images.length;
      if (photos < MIN_PHOTOS) continue;
      const interiors = await interiorCount(read.imported.images);
      // Only a listing known to have no interior to stage is left out.
      if (interiors === 0) continue;
      out.push({ url: read.listingUrl, title: read.imported.title?.slice(0, 160) ?? null, photos, interiors });
    } catch {
      // A page that cannot be read is not a listing to preload.
    }
  }
  return out;
}

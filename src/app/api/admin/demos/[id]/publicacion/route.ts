import { requireAdmin, failure, HttpError } from "@/lib/commerce/http";
import { completeAgency, demoRow, saveJson, settingsOf } from "@/lib/demos/server";
import { readJson } from "@/lib/demos/input";
import { readListing } from "@/lib/demos/listing";
import { applyImport, IMPORT_FIELDS, planImport, type CurrentDemo, type ImportField } from "@/lib/demos/import";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const noStore = { "Cache-Control": "private, no-store" };

/** The demo as it is now and a new reading of its listing. */
async function read(id: string) {
  const demo = await demoRow(id);
  const { data, error } = await adminClient()
    .from("demo_properties")
    .select("title,location,listing_url")
    .eq("id", demo.property_id)
    .single();
  if (error) throw new Error("PROPERTY_LOOKUP_FAILED");
  const property = data as { title: string; location: string | null; listing_url: string | null };
  if (!property.listing_url) throw new HttpError(400, "Cargá primero la URL de la publicación original.");
  const listing = await readListing(property.listing_url);
  const current: CurrentDemo = {
    title: property.title,
    location: property.location,
    settings: (await settingsOf(demo.id)).settings,
    // What the previous, simpler reading of this same page wrote.
    generated: { title: listing.title, location: listing.location, description: listing.fullDescription },
  };
  return { demo, listing, current };
}

/**
 * Reads the original listing again. Nothing is saved: it returns what the
 * page publishes, which empty fields it would complete and where it differs
 * from a value edited by hand, for the admin to decide before overwriting.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    const { listing, current } = await read(id);
    return Response.json(
      { imported: listing.imported, ...planImport(current, listing.imported), checkedAt: new Date().toISOString() },
      { headers: noStore },
    );
  } catch (e) {
    return failure(e);
  }
}

/**
 * Completes the demo from its listing: the empty fields, the ones the old
 * reading wrote, and the conflicting ones only if listed in { replace }.
 * The link, the photos' stagings and every other manual edit are kept.
 * Returns the property's own photos, which the panel then adds or reorders.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const body = await readJson(request);
    const replace = (Array.isArray(body.replace) ? body.replace : []).filter((f: unknown): f is ImportField =>
      IMPORT_FIELDS.includes(f as ImportField),
    );
    const { demo, listing, current } = await read(id);
    const plan = planImport(current, listing.imported);
    const fields = [
      ...plan.fill.map((c) => c.field),
      ...plan.conflicts.map((c) => c.field).filter((f) => replace.includes(f)),
    ];
    const next = applyImport(current, listing.imported, fields);
    if (fields.includes("title") || fields.includes("location")) {
      const { error } = await adminClient()
        .from("demo_properties")
        .update({ title: next.title, location: next.location })
        .eq("id", demo.property_id);
      if (error) throw new Error("PROPERTY_UPDATE_FAILED");
    }
    if (fields.length) await saveJson("demos", "settings", demo.id, next.settings);
    const completed = await completeAgency(demo.agency_id, listing.imported).catch(() => ({ logo: false, contact: false }));
    return Response.json(
      {
        fields,
        completed,
        propertyId: listing.imported.propertyId,
        images: listing.imported.images,
      },
      { headers: noStore },
    );
  } catch (e) {
    return failure(e);
  }
}

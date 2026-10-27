import { failure, HttpError, rpc } from "@/lib/commerce/http";
import { existingImport, logImport } from "@/lib/agency/panel";
import { requireAgency } from "@/lib/agency/server";
import { DEFAULT_SETTINGS } from "@/lib/demos/branding";
import { applyImport, IMPORT_FIELDS } from "@/lib/demos/import";
import { readJson } from "@/lib/demos/input";
import { readListing } from "@/lib/demos/listing";
import { completeAgency, createDemo, MAX_PHOTOS_PER_DEMO, saveJson } from "@/lib/demos/server";
import { cleanText, cleanUrl } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };

/**
 * A property of the agency from the URL of its listing, with the same reader
 * the team uses for demos (public addresses only, size and time limits).
 * { url, preview: true } only reads and returns everything found, field by
 * field, plus the property already imported from that URL, if any. Without
 * preview it creates the property with the fields as corrected on the
 * preview and the photos kept there, and returns those photos, which the
 * panel imports one by one. Nothing is staged, no credit is used and the
 * property starts as a draft.
 */
export async function POST(request: Request) {
  let ctx: { agencyId: string; userId: string; url: string } | null = null;
  try {
    const { user, agency } = await requireAgency(request);
    const body = await readJson(request, 32768);
    const pasted = cleanUrl(body.url);
    ctx = { agencyId: agency.id, userId: user.id, url: typeof pasted === "string" ? pasted : String(body.url ?? "").slice(0, 500) };
    const listing = await readListing(body.url);
    const imp = listing.imported;
    const duplicateOf = await existingImport(agency.id, listing.listingUrl);
    if (body.preview === true)
      return Response.json({ ...imp, listingUrl: listing.listingUrl, duplicateOf }, { headers: PRIVATE });
    if (duplicateOf) {
      await logImport({ ...ctx, status: "duplicate", propertyId: null });
      return Response.json(
        { error: "Esta propiedad ya está en tu panel.", duplicateOf },
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
    const kept = Array.isArray(body.images)
      ? imp.images.filter((src) => (body.images as unknown[]).includes(src))
      : imp.images;
    const images = kept.slice(0, MAX_PHOTOS_PER_DEMO);

    await rpc("amobla_account", { p_user: user.id, p_trial: false });
    const id = await createDemo({
      actorId: user.id,
      agencyId: agency.id,
      agency: null,
      property: {
        title,
        location,
        listing_url: listing.listingUrl,
        description: cleanText(listing.description, 1000, true),
        origin: "agency",
      },
    });
    const saved = await saveJson("demos", "settings", id, settings).then(
      () => true,
      () => false,
    );
    await completeAgency(agency.id, imp).catch(() => null);
    const { data: demo } = await adminClient()
      .from("demos")
      .select("property_id")
      .eq("id", id)
      .single();
    await logImport({ ...ctx, status: "completed", propertyId: (demo as { property_id: string } | null)?.property_id ?? null });
    return Response.json({ id, title, images, saved }, { status: 201, headers: PRIVATE });
  } catch (e) {
    if (ctx && e instanceof HttpError && e.status !== 409 && e.status !== 401 && e.status !== 403)
      await logImport({ ...ctx, status: "failed", error: e.message });
    return failure(e);
  }
}

import { requireAdmin, failure, HttpError, rpc } from "@/lib/commerce/http";
import { completeAgency, createDemo, saveAgencyWhatsapp, saveJson, whatsappOf } from "@/lib/demos/server";
import { DEFAULT_SETTINGS } from "@/lib/demos/branding";
import { importedMap, readJson, whatsappInput } from "@/lib/demos/input";
import { normalizeArNumber } from "@/lib/demos/send";
import { readListing } from "@/lib/demos/listing";
import { applyImport, IMPORT_FIELDS } from "@/lib/demos/import";
import { cleanText, isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

const host = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : "";
  } catch {
    return "";
  }
};
const noStore = { "Cache-Control": "private, no-store" };

/**
 * From the URL of a listing on the agency's website. With { preview: true }
 * it only reads the page and returns everything found, field by field, with
 * what could not be read and why: nothing is saved. Without it, it creates
 * the demo with all that data (the agency with the same site is reused and
 * only completed) and returns the property's own photos, which the panel
 * then imports one by one, in order.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const body = await readJson(request);
    const listing = await readListing(body.url);
    const imp = listing.imported;
    const db = adminClient();
    const { data: agencies, error } = await db
      .from("agencies")
      .select("id,name,website")
      .not("website", "is", null)
      .limit(1000);
    if (error) throw new Error("AGENCY_LIST_FAILED");
    const site = host(listing.agency.website);
    // Created from an agency's page: that agency (validated here), never a new one by name.
    let agency: { id: string; name: string } | null = null;
    if (isUuid(body.agencyId)) {
      const chosen = await db.from("agencies").select("id,name").eq("id", body.agencyId).maybeSingle();
      if (chosen.error) throw new Error("AGENCY_LOOKUP_FAILED");
      if (!chosen.data) throw new HttpError(404, "No encontramos esa inmobiliaria.");
      agency = chosen.data as { id: string; name: string };
    } else
      agency =
        (agencies as { id: string; name: string; website: string | null }[]).find(
          (a) => host(a.website) === site,
        ) ?? null;
    // The agency's WhatsApp to send it the demo: the one we have, else the listing's.
    // When neither exists the panel asks for it.
    const found = normalizeArNumber(imp.agency.whatsapp);
    const known = agency ? ((await whatsappOf([agency.id])).get(agency.id) ?? null) : null;
    if (body.preview === true)
      return Response.json(
        { ...imp, listingUrl: listing.listingUrl, existingAgency: agency?.name ?? null, agencyWhatsapp: known ?? found },
        { headers: noStore },
      );
    const typed = whatsappInput(body.whatsapp);

    // Decisions taken on the preview: which of two published prices to show,
    // and a contact for inquiries when the listing has none.
    let settings = applyImport(
      { title: imp.title, location: imp.location, settings: DEFAULT_SETTINGS, generated: { title: null, location: null, description: null } },
      imp,
      [...IMPORT_FIELDS],
    );
    settings = { ...settings, settings: { ...settings.settings, map: importedMap(imp, body.map, settings.settings.map) } };
    const chosen = typeof body.price === "string" ? body.price : null;
    if (imp.priceConflict && chosen && imp.priceOptions.includes(chosen))
      settings = { ...settings, settings: { ...settings.settings, price: chosen, priceConflict: null } };
    await rpc("amobla_account", { p_user: actor.id, p_trial: false });
    const id = await createDemo({
      actorId: actor.id,
      agencyId: agency?.id ?? null,
      agency: agency
        ? null
        : {
            name: imp.agency.name ?? listing.agency.name,
            website: listing.agency.website,
            contact_name: null,
            notes: null,
          },
      property: {
        title: settings.title,
        location: settings.location,
        listing_url: listing.listingUrl,
        description: listing.description,
      },
    });
    const { data: demo } = await db.from("demos").select("agency_id").eq("id", id).single();
    const agencyId = (demo as { agency_id: string } | null)?.agency_id ?? agency?.id;
    // The listing's data is the demo's: a failure here leaves it to the review panel, not lost.
    const saved = await saveJson("demos", "settings", id, settings.settings).then(
      () => true,
      () => false,
    );
    const completed = agencyId
      ? await completeAgency(agencyId, imp, cleanText(body.contact, 120)).catch(() => ({ logo: false, contact: false }))
      : { logo: false, contact: false };
    // What the team typed replaces; what the listing publishes only fills a gap.
    if (agencyId && (typed || (found && !known)))
      await saveAgencyWhatsapp(agencyId, typed ?? found, !typed).catch(() => undefined);
    await db.from("admin_audit").insert({
      actor_id: actor.id,
      action: "demo_create",
      subject_id: id,
      details: { agencyId: agency?.id ?? "new", from: "listing_url" },
    });
    return Response.json(
      { id, title: settings.title, agency: imp.agency.name, images: imp.images, saved, completed },
      { status: 201, headers: noStore },
    );
  } catch (e) {
    return failure(e);
  }
}

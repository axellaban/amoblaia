import { requireAdmin, failure, rpc } from "@/lib/commerce/http";
import { createDemo, saveJson } from "@/lib/demos/server";
import { DEFAULT_SETTINGS } from "@/lib/demos/branding";
import { readJson } from "@/lib/demos/input";
import { readListing } from "@/lib/demos/listing";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

const host = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : "";
  } catch {
    return "";
  }
};

/**
 * Creates a draft demo from the URL of a listing on the agency's website:
 * reads the page, reuses the agency with the same site (or creates it) and
 * returns the photo addresses found, which the panel then imports one by one.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const body = await readJson(request);
    const listing = await readListing(body.url);
    const db = adminClient();
    const { data: agencies, error } = await db
      .from("agencies")
      .select("id,website")
      .not("website", "is", null)
      .limit(1000);
    if (error) throw new Error("AGENCY_LIST_FAILED");
    const site = host(listing.agency.website);
    const agencyId =
      (agencies as { id: string; website: string | null }[]).find(
        (a) => host(a.website) === site,
      )?.id ?? null;
    await rpc("amobla_account", { p_user: actor.id, p_trial: false });
    const id = await createDemo({
      actorId: actor.id,
      agencyId,
      agency: agencyId
        ? null
        : { name: listing.agency.name, website: listing.agency.website, contact_name: null, notes: null },
      property: {
        title: listing.title,
        location: listing.location,
        listing_url: listing.listingUrl,
        description: listing.description,
      },
    });
    // The full description and the price, as published. Several different
    // amounts are not resolved here: the admin sees the conflict and decides.
    await saveJson("demos", "settings", id, {
      ...DEFAULT_SETTINGS,
      description: listing.fullDescription,
      price: listing.prices.length === 1 ? listing.prices[0] : null,
      priceConflict:
        listing.prices.length > 1 ? `la publicación muestra ${listing.prices.join(", ")}` : null,
    }).catch(() => null);
    await db.from("admin_audit").insert({
      actor_id: actor.id,
      action: "demo_create",
      subject_id: id,
      details: { agencyId: agencyId ?? "new", from: "listing_url" },
    });
    return Response.json(
      { id, title: listing.title, agency: listing.agency.name, images: listing.images },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

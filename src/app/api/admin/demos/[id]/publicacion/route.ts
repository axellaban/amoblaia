import { requireAdmin, failure, HttpError } from "@/lib/commerce/http";
import { demoRow } from "@/lib/demos/server";
import { readListing } from "@/lib/demos/listing";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

/**
 * Reads the original listing again and returns what it says now. Nothing is
 * saved: the panel compares it with the demo and the admin decides field by
 * field, so manual corrections are never overwritten silently.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const demo = await demoRow(id);
    const { data, error } = await adminClient()
      .from("demo_properties")
      .select("listing_url")
      .eq("id", demo.property_id)
      .single();
    if (error) throw new Error("PROPERTY_LOOKUP_FAILED");
    const url = (data as { listing_url: string | null }).listing_url;
    if (!url) throw new HttpError(400, "Cargá primero la URL de la publicación original.");
    const listing = await readListing(url);
    return Response.json(
      {
        title: listing.title,
        location: listing.location,
        description: listing.fullDescription ?? listing.description,
        prices: listing.prices,
        photos: listing.images.length,
        checkedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

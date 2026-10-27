import "server-only";
import { brandingOf } from "@/lib/demos/server";
import { DEFAULT_PRIMARY, readSettings, textOn, whatsappNumber } from "@/lib/demos/branding";
import { publicImageUrl } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { validSlug } from "./shared";

export type SiteProperty = {
  token: string;
  title: string;
  location: string | null;
  operation: string | null;
  price: string | null;
  features: string | null;
  cover: string | null;
  staged: boolean;
};
export type PublicSite = {
  agencyId: string;
  name: string;
  slug: string;
  logo: string | null;
  primary: string;
  primaryInk: string;
  whatsapp: string | null;
  website: string | null;
  properties: SiteProperty[];
};

/**
 * An agency's public catalog: only a published site, and in it only its
 * published properties, with what a listing card shows. No notes, settings
 * or private paths: images go through the public demo image route.
 */
export async function publicSite(slug: string, opts: { preview?: boolean } = {}): Promise<PublicSite | null> {
  if (!validSlug(slug)) return null;
  const db = adminClient();
  // A private catalog is only read for its own members' preview.
  let query = db.from("agencies").select("id,name,slug,website").eq("slug", slug);
  if (!opts.preview) query = query.eq("site_published", true);
  const { data: agency } = await query.maybeSingle();
  if (!agency) return null;
  const a = agency as { id: string; name: string; slug: string; website: string | null };
  const [branding, demos] = await Promise.all([
    brandingOf(a.id),
    db
      .from("demos")
      .select("token,property_id,cover_photo_id,settings,published_at,demo_properties(title,location)")
      .eq("agency_id", a.id)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(300),
  ]);
  if (demos.error) throw new Error("SITE_DEMOS_FAILED");
  const rows = demos.data as unknown as {
    token: string;
    property_id: string;
    cover_photo_id: string | null;
    settings: unknown;
    demo_properties: { title: string; location: string | null } | null;
  }[];
  const photos = rows.length
    ? ((
        await db
          .from("demo_photos")
          .select("id,property_id,project_id,position,visible")
          .in("property_id", rows.map((r) => r.property_id))
          .eq("visible", true)
      ).data as { id: string; property_id: string; project_id: string; position: number }[] | null) ?? []
    : [];
  const projectIds = [...new Set(photos.map((p) => p.project_id))];
  const staged = new Set(
    projectIds.length
      ? (((
          await db
            .from("generations")
            .select("project_id")
            .in("project_id", projectIds)
            .eq("status", "succeeded")
            .eq("is_free", false)
        ).data as { project_id: string }[] | null) ?? []).map((g) => g.project_id)
      : [],
  );
  const primary = branding.primary ?? DEFAULT_PRIMARY;
  const whatsapp = branding.contactKind === "whatsapp" && branding.contactValue ? whatsappNumber(branding.contactValue) : null;
  return {
    agencyId: a.id,
    name: a.name,
    slug: a.slug,
    logo: branding.logo ? `/inmobiliaria/${a.slug}/logo?v=${branding.logo.v}` : null,
    primary,
    primaryInk: textOn(primary),
    whatsapp,
    website: a.website,
    properties: rows.map((r) => {
      const own = photos.filter((p) => p.property_id === r.property_id).sort((x, y) => x.position - y.position);
      const cover = own.find((p) => p.id === r.cover_photo_id) ?? own[0] ?? null;
      const s = readSettings(r.settings);
      return {
        token: r.token,
        title: r.demo_properties?.title ?? "Propiedad",
        location: r.demo_properties?.location ?? null,
        operation: s.operation,
        price: s.priceConflict ? null : s.price,
        features: s.features,
        cover: cover ? publicImageUrl(r.token, cover.id, null, 960) : null,
        staged: own.some((p) => staged.has(p.project_id)),
      };
    }),
  };
}

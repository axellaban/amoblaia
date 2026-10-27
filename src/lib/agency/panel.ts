import "server-only";
import { HttpError, rpc } from "@/lib/commerce/http";
import { brandingOf } from "@/lib/demos/server";
import { readSettings } from "@/lib/demos/branding";
import { adminClient } from "@/lib/supabase/server";
import type { Membership } from "./server";
import { slugify, type PanelProperty, type PanelSummary } from "./shared";

const check = <T>(r: { data: T; error: unknown }, code: string) => {
  if (r.error) throw new Error(code);
  return r.data;
};

/** Messages of the agency RPCs, in the panel's words. */
export async function agencyRpc<T>(name: string, args: Record<string, unknown>) {
  try {
    return await rpc<T>(name, args);
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    const known: Record<string, [number, string]> = {
      AGENCY_EXISTS: [409, "Tu cuenta ya tiene una inmobiliaria."],
      INVALID_AGENCY_NAME: [400, "Ingresá el nombre de tu inmobiliaria."],
      INVALID_SLUG: [400, "La dirección del sitio admite letras, números y guiones."],
      CLAIM_INVALID: [404, "Ese código no es válido o ya se usó. Pedile uno nuevo al equipo de habita."],
      BUSY: [409, "Hay una ambientación en curso en esa demo. Probá de nuevo en unos minutos."],
    };
    const hit = Object.keys(known).find((k) => code.includes(k));
    if (hit) throw new HttpError(known[hit][0], known[hit][1]);
    throw e;
  }
}

/** A new agency with this account as owner. */
export async function createAgency(userId: string, name: string) {
  await rpc("amobla_account", { p_user: userId, p_trial: false });
  return agencyRpc<string>("habita_create_agency", { p_user: userId, p_name: name, p_slug: slugify(name) });
}

/** Every property of the agency, newest first, with what the list shows. */
export async function agencyProperties(agencyId: string): Promise<PanelProperty[]> {
  const db = adminClient();
  const demos = check(
    await db
      .from("demos")
      .select("id,property_id,token,status,cover_photo_id,created_at,settings,demo_properties(title,location,listing_url)")
      .eq("agency_id", agencyId)
      .order("created_at", { ascending: false })
      .limit(300),
    "PANEL_DEMOS_FAILED",
  ) as unknown as {
    id: string;
    property_id: string;
    token: string;
    status: "draft" | "published";
    cover_photo_id: string | null;
    created_at: string;
    settings: unknown;
    demo_properties: { title: string; location: string | null; listing_url: string | null } | null;
  }[];
  if (!demos.length) return [];
  const photos = check(
    await db
      .from("demo_photos")
      .select("id,property_id,project_id,position,visible")
      .in("property_id", demos.map((d) => d.property_id)),
    "PANEL_PHOTOS_FAILED",
  ) as { id: string; property_id: string; project_id: string; position: number; visible: boolean }[];
  const projectIds = [...new Set(photos.map((p) => p.project_id))];
  const staged = new Set(
    projectIds.length
      ? (
          check(
            await db
              .from("generations")
              .select("project_id")
              .in("project_id", projectIds)
              .eq("status", "succeeded")
              .eq("is_free", false),
            "PANEL_STAGED_FAILED",
          ) as { project_id: string }[]
        ).map((g) => g.project_id)
      : [],
  );
  return demos.map((d) => {
    const own = photos.filter((p) => p.property_id === d.property_id).sort((a, b) => a.position - b.position);
    const settings = readSettings(d.settings);
    return {
      id: d.id,
      title: d.demo_properties?.title ?? "Propiedad",
      location: d.demo_properties?.location ?? null,
      price: settings.priceConflict ? null : settings.price,
      operation: settings.operation,
      photos: own.length,
      staged: own.filter((p) => staged.has(p.project_id)).length,
      status: d.status,
      token: d.token,
      coverPhotoId: d.cover_photo_id ?? own.find((p) => p.visible)?.id ?? null,
      listingUrl: d.demo_properties?.listing_url ?? null,
      createdAt: d.created_at,
    };
  });
}

/** Everything the panel's home shows. Credits are the owner's: one balance per agency. */
export async function panelSummary(membership: Membership): Promise<PanelSummary> {
  const { agency } = membership;
  const db = adminClient();
  const [branding, properties, imports, account] = await Promise.all([
    brandingOf(agency.id),
    agencyProperties(agency.id),
    db
      .from("property_imports")
      .select("id,url,status,error,created_at,property_id")
      .eq("agency_id", agency.id)
      .order("created_at", { ascending: false })
      .limit(10),
    agency.owner_id
      ? rpc<{ credits: number }>("amobla_account", { p_user: agency.owner_id, p_trial: false })
      : Promise.resolve({ credits: 0 }),
  ]);
  return {
    agency: {
      id: agency.id,
      name: agency.name,
      slug: agency.slug,
      website: agency.website,
      sitePublished: agency.site_published,
      logo: branding.logo ? `/api/panel/logo?v=${branding.logo.v}` : null,
      primary: branding.primary ?? null,
      whatsapp: branding.contactKind === "whatsapp" ? (branding.contactValue ?? null) : null,
      email: branding.contactKind === "email" ? (branding.contactValue ?? null) : null,
    },
    role: membership.role,
    credits: account.credits,
    properties,
    imports: ((imports.data ?? []) as { id: string; url: string; status: string; error: string | null; created_at: string; property_id: string | null }[]).map(
      (i) => ({ id: i.id, url: i.url, status: i.status, error: i.error, createdAt: i.created_at, propertyId: i.property_id }),
    ),
  };
}

/** The property of this agency that already came from this listing, if any. */
export async function existingImport(agencyId: string, listingUrl: string) {
  const { data, error } = await adminClient()
    .from("demo_properties")
    .select("id,demos(id)")
    .eq("agency_id", agencyId)
    .eq("listing_url", listingUrl)
    .limit(1);
  if (error) throw new Error("IMPORT_DUPLICATE_LOOKUP_FAILED");
  const row = (data as unknown as { id: string; demos: { id: string } | { id: string }[] | null }[])[0];
  if (!row) return null;
  const demo = Array.isArray(row.demos) ? row.demos[0] : row.demos;
  return demo?.id ?? null;
}

/** Records an import attempt; failures are kept to be retried from the panel. */
export async function logImport(entry: {
  agencyId: string;
  userId: string;
  url: string;
  status: "completed" | "failed" | "duplicate";
  propertyId?: string | null;
  error?: string | null;
}) {
  let source: string | null = null;
  try {
    source = new URL(entry.url).hostname.replace(/^www\./, "").slice(0, 120);
  } catch {
    // An invalid address is logged as it was pasted.
  }
  await adminClient()
    .from("property_imports")
    .insert({
      agency_id: entry.agencyId,
      user_id: entry.userId,
      url: entry.url.slice(0, 500),
      source,
      status: entry.status,
      property_id: entry.propertyId ?? null,
      error: entry.error?.slice(0, 300) ?? null,
      finished_at: new Date().toISOString(),
    })
    .then(
      () => null,
      () => null,
    );
}



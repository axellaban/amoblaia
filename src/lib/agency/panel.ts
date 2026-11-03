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

export type PropertyQuery = {
  page?: number;
  perPage?: number;
  q?: string | null;
  status?: string | null;
  operation?: string | null;
  /** "fotos" lists the photo groups that are not fichas yet. */
  kind?: "ficha" | "fotos";
  /** Only these properties (demo_properties.id): a user limited to some of them. */
  scope?: string[] | null;
};
type DemoListRow = {
  id: string;
  property_id: string;
  token: string;
  status: "draft" | "published";
  cover_photo_id: string | null;
  created_at: string;
  settings: unknown;
  demo_properties: { title: string; location: string | null; listing_url: string | null; origin?: string | null } | null;
};

/**
 * A page of the agency's properties, newest first, filtered on the server,
 * with the real total of what matches (no silent limit).
 */
export async function agencyProperties(agencyId: string, query: PropertyQuery = {}): Promise<{ items: PanelProperty[]; total: number }> {
  const db = adminClient();
  const perPage = Math.min(48, Math.max(1, Math.trunc(query.perPage ?? 24)));
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  if (query.scope && !query.scope.length) return { items: [], total: 0 };
  let list = db
    .from("demos")
    .select("id,property_id,token,status,cover_photo_id,created_at,settings,demo_properties!inner(title,location,listing_url,origin)", { count: "exact" })
    .eq("agency_id", agencyId)
    .eq("kind", query.kind ?? "ficha");
  if (query.scope) list = list.in("property_id", query.scope);
  if (query.status === "draft" || query.status === "published") list = list.eq("status", query.status);
  const op = query.operation?.trim().slice(0, 40);
  if (op) list = list.eq("settings->>operation", op);
  // Searched in PostgREST's filter syntax: characters with a meaning there are dropped.
  const q = query.q?.replace(/[%_,().*\\]/g, " ").trim().slice(0, 80);
  if (q) list = list.or(`title.ilike.%${q}%,location.ilike.%${q}%`, { referencedTable: "demo_properties" });
  const res = await list.order("created_at", { ascending: false }).range((page - 1) * perPage, page * perPage - 1);
  if (res.error) throw new Error("PANEL_DEMOS_FAILED");
  const demos = (res.data ?? []) as unknown as DemoListRow[];
  return { items: await withPhotos(demos), total: res.count ?? demos.length };
}

/**
 * Photos, spaces and the real state of their versions for a page of
 * properties (bounded by the page size): ready, still running and failed or
 * uncertain. A succeeded version is "ready", never "approved" or "published".
 */
async function withPhotos(demos: DemoListRow[]): Promise<PanelProperty[]> {
  if (!demos.length) return [];
  const db = adminClient();
  const propertyIds = demos.map((d) => d.property_id);
  const [photoRes, spaceRes] = await Promise.all([
    db
      .from("demo_photos")
      .select("id,property_id,project_id,position,visible,discarded")
      .in("property_id", propertyIds)
      .limit(2000),
    db.from("property_spaces").select("property_id").in("property_id", propertyIds).limit(2000),
  ]);
  const photos = check(photoRes, "PANEL_PHOTOS_FAILED") as {
    id: string;
    property_id: string;
    project_id: string;
    position: number;
    visible: boolean;
    discarded: string[] | null;
  }[];
  // Before 202610310001 there are no spaces: unknown, shown as nothing.
  const spaces = spaceRes.error ? null : ((spaceRes.data ?? []) as { property_id: string }[]);
  const projectIds = [...new Set(photos.map((p) => p.project_id))];
  const generations = projectIds.length
    ? (check(
        await db
          .from("generations")
          .select("id,project_id,style,status,result_path,created_at")
          .in("project_id", projectIds)
          .eq("is_free", false)
          .order("created_at", { ascending: false })
          .limit(5000),
        "PANEL_STAGED_FAILED",
      ) as { id: string; project_id: string; style: string; status: string; result_path: string | null }[])
    : [];
  return demos.map((d) => {
    const own = photos.filter((p) => p.property_id === d.property_id).sort((a, b) => a.position - b.position);
    let ready = 0;
    let active = 0;
    let issues = 0;
    let stagedPhotos = 0;
    for (const p of own) {
      const discarded = new Set(p.discarded ?? []);
      const mine = generations.filter((g) => g.project_id === p.project_id && !discarded.has(g.id));
      // The newest attempt of each style says where that style stands.
      const latest = new Map<string, (typeof mine)[number]>();
      for (const g of mine) if (!latest.has(g.style)) latest.set(g.style, g);
      const readyStyles = new Set(mine.filter((g) => g.status === "succeeded" && g.result_path).map((g) => g.style));
      ready += readyStyles.size;
      if (readyStyles.size) stagedPhotos++;
      for (const g of latest.values()) {
        if (g.status === "queued" || g.status === "running") active++;
        else if ((g.status === "failed" || g.status === "needs_review") && !readyStyles.has(g.style)) issues++;
      }
    }
    const settings = readSettings(d.settings);
    return {
      id: d.id,
      title: d.demo_properties?.title ?? "Propiedad",
      location: d.demo_properties?.location ?? null,
      reference: settings.reference,
      origin: d.demo_properties?.origin === "agency" ? "agency" : "admin",
      price: settings.priceConflict ? null : settings.price,
      operation: settings.operation,
      photos: own.length,
      staged: stagedPhotos,
      versions: { ready, active, issues },
      spaces: spaces ? spaces.filter((s) => s.property_id === d.property_id).length : null,
      status: d.status,
      token: d.token,
      coverPhotoId: d.cover_photo_id ?? own.find((p) => p.visible)?.id ?? null,
      listingUrl: d.demo_properties?.listing_url ?? null,
      createdAt: d.created_at,
    };
  });
}

/** Real totals for the home: never derived from a truncated list. */
export async function agencyCounts(agencyId: string) {
  return rpc<{ total: number; published: number; staged: number; review: number; operations: string[] }>("habita_agency_counts", {
    p_agency: agencyId,
  });
}

/**
 * The agency's balance: its owner's credits, the one account that pays its
 * stagings. A failed lookup is reported as unknown, never as zero.
 */
export async function agencyCredits(ownerId: string | null): Promise<number | null> {
  if (!ownerId) return null;
  try {
    return (await rpc<{ credits: number }>("amobla_account", { p_user: ownerId, p_trial: false })).credits;
  } catch {
    return null;
  }
}

/**
 * Totals of a user limited to some properties, from those properties only
 * (a handful: bounded by what was assigned).
 */
async function scopedCounts(agencyId: string, scope: string[]) {
  const all: PanelProperty[] = [];
  for (let page = 1; page <= Math.ceil(scope.length / 48); page++) {
    const { items } = await agencyProperties(agencyId, { scope, perPage: 48, page });
    all.push(...items);
    if (items.length < 48) break;
  }
  return {
    total: all.length,
    published: all.filter((p) => p.status === "published").length,
    staged: all.filter((p) => p.staged > 0).length,
    review: all.filter((p) => p.versions.issues > 0).length,
    operations: [...new Set(all.map((p) => p.operation).filter((o): o is string => Boolean(o)))],
  };
}

/** Everything the panel's home shows: for a limited user, only its properties. */
export async function panelSummary(membership: Membership): Promise<PanelSummary> {
  const { agency, scope } = membership;
  const db = adminClient();
  const [branding, latest, counts, imports, credits] = await Promise.all([
    brandingOf(agency.id),
    agencyProperties(agency.id, { perPage: 6, scope }),
    scope ? scopedCounts(agency.id, scope) : agencyCounts(agency.id),
    // Imports to finish are the agency's, not of a user limited to some properties.
    scope
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("property_imports")
          .select("id,url,status,error,created_at,demo_id,photos_total,photos_done,pending_images,settings_saved")
          .eq("agency_id", agency.id)
          .in("status", ["partial", "failed"])
          .order("created_at", { ascending: false })
          .limit(10),
    agencyCredits(agency.owner_id),
  ]);
  if (imports.error) throw new Error("PANEL_IMPORTS_FAILED");
  return {
    agency: {
      id: agency.id,
      name: agency.name,
      slug: agency.slug,
      website: agency.website,
      sitePublished: agency.site_published,
      logo: branding.logo ? `/api/panel/logo?v=${branding.logo.v}` : null,
      primary: branding.primary ?? null,
      contactKind: branding.contactKind ?? null,
      contactValue: branding.contactValue ?? null,
    },
    role: membership.role,
    scope,
    credits,
    counts: { ...counts, drafts: counts.total - counts.published },
    properties: latest.items,
    imports: (imports.data as unknown as {
      id: string;
      url: string;
      status: "partial" | "failed";
      error: string | null;
      created_at: string;
      demo_id: string | null;
      photos_total: number | null;
      photos_done: number | null;
      pending_images: string[] | null;
      settings_saved: boolean | null;
    }[]).map((i) => ({
      id: i.id,
      url: i.url,
      status: i.status,
      error: i.error,
      createdAt: i.created_at,
      propertyId: i.demo_id,
      photosTotal: i.photos_total ?? 0,
      photosDone: i.photos_done ?? 0,
      pendingImages: i.pending_images ?? [],
      settingsSaved: i.settings_saved !== false,
    })),
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



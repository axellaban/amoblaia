import "server-only";
import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { adminClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/commerce/jobs";
import { HttpError, rpc } from "@/lib/commerce/http";
import { normalizePhoto } from "@/lib/commerce/images";
import {
  DEFAULT_ACCENT,
  DEFAULT_PRIMARY,
  readBranding,
  readSettings,
  whatsappNumber,
  type AgencyBranding,
  type DemoSettings,
} from "./branding";
import { demoStyleName, demoStyleOrder, styleFits } from "./styles";
import { retouchOps, type Adjust } from "./retouch";
import { activityOf } from "./activity";
import { fetchPublic } from "./listing";
import type { ImportedDemo } from "./import";
import { OG_LABEL_ORIGINAL, OG_LABEL_STAGED } from "./og-labels";
import {
  TOKEN_PATTERN,
  coverVersion,
  isUuid,
  orderStyles,
  pickCover,
  shownVersions,
  styleName,
  type AgencyRow,
  type DemoDetail,
  type DemoMode,
  type DemoSummary,
  NO_ACTIVITY,
  NO_CREDITS,
  type DemoCredits,
  type DemoSendEvent,
  type EditorPhoto,
  type GenerationRow,
  type PhotoVersion,
  type PublicDemo,
  type PublicPhoto,
  type PropertySpace,
  type RetouchRow,
  type RetouchSource,
  RETOUCH_STYLE,
} from "./shared";

/** 18 random bytes: 24 URL-safe characters, unguessable and stable across publish/unpublish. */
export const newToken = () => randomBytes(18).toString("base64url");
export const MAX_PHOTOS_PER_DEMO = 40;

type DemoRow = {
  sent_at: string | null;
  message_template: string | null;
  id: string;
  agency_id: string;
  property_id: string;
  title: string | null;
  token: string;
  status: "draft" | "published";
  /** "fotos": a photo group that is not a ficha yet, so it cannot be published. */
  kind: "ficha" | "fotos";
  cover_photo_id: string | null;
  published_at: string | null;
  created_at: string;
};
type PhotoRow = {
  id: string;
  property_id: string;
  project_id: string;
  position: number;
  visible: boolean;
  room: string;
  label: string | null;
  style: string;
  mode: DemoMode;
  approved_generation_id: string | null;
  shown_retouch_id: string | null;
  discarded: string[] | null;
};
const DEMO_FIELDS =
  "id,agency_id,property_id,title,token,status,kind,cover_photo_id,published_at,created_at,sent_at,message_template";
const PHOTO_FIELDS =
  "id,property_id,project_id,position,visible,room,label,style,mode,approved_generation_id,shown_retouch_id,discarded";

function check<T>(result: { data: T | null; error: unknown }, code: string) {
  if (result.error) throw new Error(code);
  return result.data as T;
}

type StagedRow = {
  id: string;
  project_id: string;
  style: string;
  status: string;
  result_path: string | null;
  is_free: boolean;
};
/** Finished results of these projects, newest first, in chunks so the query string stays short. */
async function stagedOf(projectIds: string[]) {
  const ids = [...new Set(projectIds)];
  const rows: StagedRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    rows.push(
      ...(check(
        await adminClient()
          .from("generations")
          .select("id,project_id,style,status,result_path,is_free,created_at")
          .in("project_id", ids.slice(i, i + 100))
          .eq("status", "succeeded")
          .eq("is_free", false)
          .order("created_at", { ascending: false })
          .limit(5000),
        "DEMO_GENERATIONS_LOOKUP_FAILED",
      ) as StagedRow[]),
    );
  }
  return rows;
}
type ShownSource = Pick<PhotoRow, "id" | "project_id" | "approved_generation_id" | "discarded">;
/** For each photo, the version shown in each style. */
async function shownOf<P extends ShownSource>(photos: P[]) {
  const staged = await stagedOf(photos.map((p) => p.project_id));
  return new Map(
    photos.map((p) => [
      p.id,
      shownVersions(
        p,
        staged.filter((g) => g.project_id === p.project_id),
      ),
    ]),
  );
}
/**
 * The demo's main style: kept on every photo (the editor sets them together).
 * It defaults to "modern", so while no photo has a version in it, the style
 * that most photos have takes its place: an agency that stages everything in
 * another style gets a ficha that opens staged, not with the originals.
 */
export function mainOf(photos: Pick<PhotoRow, "id" | "style">[], shown: Map<string, Map<string, unknown>>) {
  const saved = photos[0]?.style ?? "modern";
  const counts = new Map<string, number>();
  for (const p of photos) for (const style of shown.get(p.id)?.keys() ?? []) counts.set(style, (counts.get(style) ?? 0) + 1);
  if (!counts.size || counts.has(saved)) return saved;
  return [...counts].sort((a, b) => b[1] - a[1] || demoStyleOrder.indexOf(a[0]) - demoStyleOrder.indexOf(b[0]))[0][0];
}
const versionList = (shown: Map<string, StagedRow> | undefined, order: string[]): PhotoVersion[] =>
  order.flatMap((style) => {
    const g = shown?.get(style);
    return g ? [{ style, v: g.id.slice(0, 8) }] : [];
  });

/**
 * A JSON column added by 202610270001_demo_branding.sql. Before the migration
 * is applied the query fails: the page then uses defaults (original photo,
 * no logo, neutral colors) and the panel says the migration is pending.
 */
async function optionalJson(table: "agencies" | "demos", column: "branding" | "settings", id: string) {
  const { data, error } = await adminClient().from(table).select(column).eq("id", id).maybeSingle();
  if (error) return { ready: false, value: {} as unknown };
  return { ready: true, value: (data as Record<string, unknown> | null)?.[column] ?? {} };
}
export async function brandingOf(agencyId: string) {
  return readBranding((await optionalJson("agencies", "branding", agencyId)).value);
}
export async function settingsOf(demoId: string) {
  const r = await optionalJson("demos", "settings", demoId);
  return { ready: r.ready, settings: readSettings(r.value) };
}
/** Saves a JSON column; a clear message while the migration is missing. */
export async function saveJson(
  table: "agencies" | "demos",
  column: "branding" | "settings",
  id: string,
  value: unknown,
) {
  if (Buffer.byteLength(JSON.stringify(value)) > (column === "settings" ? 19000 : 390000))
    throw new HttpError(413, "Es demasiado largo para guardar. Acortá la descripción o las listas.");
  const { error } = await adminClient()
    .from(table)
    .update({ [column]: value })
    .eq("id", id);
  if (error)
    throw new HttpError(
      409,
      "Para guardar esto falta aplicar la migración 202610270001_demo_branding.sql en Supabase.",
    );
}
/** The logo as stored (small PNG or WebP, base64). */
export async function logoOf(agencyId: string) {
  const logo = (await brandingOf(agencyId)).logo;
  return logo ? { type: logo.type, bytes: Buffer.from(logo.data, "base64") } : null;
}
const logoVersion = (b: AgencyBranding) => b.logo?.v ?? null;

/** A logo kept small (at most 480×160, transparency preserved) to live in the branding. */
export async function logoFromBytes(bytes: Buffer) {
  const png = await sharp(bytes, { limitInputPixels: 20_000_000 })
    .resize({ width: 480, height: 160, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer()
    .catch(() => {
      throw new HttpError(400, "No pudimos leer el logo. Probá con otro archivo.");
    });
  return { type: "image/png", data: png.toString("base64"), v: createHash("sha256").update(png).digest("hex").slice(0, 10) };
}

/**
 * Completes the agency with what the listing publishes: its logo and the
 * contact for inquiries, only where nothing is set (what the admin chose stays).
 */
export async function completeAgency(agencyId: string, imp: ImportedDemo, contact: string | null = null) {
  const branding = await brandingOf(agencyId);
  const next: AgencyBranding = { ...branding };
  const done = { logo: false, contact: false };
  if (!branding.logo && imp.agency.logoUrl) {
    const image = await fetchPublic(imp.agency.logoUrl, "image").catch(() => null);
    const logo = image && (await logoFromBytes(image.body).catch(() => null));
    if (logo) [next.logo, done.logo] = [logo, true];
  }
  if (!branding.contactKind || !branding.contactValue) {
    const value = contact ?? imp.agency.whatsapp ?? imp.agency.phone ?? imp.agency.email;
    if (value) {
      next.contactKind = value.includes("@")
        ? "email"
        : whatsappNumber(value) && (contact || value === imp.agency.whatsapp)
          ? "whatsapp"
          : "phone";
      next.contactValue = value;
      done.contact = true;
    }
  }
  if (done.logo || done.contact) await saveJson("agencies", "branding", agencyId, next);
  return done;
}

type WaContact = { id: string; account_id: string; address: string | null; needs_review: boolean; verified_at: string | null; invalid_at: string | null; is_primary: boolean };
type WaBlock = { account_id: string; scope: string; channel: string | null; contact_id: string | null };

/**
 * The agency's WhatsApp to send its demo to, as wa.me digits (team only).
 * First the one the team loaded (agencies.contact_whatsapp), then its prospecting contact: verified first, then reviewed, then primary;
 * never an invalid one or one under a suppression. Else the public WhatsApp
 * of its branding. A lookup that fails (or a missing table before the
 * migrations) leaves the agency without a number: WhatsApp then lets the
 * team pick the chat, as before.
 */
export async function whatsappOf(agencyIds: string[]) {
  const out = new Map<string, string>();
  if (!agencyIds.length) return out;
  const db = adminClient();
  // The number the team loaded or corrected wins (missing before 202611130001).
  const own = await db.from("agencies").select("id,contact_whatsapp").in("id", agencyIds);
  if (!own.error)
    for (const a of (own.data ?? []) as { id: string; contact_whatsapp: string | null }[]) {
      const n = a.contact_whatsapp ? whatsappNumber(a.contact_whatsapp) : null;
      if (n) out.set(a.id, n);
    }
  const pending = agencyIds.filter((id) => !out.has(id));
  const accounts = pending.length
    ? await db.from("prospect_accounts").select("id,agency_id").in("agency_id", pending)
    : { data: [], error: null };
  if (!accounts.error && accounts.data?.length) {
    const agencyOf = new Map((accounts.data as { id: string; agency_id: string }[]).map((a) => [a.id, a.agency_id]));
    const ids = [...agencyOf.keys()];
    const [contacts, blocks] = await Promise.all([
      db
        .from("prospect_contacts")
        .select("id,account_id,address,needs_review,verified_at,invalid_at,is_primary")
        .in("account_id", ids)
        .eq("channel", "whatsapp"),
      db.from("prospect_suppressions").select("account_id,scope,channel,contact_id").in("account_id", ids).is("lifted_at", null),
    ]);
    if (!contacts.error && !blocks.error) {
      const active = (blocks.data ?? []) as WaBlock[];
      const blocked = (c: WaContact) =>
        active.some(
          (s) =>
            s.account_id === c.account_id &&
            (s.scope === "account" || (s.scope === "channel" && s.channel === "whatsapp") || (s.scope === "contact" && s.contact_id === c.id)),
        );
      const rank = (c: WaContact) => (c.verified_at ? 4 : 0) + (c.needs_review ? 0 : 2) + (c.is_primary ? 1 : 0);
      const usable = ((contacts.data ?? []) as WaContact[])
        .filter((c) => c.address && !c.invalid_at && !blocked(c) && whatsappNumber(c.address))
        .sort((a, b) => rank(b) - rank(a));
      for (const c of usable) {
        const agency = agencyOf.get(c.account_id);
        if (agency && !out.has(agency)) out.set(agency, whatsappNumber(c.address!)!);
      }
    }
  }
  const missing = agencyIds.filter((id) => !out.has(id));
  if (missing.length) {
    const rows = await db.from("agencies").select("id,branding").in("id", missing);
    if (!rows.error)
      for (const r of (rows.data ?? []) as { id: string; branding: unknown }[]) {
        const b = readBranding(r.branding);
        const n = b.contactKind === "whatsapp" && b.contactValue ? whatsappNumber(b.contactValue) : null;
        if (n) out.set(r.id, n);
      }
  }
  return out;
}

/**
 * Saves the agency's WhatsApp (already normalized; null clears it). With
 * onlyIfEmpty it never replaces one the team loaded: an imported number only fills a gap.
 */
export async function saveAgencyWhatsapp(agencyId: string, number: string | null, onlyIfEmpty = false) {
  let query = adminClient().from("agencies").update({ contact_whatsapp: number }).eq("id", agencyId);
  if (onlyIfEmpty) query = query.is("contact_whatsapp", null);
  const { error } = await query;
  if (error) throw new HttpError(409, "Para guardar el WhatsApp de la inmobiliaria falta aplicar la migración 202611130001_demo_sent_stage.sql en Supabase.");
}

/** When the demo was sent or marked unsent, newest first (team only; from the audit log). */
export async function sendLogOf(demoId: string): Promise<DemoSendEvent[]> {
  // The history is a help: a failed read leaves it empty, never the demo.
  let rows: unknown[] | null = null;
  try {
    const { data, error } = await adminClient()
      .from("admin_audit")
      .select("action,details,created_at")
      .eq("subject_id", demoId)
      .in("action", ["demo_sent", "demo_unsent"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (!error) rows = data;
  } catch {
    rows = null;
  }
  return ((rows ?? []) as { action: string; details: { by?: string } | null; created_at: string }[]).map((r) => ({
    at: r.created_at,
    kind: r.action === "demo_unsent" ? "unsent" : r.details?.by === "whatsapp" ? "whatsapp" : "manual",
  }));
}

/**
 * Available (the owner's balance) and reserved credits per agency, for the team's lists.
 * Unknown stays null, never 0: before the migration, or when the lookup fails.
 */
async function creditsOf(agencyIds: string[]) {
  const out = new Map<string, DemoCredits>();
  if (!agencyIds.length) return out;
  try {
    const rows = await rpc<{ agency_id: string; available: number | null; reserved: number | null }[]>("habita_admin_agency_balances", {
      p_agencies: agencyIds,
    });
    for (const r of rows ?? []) out.set(r.agency_id, { available: r.available, reserved: r.reserved });
  } catch {
    // Unknown: the list keeps working without the numbers.
  }
  return out;
}

export async function listDemos() {
  const db = adminClient();
  const demos = check(
    await db
      .from("demos")
      .select(DEMO_FIELDS)
      .order("created_at", { ascending: false })
      .limit(300),
    "DEMO_LIST_FAILED",
  ) as DemoRow[];
  const agencyIds = [...new Set(demos.map((d) => d.agency_id))];
  const propertyIds = demos.map((d) => d.property_id);
  const [agencies, owners, properties, photos, allAgencies] = await Promise.all([
    agencyIds.length
      ? db.from("agencies").select("id,name").in("id", agencyIds)
      : Promise.resolve({ data: [], error: null }),
    // Whether each agency already has its account (unknown before 202610280001).
    agencyIds.length
      ? db.from("agencies").select("id,owner_id").in("id", agencyIds)
      : Promise.resolve({ data: [], error: null }),
    propertyIds.length
      ? db.from("demo_properties").select("id,title,location").in("id", propertyIds)
      : Promise.resolve({ data: [], error: null }),
    propertyIds.length
      ? db
          .from("demo_photos")
          .select("id,property_id,project_id,approved_generation_id,discarded,visible,position,style")
          .in("property_id", propertyIds)
          .order("position")
      : Promise.resolve({ data: [], error: null }),
    db
      .from("agencies")
      .select("id,name,website,contact_name,notes")
      .order("name")
      .limit(500),
  ]);
  const contactOf = new Map(
    ((allAgencies.data ?? []) as { id: string; contact_name: string | null }[]).map((a) => [a.id, a.contact_name]),
  );
  const agencyName = new Map(
    (check(agencies, "DEMO_LIST_FAILED") as { id: string; name: string }[]).map(
      (a) => [a.id, a.name],
    ),
  );
  const claimed = new Map(
    owners.error ? [] : ((owners.data ?? []) as { id: string; owner_id: string | null }[]).map((a) => [a.id, Boolean(a.owner_id)]),
  );
  const propertyRows = check(properties, "DEMO_LIST_FAILED") as { id: string; title: string; location: string | null }[];
  const propertyTitle = new Map(propertyRows.map((p) => [p.id, p.title]));
  const propertyLocation = new Map(propertyRows.map((p) => [p.id, p.location]));
  const photoRows = check(photos, "DEMO_LIST_FAILED") as (ShownSource & {
    property_id: string;
    visible: boolean;
    style: string;
  })[];
  const shown = await shownOf(photoRows);
  const activity = await activityOf(demos.map((d) => d.id));
  const credits = await creditsOf(agencyIds);
  const whatsapp = await whatsappOf(agencyIds);
  const summaries: DemoSummary[] = demos.map((d) => {
    const own = photoRows.filter((p) => p.property_id === d.property_id);
    const main = mainOf(own, shown);
    const order = orderStyles(own.flatMap((p) => [...(shown.get(p.id)?.keys() ?? [])]), main);
    const withVersions = own.map((p) => ({ ...p, versions: versionList(shown.get(p.id), order) }));
    const cover = pickCover(withVersions, d.cover_photo_id, main);
    return {
      id: d.id,
      token: d.token,
      status: d.status,
      title: d.title || propertyTitle.get(d.property_id) || "Demo",
      agencyId: d.agency_id,
      agencyName: agencyName.get(d.agency_id) || "",
      agencyClaimed: claimed.get(d.agency_id) ?? null,
      agencyWhatsapp: whatsapp.get(d.agency_id) ?? null,
      propertyTitle: propertyTitle.get(d.property_id) || "",
      propertyLocation: propertyLocation.get(d.property_id) ?? null,
      photos: own.length,
      staged: withVersions.filter((p) => p.versions.length).length,
      coverPhotoId: d.cover_photo_id,
      cover: cover ? { id: cover.id, version: coverVersion(cover, main) } : null,
      createdAt: d.created_at,
      publishedAt: d.published_at,
      sentAt: d.sent_at,
      messageTemplate: d.message_template,
      agencyContact: contactOf.get(d.agency_id) ?? null,
      activity: activity.get(d.id) ?? NO_ACTIVITY,
      credits: credits.get(d.agency_id) ?? NO_CREDITS,
    };
  });
  const agencyRows = check(allAgencies, "AGENCY_LIST_FAILED") as AgencyRow[];
  // Whether each agency has a WhatsApp: the new-demo form asks for it only when missing.
  const known = await whatsappOf(agencyRows.map((a) => a.id));
  return {
    demos: summaries,
    agencies: agencyRows.map((a) => ({ ...a, whatsapp: known.get(a.id) ?? null })),
  };
}

export async function demoRow(id: string) {
  if (!isUuid(id)) throw new HttpError(404, "No encontramos la demo.");
  const demo = check(
    await adminClient().from("demos").select(DEMO_FIELDS).eq("id", id).maybeSingle(),
    "DEMO_LOOKUP_FAILED",
  ) as DemoRow | null;
  if (!demo) throw new HttpError(404, "No encontramos la demo.");
  return demo;
}

async function photosOf(propertyId: string) {
  return check(
    await adminClient()
      .from("demo_photos")
      .select(PHOTO_FIELDS)
      .eq("property_id", propertyId)
      .order("position")
      .order("created_at"),
    "DEMO_PHOTOS_LOOKUP_FAILED",
  ) as PhotoRow[];
}

export async function demoDetail(id: string): Promise<DemoDetail> {
  const db = adminClient();
  const demo = await demoRow(id);
  const [agency, property, photos, spaces] = await Promise.all([
    db
      .from("agencies")
      .select("id,name,website,contact_name,notes")
      .eq("id", demo.agency_id)
      .single(),
    db
      .from("demo_properties")
      .select("id,title,location,listing_url,description")
      .eq("id", demo.property_id)
      .single(),
    photosOf(demo.property_id),
    spacesOf(demo.property_id),
  ]);
  const projectIds = [...new Set(photos.map((p) => p.project_id))];
  // File name and whether the photo already used a credit (further versions are included).
  type ProjectInfo = { id: string; name: string | null; grant_id: string | null; credit_grants: { source_key: string } | null };
  const projectInfo = new Map(
    projectIds.length
      ? (((await db.from("projects").select("id,name,grant_id,credit_grants(source_key)").in("id", projectIds)).data as unknown as
          | ProjectInfo[]
          | null) ?? []).map((p) => [p.id, p])
      : [],
  );
  const generations = projectIds.length
    ? (check(
        await db
          .from("generations")
          .select("id,project_id,status,style,mode,room,created_at,error_code")
          .in("project_id", projectIds)
          .eq("is_free", false)
          .order("created_at", { ascending: false })
          .limit(1000),
        "DEMO_GENERATIONS_LOOKUP_FAILED",
      ) as (GenerationRow & { project_id: string })[])
    : [];
  const prop = check(property, "DEMO_PROPERTY_LOOKUP_FAILED") as DemoDetail["property"];
  const generationStyle = new Map(generations.map((g) => [g.id, demoStyleName(g.style)]));
  const retouches = await retouchesOf(photos.map((p) => p.id), generationStyle);
  const [shown, branding, saved] = await Promise.all([
    shownOf(photos),
    brandingOf(demo.agency_id),
    settingsOf(demo.id),
  ]);
  const main = mainOf(photos, shown);
  const order = orderStyles(photos.flatMap((p) => [...(shown.get(p.id)?.keys() ?? [])]), main);
  const photoList: EditorPhoto[] = photos.map((p) => ({
    id: p.id,
    spaceId: spaces.photoSpace.get(p.id) ?? null,
    projectId: p.project_id,
    position: p.position,
    visible: p.visible,
    room: p.room,
    label: p.label,
    mode: p.mode,
    discarded: p.discarded || [],
    source: projectInfo.get(p.project_id)?.name ?? null,
    charged: Boolean(
      projectInfo.get(p.project_id)?.grant_id &&
        !/^(trial|demo):/.test(projectInfo.get(p.project_id)?.credit_grants?.source_key ?? ""),
    ),
    shown: Object.fromEntries([...(shown.get(p.id) ?? new Map<string, StagedRow>())].map(([k, g]) => [k, g.id])),
    shownRetouch: p.shown_retouch_id ?? null,
    generations: generations
      .filter((g) => g.project_id === p.project_id)
      .map(({ project_id: _ignored, ...g }) => g),
    retouches: retouches.get(p.id) ?? [],
  }));
  const withVersions = photos.map((p) => ({ ...p, versions: versionList(shown.get(p.id), order) }));
  const cover = pickCover(withVersions, demo.cover_photo_id, main);
  return {
    demo: {
      id: demo.id,
      token: demo.token,
      status: demo.status,
      title: demo.title || prop.title,
      agencyId: demo.agency_id,
      agencyName: (check(agency, "DEMO_AGENCY_LOOKUP_FAILED") as AgencyRow).name,
      // Whether the agency already has its account: the team's invitation is only for agencies without one.
      agencyClaimed: Boolean((await adminClient().from("agencies").select("owner_id").eq("id", demo.agency_id).maybeSingle()).data?.owner_id),
      activity: (await activityOf([demo.id])).get(demo.id) ?? NO_ACTIVITY,
      credits: (await creditsOf([demo.agency_id])).get(demo.agency_id) ?? NO_CREDITS,
      agencyWhatsapp: (await whatsappOf([demo.agency_id])).get(demo.agency_id) ?? null,
      propertyTitle: prop.title,
      propertyLocation: prop.location,
      kind: demo.kind === "fotos" ? "fotos" : "ficha",
      photos: photos.length,
      staged: withVersions.filter((p) => p.versions.length).length,
      coverPhotoId: demo.cover_photo_id,
      cover: cover ? { id: cover.id, version: coverVersion(cover, main) } : null,
      createdAt: demo.created_at,
      publishedAt: demo.published_at,
      sentAt: demo.sent_at,
      messageTemplate: demo.message_template,
      agencyContact: (check(agency, "DEMO_AGENCY_LOOKUP_FAILED") as AgencyRow).contact_name,
    },
    agency: check(agency, "DEMO_AGENCY_LOOKUP_FAILED") as AgencyRow,
    property: prop,
    sendLog: await sendLogOf(demo.id),
    photos: photoList,
    styles: order,
    mainStyle: main,
    branding: { ...branding, logo: logoVersion(branding) ? `/api/admin/demos/${demo.id}/logo?v=${logoVersion(branding)}` : null },
    settings: openingOf(saved.settings, main),
    settingsReady: saved.ready,
    warnings: reviewWarnings({
      settings: openingOf(saved.settings, main),
      branding,
      listingUrl: prop.listing_url,
      photos: photoList,
    }),
    spaces: spaces.list,
    spacesReady: spaces.ready,
  };
}

/**
 * The spaces of a property and which photo is in each. Before migration
 * 202610310001_property_spaces.sql there are none: every photo is "Sin organizar".
 */
export async function spacesOf(propertyId: string) {
  const db = adminClient();
  const [list, links] = await Promise.all([
    db.from("property_spaces").select("id,name,room_type,position").eq("property_id", propertyId).order("position").order("created_at"),
    db.from("demo_photos").select("id,space_id").eq("property_id", propertyId),
  ]);
  if (list.error || links.error) return { ready: false, list: [] as PropertySpace[], photoSpace: new Map<string, string>() };
  return {
    ready: true,
    list: ((list.data ?? []) as { id: string; name: string; room_type: string; position: number }[]).map((r) => ({
      id: r.id,
      name: r.name,
      roomType: r.room_type,
      position: r.position,
    })),
    photoSpace: new Map(
      ((links.data ?? []) as { id: string; space_id: string | null }[]).filter((r) => r.space_id).map((r) => [r.id, r.space_id!]),
    ),
  };
}

/** The settings with the style the ficha opens with: the one chosen, else the demo's main style. */
const openingOf = (settings: DemoSettings, main: string): DemoSettings => ({ ...settings, openStyle: settings.openStyle ?? main });

/** What the admin should check or complete before sharing. Never shown to buyers. */
export function reviewWarnings(input: {
  settings: DemoSettings;
  branding: AgencyBranding;
  listingUrl: string | null;
  photos: EditorPhoto[];
}) {
  const { settings, branding, listingUrl } = input;
  const out: string[] = [];
  const contact = contactOf(settings, branding);
  if (!contact.whatsapp && !contact.phone && !contact.email && !contact.url)
    out.push(
      listingUrl
        ? "Sin contacto válido: el botón principal lleva a «Ver publicación original». Cargá el WhatsApp del agente o de la inmobiliaria."
        : "Sin contacto válido ni publicación original: la ficha no tiene a dónde dirigir las consultas.",
    );
  if (settings.priceConflict)
    out.push(`Precio en conflicto (${settings.priceConflict}): la ficha muestra «Consultar» hasta que lo resuelvas.`);
  else if (!settings.price) out.push("Sin precio confirmado: la ficha muestra «Consultar».");
  if (!listingUrl) out.push("Falta el enlace a la publicación original.");
  if (settings.map.precision === "none") out.push("Sin ubicación verificada para el mapa: se muestra solo el texto.");
  const other = new Set(
    input.photos.flatMap((p) => Object.keys(p.shown)).filter((st) => !styleFits(st, settings.propertyType)),
  );
  if (other.size)
    out.push(
      `${other.size === 1 ? "Hay un estilo" : `Hay ${other.size} estilos`} de otro tipo de inmueble (${[...other]
        .map(styleName)
        .join(", ")}) que no se muestra${other.size === 1 ? "" : "n"} en la ficha.`,
    );
  if (
    settings.openMode === "styled" &&
    (!settings.openStyle ||
      !input.photos.some((p) => p.visible && p.shown[settings.openStyle!]) ||
      !styleFits(settings.openStyle, settings.propertyType))
  )
    out.push("La ambientación de apertura no está en ninguna foto visible: la ficha abre con las originales.");
  if (!settings.reviewedAt) out.push("Todavía no marcaste la ficha como revisada contra la publicación.");
  return out;
}

/** Builds the minimal public payload. Only visible photos; a staged version only when it can be delivered. */
async function publicPayload(demo: DemoRow, logoUrl: (v: string) => string): Promise<PublicDemo> {
  const db = adminClient();
  const [agency, prospect, property, photos, branding, { settings }] = await Promise.all([
    db.from("agencies").select("name,website").eq("id", demo.agency_id).single(),
    // Before 202610280001_agency_accounts.sql every agency is a prospect.
    db
      .from("agencies")
      .select("owner_id")
      .eq("id", demo.agency_id)
      .maybeSingle()
      .then((r) => !(r.data as { owner_id?: string | null } | null)?.owner_id),
    db
      .from("demo_properties")
      .select("title,location,listing_url,description")
      .eq("id", demo.property_id)
      .single(),
    photosOf(demo.property_id),
    brandingOf(demo.agency_id),
    settingsOf(demo.id),
  ]);
  const visible = photos.filter((p) => p.visible);
  const shown = await shownOf(visible);
  const main = mainOf(visible.length ? visible : photos, shown);
  // Only styles that fit the property: an office never shows a living room.
  const order = orderStyles(
    visible.flatMap((p) => [...(shown.get(p.id)?.keys() ?? [])]),
    main,
  ).filter((style) => styleFits(style, settings.propertyType));
  const list: PublicPhoto[] = visible.map((p) => ({
    id: p.id,
    // Only a label the admin wrote: room names ("Living") can be wrong for the property.
    label: p.label?.trim() || "",
    // The retouch the listing shows goes last, as one more option (never editable on the listing).
    versions: [
      ...versionList(shown.get(p.id), order),
      ...(p.shown_retouch_id ? [{ style: RETOUCH_STYLE, v: p.shown_retouch_id }] : []),
    ],
  }));
  const prop = check(property, "DEMO_PROPERTY_LOOKUP_FAILED") as {
    title: string;
    location: string | null;
    listing_url: string | null;
    description: string | null;
  };
  const ag = check(agency, "DEMO_AGENCY_LOOKUP_FAILED") as { name: string; website: string | null };
  const cover = pickCover(
    list.map((p) => ({ ...p, visible: true })),
    demo.cover_photo_id,
    main,
  );
  // Opening mode B: the chosen style, else the main one, while some visible photo has it (each photo with stagings opens compared).
  const opening = settings.openStyle ?? main;
  const openStyle = settings.openMode === "styled" && list.some((p) => p.versions.some((v) => v.style === opening)) ? opening : null;
  const version = logoVersion(branding);
  return {
    id: demo.id,
    agencyId: demo.agency_id,
    agencyName: ag.name,
    agency: {
      name: ag.name,
      website: ag.website,
      logo: version ? logoUrl(version) : null,
      primary: branding.primary ?? DEFAULT_PRIMARY,
      accent: branding.accent ?? DEFAULT_ACCENT,
      titleFont: branding.titleFont ?? "sans",
      contact:
        branding.contactKind && branding.contactValue
          ? { kind: branding.contactKind, value: branding.contactValue }
          : null,
      visitUrl: branding.visitUrl ?? null,
    },
    title: demo.title || prop.title,
    location: prop.location,
    description: settings.description ?? prop.description,
    listingUrl: prop.listing_url,
    ...listingFields(settings, branding),
    styles: order.map((id) => ({ id, name: styleName(id) })),
    cover: cover ? list.find((p) => p.id === cover.id)! : null,
    // The cover the agency chose opens the gallery; the rest keep their order.
    photos: demo.cover_photo_id && cover?.id === demo.cover_photo_id ? [...list.filter((p) => p.id === cover.id), ...list.filter((p) => p.id !== cover.id)] : list,
    openStyle,
    banner: settings.banner,
    share: { title: settings.shareTitle, description: settings.shareDescription },
    prospect,
  };
}

/** The property's data as the page shows it: only confirmed prices, a map never more precise than published. */
export function listingFields(settings: DemoSettings, branding: AgencyBranding) {
  return {
    propertyType: settings.propertyType,
    operation: settings.operation,
    price: settings.priceConflict ? null : settings.price,
    expenses: settings.expenses,
    availability: settings.availability,
    requirements: settings.requirements,
    features: settings.features,
    reference: settings.reference,
    facts: settings.facts,
    amenities: settings.amenities,
    map: publicMap(settings),
    agent: settings.agent
      ? {
          name: settings.agent.name,
          role: settings.agent.role,
          photoUrl: settings.agent.photoUrl,
          initials: initials(settings.agent.name),
        }
      : null,
    contact: contactOf(settings, branding),
    closingTitle:
      settings.closingTitle ??
      (settings.propertyType === "office" ? "¿Te imaginás trabajando acá?" : "¿Te imaginás viviendo acá?"),
    closingText: settings.closingText,
  };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Never more precise than the listing: zones to ~1 km, approximate locations to ~100 m. */
export function publicMap(settings: Pick<DemoSettings, "map">): PublicDemo["map"] {
  const { precision, lat, lng, radius } = settings.map;
  if (precision === "none" || lat === null || lng === null) return null;
  const digits = precision === "zone" ? 2 : precision === "approx" ? 3 : 5;
  const round = (n: number) => Math.round(n * 10 ** digits) / 10 ** digits;
  // The area drawn: the listing's own when it has one, never smaller than
  // what the rounding hides (about 1 km for a zone, 100 m for an approximate place).
  const area =
    precision === "exact"
      ? null
      : Math.min(3000, Math.max(precision === "zone" ? 700 : 150, radius ?? (precision === "zone" ? 1000 : 300)));
  return { precision, lat: round(lat), lng: round(lng), radius: area };
}

/** Inquiries go to the assigned agent first, then to the agency's own channel. */
export function contactOf(
  settings: Pick<DemoSettings, "agent">,
  branding: AgencyBranding,
): PublicDemo["contact"] {
  const kind = branding.contactKind;
  const value = branding.contactValue ?? null;
  const agent = settings.agent;
  const wa = (v: string | null | undefined) => (v && whatsappNumber(v) ? v : null);
  return {
    whatsapp: wa(agent?.whatsapp) ?? (kind === "whatsapp" ? wa(value) : null),
    phone: agent?.phone ?? (kind === "phone" ? value : null),
    email: agent?.email ?? (kind === "email" ? value : null),
    url: kind === "url" ? value : null,
  };
}

/** The public demo for a token, or null when the token is malformed, unknown or not published. */
export async function publishedDemo(token: string) {
  if (!TOKEN_PATTERN.test(token)) return null;
  const demo = check(
    await adminClient()
      .from("demos")
      .select(DEMO_FIELDS)
      .eq("token", token)
      .eq("status", "published")
      .maybeSingle(),
    "DEMO_LOOKUP_FAILED",
  ) as DemoRow | null;
  return demo ? publicPayload(demo, (v) => `/demo/${token}/logo?v=${v}`) : null;
}
/** The same payload for an admin preview, whatever the state. */
export async function previewDemo(id: string) {
  const demo = await demoRow(id);
  return publicPayload(demo, (v) => `/api/admin/demos/${demo.id}/logo?v=${v}`);
}

/** Storage path of a photo: the original, or the version it shows in a style. */
async function photoPath(photo: PhotoRow, style: string | null) {
  if (style) return (await shownOf([photo])).get(photo.id)?.get(style)?.result_path ?? null;
  const project = check(
    await adminClient()
      .from("projects")
      .select("original_path")
      .eq("id", photo.project_id)
      .is("deleted_at", null)
      .maybeSingle(),
    "DEMO_PROJECT_LOOKUP_FAILED",
  ) as { original_path: string } | null;
  return project?.original_path ?? null;
}

/** A public image, only of a visible photo of a published demo. */
/** A retouch the listing shows: only that one, of a visible photo of a published demo. */
export async function publicRetouchPaths(token: string, photoId: string, retouchId: string) {
  if (!TOKEN_PATTERN.test(token) || !isUuid(photoId) || !isUuid(retouchId)) return null;
  const db = adminClient();
  const demo = check(
    await db.from("demos").select("property_id").eq("token", token).eq("status", "published").maybeSingle(),
    "DEMO_LOOKUP_FAILED",
  ) as { property_id: string } | null;
  if (!demo) return null;
  const photo = check(
    await db
      .from("demo_photos")
      .select("id")
      .eq("id", photoId)
      .eq("property_id", demo.property_id)
      .eq("visible", true)
      .eq("shown_retouch_id", retouchId)
      .maybeSingle(),
    "DEMO_PHOTO_LOOKUP_FAILED",
  );
  if (!photo) return null;
  const r = check(
    await db.from("photo_retouches").select("result_path").eq("id", retouchId).maybeSingle(),
    "DEMO_RETOUCH_LOOKUP_FAILED",
  ) as { result_path: string } | null;
  return r ? { original: r.result_path, staged: null } : null;
}

export async function publicImagePaths(token: string, photoId: string, style: string | null) {
  if (!TOKEN_PATTERN.test(token) || !isUuid(photoId)) return null;
  const db = adminClient();
  const demo = check(
    await db
      .from("demos")
      .select("property_id")
      .eq("token", token)
      .eq("status", "published")
      .maybeSingle(),
    "DEMO_LOOKUP_FAILED",
  ) as { property_id: string } | null;
  if (!demo) return null;
  const photo = check(
    await db
      .from("demo_photos")
      .select(PHOTO_FIELDS)
      .eq("id", photoId)
      .eq("property_id", demo.property_id)
      .eq("visible", true)
      .maybeSingle(),
    "DEMO_PHOTO_LOOKUP_FAILED",
  ) as PhotoRow | null;
  return photo ? imagePaths(photo, style) : null;
}

async function imagePaths(photo: PhotoRow, style: string | null) {
  const original = await photoPath(photo, null);
  if (!original) return null;
  const staged = style ? await photoPath(photo, style) : null;
  if (style && !staged) return null;
  return { original, staged };
}

/** Admin image: a demo photo (original or its version in a style) or one proposal of a demo photo. */
export async function adminImagePaths(params: {
  photoId?: string | null;
  style?: string | null;
  generationId?: string | null;
  retouchId?: string | null;
}) {
  const db = adminClient();
  if (params.retouchId) {
    if (!isUuid(params.retouchId)) return null;
    const r = check(
      await db.from("photo_retouches").select("result_path").eq("id", params.retouchId).maybeSingle(),
      "DEMO_RETOUCH_LOOKUP_FAILED",
    ) as { result_path: string } | null;
    return r ? { original: r.result_path, staged: null } : null;
  }
  if (params.generationId) {
    if (!isUuid(params.generationId)) return null;
    const g = check(
      await db
        .from("generations")
        .select("result_path,status,projects!inner(original_hash)")
        .eq("id", params.generationId)
        .eq("status", "succeeded")
        .like("projects.original_hash", "demo:%")
        .maybeSingle(),
      "DEMO_GENERATION_LOOKUP_FAILED",
    ) as { result_path: string | null } | null;
    return g?.result_path ? { original: g.result_path, staged: null } : null;
  }
  if (!isUuid(params.photoId)) return null;
  const photo = check(
    await db.from("demo_photos").select(PHOTO_FIELDS).eq("id", params.photoId).maybeSingle(),
    "DEMO_PHOTO_LOOKUP_FAILED",
  ) as PhotoRow | null;
  return photo ? imagePaths(photo, params.style || null) : null;
}

async function download(path: string) {
  const file = await adminClient().storage.from(BUCKET).download(path);
  return file.error || !file.data ? null : Buffer.from(await file.data.arrayBuffer());
}
const OG = { width: 1200, height: 630 };
/** Both halves are cropped the same way, so the seam lines up. */
const ogCrop = (bytes: Buffer) =>
  sharp(bytes, { limitInputPixels: 40_000_000 })
    .resize({ ...OG, fit: "cover", position: "centre" })
    .toBuffer();
const SEAM = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<rect x="597" y="0" width="6" height="630" fill="#ffffff"/>
<circle cx="600" cy="315" r="36" fill="#ffffff"/>
<path d="M590 299 L574 315 L590 331 M610 299 L626 315 L610 331" fill="none" stroke="#161b26" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`);

/**
 * The link preview card (1200×630): the left half of the original over the
 * staged version, labelled "Original" and "Ambientación ilustrativa con IA";
 * a single photo when there is no staged version. It never changes how the
 * page opens: the gallery still starts with the original.
 */
export async function renderPreview(paths: { original: string; staged: string | null }) {
  const original = await download(paths.original);
  if (!original) return null;
  if (!paths.staged)
    return sharp(await ogCrop(original)).jpeg({ quality: 78, progressive: true }).toBuffer();
  const staged = await download(paths.staged);
  if (!staged) return null;
  const left = await sharp(await ogCrop(original))
    .extract({ left: 0, top: 0, width: 600, height: OG.height })
    .toBuffer();
  const [a, b] = await Promise.all([sharp(OG_LABEL_ORIGINAL).metadata(), sharp(OG_LABEL_STAGED).metadata()]);
  return sharp(await ogCrop(staged))
    .composite([
      { input: left, left: 0, top: 0 },
      { input: SEAM, left: 0, top: 0 },
      // Identified as an illustration, as on the page.
      { input: OG_LABEL_ORIGINAL, left: 24, top: OG.height - 24 - (a.height ?? 50) },
      { input: OG_LABEL_STAGED, left: OG.width - 24 - (b.width ?? 400), top: OG.height - 24 - (b.height ?? 50) },
    ])
    .jpeg({ quality: 78, progressive: true })
    .toBuffer();
}

/** Reads a stored image and returns a web-sized JPEG. */
export async function renderImage(path: string, width: number) {
  const bytes = await download(path);
  if (!bytes) return null;
  return sharp(bytes, { limitInputPixels: 40_000_000 })
    .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, progressive: true })
    .toBuffer();
}

export type { RetouchSource } from "./shared";

/**
 * Saves a retouch as a new version of the photo: the source at most 2048 px,
 * the adjustments applied, a JPEG in storage. Free: no credits, no AI, and it
 * does not count toward the photo's versions.
 */
export async function saveRetouch(params: { photoId: string; projectId: string; source: RetouchSource; adjust: Adjust; actorId: string }) {
  const db = adminClient();
  let sourcePath: string | null;
  let generationId: string | null = null;
  let retouchId: string | null = null;
  if (params.source.kind === "original") {
    sourcePath = (await adminImagePaths({ photoId: params.photoId, style: null }))?.original ?? null;
  } else if (params.source.kind === "generation") {
    // An AI version of this photo, not of another one.
    const g = check(
      await db.from("generations").select("id").eq("id", params.source.id).eq("project_id", params.projectId).eq("status", "succeeded").maybeSingle(),
      "DEMO_GENERATION_LOOKUP_FAILED",
    );
    if (!g) throw new HttpError(404, "No encontramos esa versión.");
    generationId = params.source.id;
    sourcePath = (await adminImagePaths({ generationId: params.source.id }))?.original ?? null;
  } else {
    const r = check(
      await db.from("photo_retouches").select("id").eq("id", params.source.id).eq("photo_id", params.photoId).maybeSingle(),
      "DEMO_RETOUCH_LOOKUP_FAILED",
    );
    if (!r) throw new HttpError(404, "No encontramos esa versión.");
    retouchId = params.source.id;
    sourcePath = (await adminImagePaths({ retouchId: params.source.id }))?.original ?? null;
  }
  const bytes = sourcePath ? await download(sourcePath) : null;
  if (!bytes) throw new HttpError(404, "No encontramos la foto para retocar.");
  const ops = retouchOps(params.adjust);
  const image = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .modulate({ brightness: ops.brightness })
    .linear(ops.linear.a, ops.linear.b)
    .recomb(ops.tint)
    .jpeg({ quality: 90, progressive: true })
    .toBuffer();
  const path = `retouches/${params.photoId}/${randomBytes(12).toString("hex")}.jpg`;
  const upload = await db.storage.from(BUCKET).upload(path, image, { contentType: "image/jpeg", upsert: false });
  if (upload.error) throw new HttpError(503, "No pudimos guardar la versión. Revisá el almacenamiento disponible.");
  const row = check(
    await db
      .from("photo_retouches")
      .insert({
        photo_id: params.photoId,
        source_generation_id: generationId,
        source_retouch_id: retouchId,
        adjust: params.adjust,
        result_path: path,
        result_bytes: image.length,
        created_by: params.actorId,
      })
      .select("id")
      .single(),
    "DEMO_RETOUCH_INSERT_FAILED",
  ) as { id: string };
  return row.id;
}

/**
 * The retouches of each photo, named "<style> · Retoque n" after what they
 * start from ("Original" for the photo itself); oldest first.
 */
export async function retouchesOf(photoIds: string[], generationStyle: Map<string, string>) {
  const out = new Map<string, RetouchRow[]>();
  if (!photoIds.length) return out;
  const rows = check(
    await adminClient()
      .from("photo_retouches")
      .select("id,photo_id,source_generation_id,source_retouch_id,adjust,created_at")
      .in("photo_id", photoIds)
      .order("created_at"),
    "DEMO_RETOUCHES_LOOKUP_FAILED",
  ) as {
    id: string;
    photo_id: string;
    source_generation_id: string | null;
    source_retouch_id: string | null;
    adjust: Adjust;
    created_at: string;
  }[];
  const base = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const r of rows) {
    const from = r.source_retouch_id ? base.get(r.source_retouch_id) : null;
    const name = from ?? (r.source_generation_id ? (generationStyle.get(r.source_generation_id) ?? "Versión") : "Original");
    base.set(r.id, name);
    const key = `${r.photo_id}:${name}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const list = out.get(r.photo_id) ?? [];
    list.push({ id: r.id, label: `${name} · Retoque${n > 1 ? ` ${n}` : ""}`, adjust: r.adjust, created_at: r.created_at });
    out.set(r.photo_id, list);
  }
  return out;
}

export type AgencyInput = {
  name: string;
  website: string | null;
  contact_name: string | null;
  notes: string | null;
};
export type PropertyInput = {
  title: string;
  location: string | null;
  listing_url: string | null;
  description: string | null;
};

export async function createDemo(input: {
  actorId: string;
  agencyId: string | null;
  agency: AgencyInput | null;
  /** origin: who added it ("agency" from its own panel; the team's by default). */
  property: PropertyInput & { origin?: "admin" | "agency" };
  /** "fotos": a photo group, not a ficha yet (see 202611040001_photo_groups.sql). */
  kind?: "ficha" | "fotos";
}) {
  const db = adminClient();
  let agencyId = input.agencyId;
  let createdAgency = false;
  if (agencyId) {
    const found = check(
      await db.from("agencies").select("id").eq("id", agencyId).maybeSingle(),
      "AGENCY_LOOKUP_FAILED",
    );
    if (!found) throw new HttpError(404, "No encontramos esa inmobiliaria.");
  } else if (input.agency) {
    const made = check(
      await db
        .from("agencies")
        .insert({ ...input.agency, created_by: input.actorId })
        .select("id")
        .single(),
      "AGENCY_CREATE_FAILED",
    ) as { id: string };
    agencyId = made.id;
    createdAgency = true;
  } else throw new HttpError(400, "Elegí o creá una inmobiliaria.");
  const undo = async (propertyId?: string) => {
    if (propertyId) await db.from("demo_properties").delete().eq("id", propertyId);
    if (createdAgency) await db.from("agencies").delete().eq("id", agencyId!);
  };
  const property = await db
    .from("demo_properties")
    .insert({ ...input.property, agency_id: agencyId, created_by: input.actorId })
    .select("id")
    .single();
  if (property.error || !property.data) {
    await undo();
    throw new Error("PROPERTY_CREATE_FAILED");
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const demo = await db
      .from("demos")
      .insert({
        agency_id: agencyId,
        property_id: property.data.id,
        token: newToken(),
        created_by: input.actorId,
        kind: input.kind ?? "ficha",
      })
      .select("id")
      .single();
    if (!demo.error && demo.data) return demo.data.id as string;
    // 23505 on the token: astronomically unlikely, but a retry is free.
    if (demo.error?.code !== "23505") break;
  }
  await undo(property.data.id);
  throw new Error("DEMO_CREATE_FAILED");
}

/**
 * Stores an uploaded original as a demo project of the uploading admin and
 * appends it to the demo. The same picture uploaded again reuses its
 * project (and the proposals already made for it).
 */
export async function addPhoto(
  demo: DemoRow,
  actorId: string,
  bytes: Buffer,
  name: string,
  /** ownOnly: an agency's photos reuse only its owner's copy, never another account's. */
  opts: { reuse?: boolean; ownOnly?: boolean } = {},
) {
  const db = adminClient();
  const existing = await photosOf(demo.property_id);
  const image = await normalizePhoto(bytes);
  const hash = createHash("sha256").update(image).digest("hex");
  const originalHash = `demo:${hash}`;
  // Reimporting a listing: a photo already in the demo is returned as is (with its stagings).
  if (opts.reuse) {
    const known = (await db.from("projects").select("id").eq("original_hash", originalHash).is("deleted_at", null)).data as
      | { id: string }[]
      | null;
    const same = existing.find((p) => known?.some((k) => k.id === p.project_id));
    if (same) return { ...same, reused: true };
  }
  if (existing.length >= MAX_PHOTOS_PER_DEMO)
    throw new HttpError(409, `Una demo admite hasta ${MAX_PHOTOS_PER_DEMO} fotos.`);
  const lookup = async () => {
    let query = db.from("projects").select("id,user_id").eq("original_hash", originalHash).is("deleted_at", null);
    if (opts.ownOnly) query = query.eq("user_id", actorId);
    const found = check(await query.order("created_at").limit(20), "PROJECT_LOOKUP_FAILED") as { id: string; user_id: string }[];
    if (opts.ownOnly || !found.length) return found[0] ?? null;
    // The team shares its copies, never an agency account's: those are its private photos and stagings.
    const members = check(
      await db.from("agency_members").select("user_id").in("user_id", [...new Set(found.map((p) => p.user_id))]),
      "PROJECT_LOOKUP_FAILED",
    ) as { user_id: string }[];
    return found.find((p) => p.user_id === actorId || !members.some((m) => m.user_id === p.user_id)) ?? null;
  };
  let project = await lookup();
  if (!project) {
    const path = `${actorId}/demos/${hash}.jpg`;
    const upload = await db.storage
      .from(BUCKET)
      .upload(path, image, { contentType: "image/jpeg", upsert: false });
    if (
      upload.error &&
      !["409", "Duplicate"].includes(String((upload.error as { statusCode?: string }).statusCode)) &&
      !/already exists/i.test(upload.error.message)
    )
      throw new HttpError(503, "No pudimos guardar la foto. Revisá el almacenamiento disponible.");
    const made = await db
      .from("projects")
      .insert({
        user_id: actorId,
        original_hash: originalHash,
        original_path: path,
        original_bytes: image.length,
        name: name.slice(0, 100) || "Foto de la demo",
      })
      .select("id,user_id")
      .single();
    if (made.error?.code === "23505") project = await lookup();
    else if (made.error || !made.data) throw new Error("PROJECT_CREATE_FAILED");
    else project = made.data;
    if (!project) throw new Error("PROJECT_CREATE_FAILED");
  }
  if (existing.some((p) => p.project_id === project!.id))
    throw new HttpError(409, "Esta foto ya está en la demo.");
  const inserted = await db
    .from("demo_photos")
    .insert({
      property_id: demo.property_id,
      project_id: project.id,
      position: existing.reduce((n, p) => Math.max(n, p.position + 1), 0),
    })
    .select(PHOTO_FIELDS)
    .single();
  if (inserted.error?.code === "23505") throw new HttpError(409, "Esta foto ya está en la demo.");
  if (inserted.error || !inserted.data) throw new Error("DEMO_PHOTO_CREATE_FAILED");
  return { ...(inserted.data as PhotoRow), reused: false };
}

export async function photoOf(demo: DemoRow, photoId: string) {
  if (!isUuid(photoId)) throw new HttpError(404, "No encontramos la foto.");
  const photo = check(
    await adminClient()
      .from("demo_photos")
      .select(PHOTO_FIELDS)
      .eq("id", photoId)
      .eq("property_id", demo.property_id)
      .maybeSingle(),
    "DEMO_PHOTO_LOOKUP_FAILED",
  ) as PhotoRow | null;
  if (!photo) throw new HttpError(404, "No encontramos la foto.");
  return photo;
}

async function liveJobs(projectIds: string[]) {
  if (!projectIds.length) return false;
  const { count, error } = await adminClient()
    .from("generations")
    .select("id", { count: "exact", head: true })
    .in("project_id", projectIds)
    .in("status", ["queued", "running"]);
  if (error) throw new Error("DEMO_JOBS_LOOKUP_FAILED");
  return (count || 0) > 0;
}
export async function assertNoLiveJobs(projectIds: string[]) {
  if (await liveJobs(projectIds))
    throw new HttpError(409, "Esperá a que terminen las ambientaciones en curso.");
}

/**
 * Deletes demo projects no demo uses any more, with their files. Projects
 * with a result under review are kept so the team can still resolve it.
 */
export async function releaseProjects(projectIds: string[]) {
  const db = adminClient();
  for (const id of [...new Set(projectIds)]) {
    try {
      const { count } = await db
        .from("demo_photos")
        .select("id", { count: "exact", head: true })
        .eq("project_id", id);
      if (count !== 0) continue;
      const project = check(
        await db
          .from("projects")
          .select("id,original_path,original_hash,generations(status,result_path)")
          .eq("id", id)
          .is("deleted_at", null)
          .maybeSingle(),
        "PROJECT_LOOKUP_FAILED",
      ) as {
        original_path: string;
        original_hash: string;
        generations: { status: string; result_path: string | null }[];
      } | null;
      if (!project || !project.original_hash.startsWith("demo:")) continue;
      if (project.generations.some((g) => ["queued", "running", "needs_review"].includes(g.status)))
        continue;
      const marked = await db
        .from("projects")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (marked.error) continue;
      const paths = [
        project.original_path,
        ...project.generations.flatMap((g) => (g.result_path ? [g.result_path] : [])),
      ];
      const removed = await db.storage.from(BUCKET).remove(paths);
      if (removed.error) console.error("demo_image_delete_deferred", id);
    } catch {
      console.error("demo_project_release_failed", id);
    }
  }
}

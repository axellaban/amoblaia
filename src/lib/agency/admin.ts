import "server-only";
import { randomBytes } from "node:crypto";
import { HttpError, rpc } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { agencyCredits } from "./panel";
import { claimHash } from "./server";
import { claimState, type AdminAgencyDetail, type AdminAgencyRow } from "./stage";
import { presentationPath } from "./demo-invite";

const CLAIM_DAYS = 30;

type ListRow = {
  id: string;
  name: string;
  slug: string | null;
  owner_id: string | null;
  claimed_at: string | null;
  site_published: boolean;
  created_at: string;
  properties: number | string;
  published: number | string;
  partial_imports: number | string;
  failed_imports: number | string;
  review: number | string;
  live_claim_expires: string | null;
  last_claim_at: string | null;
  total: number | string;
};

/** The team's list of agencies, newest first, paged with the real total. */
export async function adminAgencies(query: { q?: string | null; page?: number; perPage?: number }) {
  const perPage = Math.min(100, Math.max(1, Math.trunc(query.perPage ?? 50)));
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const q = query.q?.trim().slice(0, 80) || null;
  const rows = await rpc<ListRow[]>("habita_admin_agencies", { p_q: q, p_limit: perPage, p_offset: (page - 1) * perPage });
  const items: AdminAgencyRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    hasOwner: !!r.owner_id,
    claimedAt: r.claimed_at,
    sitePublished: r.site_published,
    createdAt: r.created_at,
    properties: Number(r.properties),
    published: Number(r.published),
    partialImports: Number(r.partial_imports),
    failedImports: Number(r.failed_imports),
    review: Number(r.review),
    liveClaimExpires: r.live_claim_expires,
    lastClaimAt: r.last_claim_at,
    available: null,
    reserved: null,
  }));
  const balances = await agencyBalances(items.map((i) => i.id));
  for (const item of items) Object.assign(item, balances.get(item.id) ?? {});
  return { items, total: rows?.length ? Number(rows[0].total) : 0, page, perPage };
}

/** One agency as the team sees it: stage, invitations, members, properties and what needs attention. */
export async function adminAgency(id: string): Promise<AdminAgencyDetail> {
  const db = adminClient();
  const { data: agency, error } = await db
    .from("agencies")
    .select("id,name,slug,website,owner_id,claimed_at,site_published,created_at,contact_name,notes")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("ADMIN_AGENCY_FAILED");
  if (!agency) throw new HttpError(404, "No encontramos la inmobiliaria.");
  const a = agency as {
    id: string;
    name: string;
    slug: string | null;
    website: string | null;
    owner_id: string | null;
    claimed_at: string | null;
    site_published: boolean;
    created_at: string;
    contact_name: string | null;
    notes: string | null;
  };
  const [claims, members, imports, demos, counts] = await Promise.all([
    db
      .from("agency_claims")
      .select("id,created_at,expires_at,used_at,revoked_at")
      .eq("agency_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    db.from("agency_members").select("user_id,role,created_at").eq("agency_id", id).order("created_at", { ascending: true }),
    db
      .from("property_imports")
      .select("id,url,status,error,created_at,photos_total,photos_done,settings_saved,demo_id")
      .eq("agency_id", id)
      .in("status", ["partial", "failed"])
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("demos")
      .select("id,status,token,created_at,demo_properties(title)", { count: "exact" })
      .eq("agency_id", id)
      .order("created_at", { ascending: false })
      .range(0, 49),
    rpc<{ total: number; published: number; staged: number; review: number }>("habita_agency_counts", { p_agency: id }),
  ]);
  if (claims.error || members.error || imports.error || demos.error) throw new Error("ADMIN_AGENCY_FAILED");
  // Before 202610300001_agency_free_credits.sql there is nothing pending: shown as unknown.
  const [pending, balance] = await Promise.all([
    db.from("agencies").select("free_credits_pending").eq("id", id).maybeSingle(),
    agencyCredits(a.owner_id),
  ]);
  const now = Date.now();
  const claimRows = (claims.data ?? []) as { id: string; created_at: string; expires_at: string; used_at: string | null; revoked_at: string | null }[];
  return {
    agency: {
      id: a.id,
      name: a.name,
      slug: a.slug,
      website: a.website,
      hasOwner: !!a.owner_id,
      claimedAt: a.claimed_at,
      sitePublished: a.site_published,
      createdAt: a.created_at,
      contactName: a.contact_name,
      notes: a.notes,
    },
    counts,
    credits: {
      balance,
      pending: pending.error ? null : ((pending.data as { free_credits_pending: number } | null)?.free_credits_pending ?? 0),
    },
    claims: claimRows.map((c) => ({
      id: c.id,
      createdAt: c.created_at,
      expiresAt: c.expires_at,
      usedAt: c.used_at,
      revokedAt: c.revoked_at,
      state: claimState(c, now),
    })),
    members: ((members.data ?? []) as { user_id: string; role: "owner" | "collaborator"; created_at: string }[]).map((m) => ({
      role: m.role,
      since: m.created_at,
    })),
    imports: ((imports.data ?? []) as {
      id: string;
      url: string;
      status: "partial" | "failed";
      error: string | null;
      created_at: string;
      photos_total: number | null;
      photos_done: number | null;
      settings_saved: boolean | null;
      demo_id: string | null;
    }[]).map((i) => ({
      id: i.id,
      url: i.url,
      status: i.status,
      error: i.error,
      createdAt: i.created_at,
      photosTotal: i.photos_total ?? 0,
      photosDone: i.photos_done ?? 0,
      settingsSaved: i.settings_saved !== false,
      demoId: i.demo_id,
    })),
    properties: ((demos.data ?? []) as unknown as {
      id: string;
      status: "draft" | "published";
      token: string;
      created_at: string;
      demo_properties: { title: string } | null;
    }[]).map((d) => ({ id: d.id, status: d.status, token: d.token, createdAt: d.created_at, title: d.demo_properties?.title ?? "Propiedad" })),
    propertiesTotal: demos.count ?? (demos.data ?? []).length,
  };
}

/**
 * A one-time link for an agency without an account to take over the demos
 * prepared for it. Only the team creates it; it works once and expires in
 * 30 days. Only its hash is stored.
 */
export async function createClaim(agencyId: string, actorId: string, origin: string, demoToken?: string | null) {
  const db = adminClient();
  const { data, error } = await db.from("agencies").select("owner_id").eq("id", agencyId).single();
  if (error) throw new HttpError(409, "Para esto falta aplicar la migración 202610280001_agency_accounts.sql en Supabase.");
  if ((data as { owner_id: string | null }).owner_id) throw new HttpError(409, "Esta inmobiliaria ya tiene su cuenta en habita.");
  const code = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + CLAIM_DAYS * 86400000).toISOString();
  const saved = await db.from("agency_claims").insert({
    agency_id: agencyId,
    code_hash: claimHash(code),
    created_by: actorId,
    expires_at: expiresAt,
  });
  if (saved.error) throw new Error("CLAIM_CREATE_FAILED");
  await rpc("amobla_account", { p_user: actorId, p_trial: false });
  await db.from("admin_audit").insert({ actor_id: actorId, action: "agency_claim_link", subject_id: agencyId, details: { demo: demoToken ?? null } });
  const demo = demoToken ? `&demo=${encodeURIComponent(demoToken)}` : "";
  return {
    url: `${origin}/panel/empezar?codigo=${code}${demo}`,
    // The demo itself as the way in: it offers "Probar esta propiedad en mi panel" with this same code.
    presentationUrl: demoToken ? `${origin}${presentationPath(demoToken, code)}` : null,
    expiresAt,
  };
}

/** Revokes an invitation not used yet; the link stops working at once. */
export async function revokeClaim(agencyId: string, claimId: string, actorId: string) {
  const db = adminClient();
  const { data, error } = await db
    .from("agency_claims")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", claimId)
    .eq("agency_id", agencyId)
    .is("used_at", null)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error("CLAIM_REVOKE_FAILED");
  if (!(data ?? []).length) throw new HttpError(409, "Esa invitación ya se usó o ya estaba revocada.");
  await rpc("amobla_account", { p_user: actorId, p_trial: false });
  await db.from("admin_audit").insert({ actor_id: actorId, action: "agency_claim_revoke", subject_id: agencyId, details: { claim: claimId } });
}

/**
 * Free credits for an agency (1 credit = 1 photo): to its owner's balance at
 * once, or waiting until the agency claims its account. Audited with reason.
 */
export async function giveAgencyCredits(actorId: string, agencyId: string, photos: unknown, reason: unknown, key: unknown) {
  if (!isUuid(key)) throw new HttpError(400, "Volvé a abrir el formulario e intentá de nuevo.");
  const n = Number(photos);
  const why = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new HttpError(400, "Ingresá entre 1 y 1000 créditos.");
  if (why.length < 5) throw new HttpError(400, "Contá en pocas palabras por qué (por ejemplo, «Regalo de bienvenida»).");
  await rpc("amobla_account", { p_user: actorId, p_trial: false });
  // Anything still waiting moves first, so nothing stays pending on an agency with an owner.
  await applyAgencyCredits(agencyId);
  try {
    // One grant per request key: a double click, a retry after a timeout or two tabs credit once.
    return await rpc<{ applied: "owner" | "pending"; pending: number; replay: boolean }>("habita_agency_credit_once", {
      p_key: key,
      p_actor: actorId,
      p_agency: agencyId,
      p_photos: n,
      p_reason: why,
    });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code.includes("AGENCY_NOT_FOUND")) throw new HttpError(404, "No encontramos la inmobiliaria.");
    if (code.includes("INVALID_ADJUSTMENT")) throw new HttpError(400, "Ingresá entre 1 y 1000 créditos (en total pendientes) y el motivo.");
    if (code.includes("KEY_REUSED")) throw new HttpError(409, "Ese pedido ya se usó con otra cantidad. Volvé a abrir el formulario.");
    if (/habita_agency_credit_once|function/i.test(code))
      throw new HttpError(409, "Para esto falta aplicar la migración 202610310001_property_spaces.sql en Supabase.");
    throw e;
  }
}

/** Moves the credits waiting for an agency to its owner, if it has one. Never fails the caller (claims, invitations). */
export async function applyAgencyCredits(agencyId: string) {
  return rpc<number>("habita_apply_agency_credits", { p_agency: agencyId }).catch(() => 0);
}

/** The team's explicit "Aplicar ahora": how many moved, and a failure is a failure (never shown as 0). */
export async function applyAgencyCreditsNow(agencyId: string) {
  try {
    return await rpc<number>("habita_apply_agency_credits", { p_agency: agencyId });
  } catch {
    throw new HttpError(502, "No pudimos aplicar los créditos reservados. No se movió nada: probá de nuevo.");
  }
}

/** Available (the owner's balance) and reserved credits of a page of agencies; unknown stays null, never 0. */
export async function agencyBalances(ids: string[]) {
  const out = new Map<string, { available: number | null; reserved: number | null }>();
  if (!ids.length) return out;
  try {
    const rows = await rpc<{ agency_id: string; available: number | null; reserved: number | null }[]>("habita_admin_agency_balances", {
      p_agencies: ids,
    });
    for (const r of rows ?? []) out.set(r.agency_id, { available: r.available, reserved: r.reserved });
  } catch {
    // Before 202610310001 or on a failed lookup: unknown.
  }
  return out;
}

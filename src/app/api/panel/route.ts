import { failure, HttpError, requireUser } from "@/lib/commerce/http";
import { createAgency, panelSummary } from "@/lib/agency/panel";
import { membershipOf, requireAgency } from "@/lib/agency/server";
import { validSlug } from "@/lib/agency/shared";
import { brandingOf, saveJson } from "@/lib/demos/server";
import { brandingInput, readJson } from "@/lib/demos/input";
import { cleanText, cleanUrl } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** The agency of this account and its panel's home, or { agency: null } before creating it. */
export async function GET() {
  try {
    const user = await requireUser();
    const membership = await membershipOf(user.id);
    if (!membership) return Response.json({ agency: null }, { headers: PRIVATE });
    return Response.json(await panelSummary(membership), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** Creates the account's agency: { name }. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request, 2048);
    const name = cleanText(body.name, 120);
    if (!name) throw new HttpError(400, "Ingresá el nombre de tu inmobiliaria.");
    await createAgency(user.id, name);
    const membership = await membershipOf(user.id);
    if (!membership) throw new Error("AGENCY_CREATE_FAILED");
    return Response.json(await panelSummary(membership), { status: 201, headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/**
 * "Mi sitio web": name, site address, website, WhatsApp or e-mail for
 * inquiries, main color and whether the site is public. Owner only.
 */
export async function PATCH(request: Request) {
  try {
    const { user, agency, role } = await requireAgency(request);
    if (role !== "owner") throw new HttpError(403, "Solo el dueño de la inmobiliaria puede cambiar su sitio.");
    const body = await readJson(request, 4096);
    const db = adminClient();
    const changes: Record<string, unknown> = {};
    if ("name" in body) {
      const name = cleanText(body.name, 120);
      if (!name) throw new HttpError(400, "Ingresá el nombre de tu inmobiliaria.");
      changes.name = name;
    }
    if ("website" in body) {
      const website = cleanUrl(body.website);
      if (website === undefined) throw new HttpError(400, "Revisá el sitio web: usá una dirección como inmobiliaria.com.ar.");
      changes.website = website;
    }
    if ("slug" in body) {
      if (!validSlug(body.slug)) throw new HttpError(400, "La dirección del sitio admite letras minúsculas, números y guiones.");
      const { data: taken } = await db.from("agencies").select("id").eq("slug", body.slug).neq("id", agency.id).maybeSingle();
      if (taken) throw new HttpError(409, "Esa dirección ya la usa otra inmobiliaria.");
      changes.slug = body.slug;
    }
    if ("sitePublished" in body) {
      if (typeof body.sitePublished !== "boolean") throw new HttpError(400, "Valor inválido.");
      changes.site_published = body.sitePublished;
    }
    if (Object.keys(changes).length) {
      const { error } = await db.from("agencies").update(changes).eq("id", agency.id);
      if (error) throw new Error("AGENCY_UPDATE_FAILED");
    }
    if ("primary" in body || "contactValue" in body) {
      const current = await brandingOf(agency.id);
      const next = brandingInput(
        {
          ...("primary" in body ? { primary: body.primary } : {}),
          ...("contactValue" in body ? { contactKind: body.contactKind, contactValue: body.contactValue } : {}),
        },
        current,
      );
      await saveJson("agencies", "branding", agency.id, next);
    }
    const membership = await membershipOf(user.id);
    return Response.json(await panelSummary(membership!), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

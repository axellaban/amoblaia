import { failure, HttpError } from "@/lib/commerce/http";
import { requireAgency, requireAgencyRead } from "@/lib/agency/server";
import { agencyCatalog } from "@/lib/agency/site";
import { readJson } from "@/lib/demos/input";
import { discardDraft, editorSite, listInquiries, publishDraft, resetSite, saveDraft } from "@/lib/site/server";
import { normalizeSite, templateSite, TEMPLATES, type TemplateId } from "@/lib/site/schema";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** The site editor's start: the draft, the agency's data and its properties for the preview. */
export async function GET() {
  try {
    const { agency, role } = await requireAgencyRead();
    const [site, catalog, inbox] = await Promise.all([editorSite(agency.id), agencyCatalog(agency.id), listInquiries(agency.id)]);
    const unread = inbox.unread;
    return Response.json(
      {
        ...site,
        role,
        agency: { id: agency.id, name: agency.name, slug: agency.slug, sitePublished: agency.site_published, website: agency.website },
        catalog: catalog ? { ...catalog, logo: catalog.logo ? catalog.logo.replace(/^\/inmobiliaria\/[^/]+\/logo/, "/api/panel/logo") : null } : null,
        unread,
      },
      { headers: PRIVATE },
    );
  } catch (e) {
    return failure(e);
  }
}

/** Saves the draft: { site } or { template } to start from one. The public site does not change. */
export async function PUT(request: Request) {
  try {
    const { agency } = await requireAgency(request, "manage");
    const body = await readJson(request, 900_000);
    if (typeof body.template === "string") {
      if (!TEMPLATES.some((t) => t.id === body.template)) throw new HttpError(400, "Plantilla inválida.");
      const { seed } = await editorSite(agency.id);
      return Response.json(await saveDraft(agency.id, templateSite(body.template as TemplateId, seed)), { headers: PRIVATE });
    }
    if (!body.site || typeof body.site !== "object") throw new HttpError(400, "Solicitud inválida.");
    // Validated as a whole (normalizeSite): unknown sections or fields are dropped.
    return Response.json(await saveDraft(agency.id, normalizeSite(body.site)), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** { action: "publish" | "discard" | "reset" }. */
export async function POST(request: Request) {
  try {
    const { agency } = await requireAgency(request, "manage");
    const body = await readJson(request, 1024);
    const action = body.action;
    const site =
      action === "publish"
        ? await publishDraft(agency.id, Boolean(agency.slug))
        : action === "discard"
          ? await discardDraft(agency.id)
          : action === "reset"
            ? await resetSite(agency.id)
            : null;
    if (!site) throw new HttpError(400, "Acción inválida.");
    return Response.json({ ...site, sitePublished: action === "publish" ? true : agency.site_published }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

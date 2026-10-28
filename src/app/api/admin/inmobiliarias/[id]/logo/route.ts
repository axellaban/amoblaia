import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { requireAgencyEdit } from "@/lib/agency/admin-edit";
import { auditAgencyEdit } from "@/lib/agency/edit-context";
import { brandingOf, logoFromBytes, logoOf, saveJson } from "@/lib/demos/server";
import { isUuid } from "@/lib/demos/shared";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const MAX_UPLOAD = 2 * 1024 * 1024;

/** The agency's logo for the team. */
export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
    const logo = await logoOf(id);
    if (!logo) throw new HttpError(404, "La inmobiliaria no tiene logo.");
    return new Response(new Uint8Array(logo.bytes), { headers: { "Content-Type": logo.type, "Cache-Control": "private, max-age=3600" } });
  } catch (e) {
    return failure(e);
  }
}

/** A new logo, inside the agency's edit context (kept small, like the demo editor's). */
export async function POST(request: Request, { params }: Params) {
  try {
    if (Number(request.headers.get("content-length") || 0) > MAX_UPLOAD + 16384) throw new HttpError(413, "El logo es demasiado grande.");
    const { id } = await params;
    const access = await requireAgencyEdit(request, id);
    const file = (await request.formData().catch(() => null))?.get("logo");
    if (!(file instanceof File) || !file.size || file.size > MAX_UPLOAD || !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type))
      throw new HttpError(400, "Subí el logo en PNG, JPG, WebP o SVG de hasta 2 MB.");
    const logo = await logoFromBytes(Buffer.from(await file.arrayBuffer()));
    await saveJson("agencies", "branding", id, { ...(await brandingOf(id)), logo });
    await auditAgencyEdit(access, "logo_set", {}, id);
    return Response.json({ saved: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const access = await requireAgencyEdit(request, id);
    const { logo: _removed, ...rest } = await brandingOf(id);
    await saveJson("agencies", "branding", id, rest);
    await auditAgencyEdit(access, "logo_remove", {}, id);
    return Response.json({ saved: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

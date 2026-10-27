import { failure, HttpError } from "@/lib/commerce/http";
import { requireDemoAccess } from "@/lib/agency/server";
import { brandingOf, logoFromBytes, logoOf, saveJson } from "@/lib/demos/server";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const MAX_UPLOAD = 2 * 1024 * 1024;

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { demo } = await requireDemoAccess(undefined, id);
    const logo = await logoOf(demo.agency_id);
    if (!logo) throw new HttpError(404, "La inmobiliaria no tiene logo.");
    return new Response(new Uint8Array(logo.bytes), {
      headers: { "Content-Type": logo.type, "Cache-Control": "private, max-age=3600" },
    });
  } catch (e) {
    return failure(e);
  }
}

/**
 * The agency's logo, kept small (at most 480×160, transparency preserved) in
 * its branding, so it needs no bucket and loads with the page.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    if (Number(request.headers.get("content-length") || 0) > MAX_UPLOAD + 16384)
      throw new HttpError(413, "El logo es demasiado grande.");
    const { id } = await params;
    const { demo, admin, role } = await requireDemoAccess(request, id);
    if (!admin && role !== "owner") throw new HttpError(403, "Solo el dueño de la inmobiliaria puede cambiar su marca.");
    const file = (await request.formData().catch(() => null))?.get("logo");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > MAX_UPLOAD ||
      !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type)
    )
      throw new HttpError(400, "Subí el logo en PNG, JPG, WebP o SVG de hasta 2 MB.");
    const logo = await logoFromBytes(Buffer.from(await file.arrayBuffer()));
    const branding = await brandingOf(demo.agency_id);
    await saveJson("agencies", "branding", demo.agency_id, { ...branding, logo });
    return Response.json({ saved: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { demo, admin, role } = await requireDemoAccess(request, id);
    if (!admin && role !== "owner") throw new HttpError(403, "Solo el dueño de la inmobiliaria puede cambiar su marca.");
    const { logo: _removed, ...rest } = await brandingOf(demo.agency_id);
    await saveJson("agencies", "branding", demo.agency_id, rest);
    return Response.json({ saved: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

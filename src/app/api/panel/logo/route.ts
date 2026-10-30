import { failure, HttpError } from "@/lib/commerce/http";
import { requireAgency } from "@/lib/agency/server";
import { brandingOf, logoFromBytes, logoOf, saveJson } from "@/lib/demos/server";
export const runtime = "nodejs";

const MAX_UPLOAD = 2 * 1024 * 1024;

export async function GET() {
  try {
    const { agency } = await requireAgency();
    const logo = await logoOf(agency.id);
    if (!logo) throw new HttpError(404, "Tu inmobiliaria todavía no tiene logo.");
    return new Response(new Uint8Array(logo.bytes), {
      headers: { "Content-Type": logo.type, "Cache-Control": "private, max-age=3600" },
    });
  } catch (e) {
    return failure(e);
  }
}

/** The agency's logo, kept small like the team's demos keep it. Owner only. */
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") || 0) > MAX_UPLOAD + 16384)
      throw new HttpError(413, "El logo es demasiado grande.");
    const { agency } = await requireAgency(request, "manage");
    const file = (await request.formData().catch(() => null))?.get("logo");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > MAX_UPLOAD ||
      !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type)
    )
      throw new HttpError(400, "Subí el logo en PNG, JPG, WebP o SVG de hasta 2 MB.");
    const logo = await logoFromBytes(Buffer.from(await file.arrayBuffer()));
    await saveJson("agencies", "branding", agency.id, { ...(await brandingOf(agency.id)), logo });
    return Response.json({ saved: true, v: logo.v }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const { agency } = await requireAgency(request, "manage");
    const { logo: _removed, ...rest } = await brandingOf(agency.id);
    await saveJson("agencies", "branding", agency.id, rest);
    return Response.json({ saved: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

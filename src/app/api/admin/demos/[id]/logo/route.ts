import sharp from "sharp";
import { createHash } from "node:crypto";
import { requireAdmin, failure, HttpError } from "@/lib/commerce/http";
import { brandingOf, demoRow, logoOf, saveJson } from "@/lib/demos/server";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const MAX_UPLOAD = 2 * 1024 * 1024;

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    const logo = await logoOf((await demoRow(id)).agency_id);
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
    await requireAdmin(request);
    if (Number(request.headers.get("content-length") || 0) > MAX_UPLOAD + 16384)
      throw new HttpError(413, "El logo es demasiado grande.");
    const { id } = await params;
    const demo = await demoRow(id);
    const file = (await request.formData().catch(() => null))?.get("logo");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > MAX_UPLOAD ||
      !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type)
    )
      throw new HttpError(400, "Subí el logo en PNG, JPG, WebP o SVG de hasta 2 MB.");
    const png = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 20_000_000 })
      .resize({ width: 480, height: 160, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer()
      .catch(() => {
        throw new HttpError(400, "No pudimos leer el logo. Probá con otro archivo.");
      });
    const branding = await brandingOf(demo.agency_id);
    await saveJson("agencies", "branding", demo.agency_id, {
      ...branding,
      logo: {
        type: "image/png",
        data: png.toString("base64"),
        v: createHash("sha256").update(png).digest("hex").slice(0, 10),
      },
    });
    return Response.json({ saved: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const demo = await demoRow(id);
    const { logo: _removed, ...rest } = await brandingOf(demo.agency_id);
    await saveJson("agencies", "branding", demo.agency_id, rest);
    return Response.json({ saved: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

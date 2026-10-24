import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { requireUser, failure, HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/commerce/jobs";
import { ownedShowcase } from "@/lib/showcase-fields";
export const runtime = "nodejs";
const MAX_LOGO_BYTES = 1024 * 1024;
async function replaceLogo(
  userId: string,
  id: string,
  previous: string | null,
  next: string | null,
) {
  const db = adminClient();
  const { error } = await db
    .from("showcases")
    .update({ agency_logo_path: next, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error("SHOWCASE_LOGO_SAVE_FAILED");
  if (previous && previous !== next)
    await db.storage.from(BUCKET).remove([previous]).catch(() => null);
}
/**
 * Optional agency logo. Stored as a small JPG on white, like the photos, in
 * the owner's private folder; buyers only reach it through an active link.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    if (Number(request.headers.get("content-length") || 0) > MAX_LOGO_BYTES + 16384)
      throw new HttpError(413, "El logo supera 1 MB.");
    const showcase = await ownedShowcase(user.id, id);
    const file = (await request.formData()).get("logo");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > MAX_LOGO_BYTES ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    )
      throw new HttpError(400, "Subí el logo en JPG, PNG o WebP de hasta 1 MB.");
    let logo: Buffer;
    try {
      logo = await sharp(Buffer.from(await file.arrayBuffer()), {
        limitInputPixels: 25_000_000,
        animated: false,
      })
        .rotate()
        .resize({ width: 600, height: 240, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch {
      throw new HttpError(400, "No pudimos leer el logo. Probá con otro archivo.");
    }
    const path = `${user.id}/showcases/${id}/logo-${randomBytes(6).toString("hex")}.jpg`;
    const upload = await adminClient()
      .storage.from(BUCKET)
      .upload(path, logo, { contentType: "image/jpeg", upsert: false });
    if (upload.error) throw new HttpError(503, "No pudimos guardar el logo.");
    await replaceLogo(user.id, id, showcase.agency_logo_path, path);
    return Response.json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const showcase = await ownedShowcase(user.id, id);
    await replaceLogo(user.id, id, showcase.agency_logo_path, null);
    return Response.json({ deleted: true });
  } catch (e) {
    return failure(e);
  }
}

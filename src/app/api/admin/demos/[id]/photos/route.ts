import { requireAdmin, failure, HttpError, rpc } from "@/lib/commerce/http";
import { MAX_BYTES } from "@/lib/commerce/images";
import { addPhoto, demoRow } from "@/lib/demos/server";
export const runtime = "nodejs";

/** One photo per request (the panel uploads several in sequence, with progress). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireAdmin(request);
    if (Number(request.headers.get("content-length") || 0) > MAX_BYTES + 16384)
      throw new HttpError(413, "La foto es demasiado grande.");
    const { id } = await params;
    const demo = await demoRow(id);
    const data = await request.formData().catch(() => null);
    const file = data?.get("image");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > MAX_BYTES ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    )
      throw new HttpError(400, "Subí una imagen JPG, PNG o WebP de hasta 3 MB.");
    await rpc("amobla_account", { p_user: actor.id, p_trial: false });
    const photo = await addPhoto(
      demo,
      actor.id,
      Buffer.from(await file.arrayBuffer()),
      file.name.replace(/\.[^.]+$/, ""),
    );
    return Response.json(
      { id: photo.id },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

import { failure, HttpError } from "@/lib/commerce/http";
import { requireDemoAccess } from "@/lib/agency/server";
import { auditAgencyEdit } from "@/lib/agency/edit-context";
import { readJson } from "@/lib/demos/input";
import { assignPhotos, createSpace, orderSpaces, spaceState } from "@/lib/demos/spaces";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };
type Params = { params: Promise<{ id: string }> };

/** A new space of the property: { name, roomType }. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const access = await requireDemoAccess(request, id);
    const { demo } = access;
    const body = await readJson(request, 2048);
    const spaceId = await createSpace(demo.property_id, body);
    await auditAgencyEdit(access, "space_create", { space: spaceId });
    return Response.json({ id: spaceId, ...(await spaceState(demo.property_id)) }, { status: 201, headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** { order: [spaceIds] } reorders the spaces; { photoIds, spaceId } moves photos (spaceId null: "Sin organizar"). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const access = await requireDemoAccess(request, id);
    const { demo } = access;
    const body = await readJson(request, 16384);
    if ("order" in body) await orderSpaces(demo.property_id, body.order);
    else if ("photoIds" in body) await assignPhotos(demo.property_id, body.photoIds, body.spaceId ?? null);
    else throw new HttpError(400, "No hay cambios para guardar.");
    await auditAgencyEdit(access, "order" in body ? "space_order" : "photo_assign");
    return Response.json(await spaceState(demo.property_id), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

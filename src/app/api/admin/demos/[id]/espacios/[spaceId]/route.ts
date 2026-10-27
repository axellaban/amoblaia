import { failure } from "@/lib/commerce/http";
import { requireDemoAccess } from "@/lib/agency/server";
import { auditAgencyEdit } from "@/lib/agency/edit-context";
import { readJson } from "@/lib/demos/input";
import { isUuid } from "@/lib/demos/shared";
import { deleteSpace, spaceState, updateSpace } from "@/lib/demos/spaces";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };
type Params = { params: Promise<{ id: string; spaceId: string }> };

/** Renames a space or changes its kind: { name?, roomType? }. Its photos keep their own settings. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, spaceId } = await params;
    const access = await requireDemoAccess(request, id);
    const { demo } = access;
    await updateSpace(demo.property_id, spaceId, await readJson(request, 2048));
    await auditAgencyEdit(access, "space_update", { space: spaceId });
    return Response.json(await spaceState(demo.property_id), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** Deletes a space; its photos move to ?destino=<space> or to "Sin organizar". Nothing else is deleted. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id, spaceId } = await params;
    const access = await requireDemoAccess(request, id);
    const { demo } = access;
    const target = new URL(request.url).searchParams.get("destino");
    const moved = await deleteSpace(demo.property_id, spaceId, isUuid(target) ? target : null);
    await auditAgencyEdit(access, "space_delete", { space: spaceId, moved });
    return Response.json({ moved, ...(await spaceState(demo.property_id)) }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

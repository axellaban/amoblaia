import { failure, HttpError } from "@/lib/commerce/http";
import { requireAgency } from "@/lib/agency/server";
import { resolveAccessRequest } from "@/lib/agency/workspace";
import { readJson } from "@/lib/demos/input";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** An administrator answers a request to join: { approve: true } (joins as Miembro) or { approve: false }. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const membership = await requireAgency(request, "manage");
    const body = await readJson(request, 1024);
    if (typeof body.approve !== "boolean") throw new HttpError(400, "Valor inválido.");
    const status = await resolveAccessRequest(membership, membership.user.id, id, body.approve);
    return Response.json({ status }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

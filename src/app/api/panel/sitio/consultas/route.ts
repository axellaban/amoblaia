import { failure, HttpError } from "@/lib/commerce/http";
import { requireAgency, requireAgencyRead } from "@/lib/agency/server";
import { readJson } from "@/lib/demos/input";
import { deleteInquiry, listInquiries, markInquiries } from "@/lib/site/server";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** The inquiries that came in through the site's forms. */
export async function GET() {
  try {
    const { agency } = await requireAgencyRead();
    return Response.json(await listInquiries(agency.id), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** { ids, read }: marks them read or unread. */
export async function PATCH(request: Request) {
  try {
    const { agency } = await requireAgency(request, "edit");
    const body = await readJson(request, 16384);
    if (!Array.isArray(body.ids) || typeof body.read !== "boolean") throw new HttpError(400, "Solicitud inválida.");
    await markInquiries(agency.id, body.ids.filter((x): x is string => typeof x === "string"), body.read);
    return Response.json(await listInquiries(agency.id), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** { id }: deletes one. */
export async function DELETE(request: Request) {
  try {
    const { agency } = await requireAgency(request, "manage");
    const body = await readJson(request, 1024);
    await deleteInquiry(agency.id, typeof body.id === "string" ? body.id : "");
    return Response.json(await listInquiries(agency.id), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

import { failure, requireAdmin } from "@/lib/commerce/http";
import { possibleDuplicates } from "@/lib/agency/admin-edit";
export const runtime = "nodejs";

/** Agencies that may be the one being created: ?nombre=&web=&email= (read only; nothing is merged). */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const q = new URL(request.url).searchParams;
    const items = await possibleDuplicates({ name: q.get("nombre"), website: q.get("web"), contactEmail: q.get("email") });
    return Response.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

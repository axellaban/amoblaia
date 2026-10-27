import { failure, requireAdmin } from "@/lib/commerce/http";
import { adminAgencies } from "@/lib/agency/admin";
export const runtime = "nodejs";

/** The team's list of agencies: ?q=&pagina= (real total included). */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const q = new URL(request.url).searchParams;
    const result = await adminAgencies({ q: q.get("q"), page: Number(q.get("pagina")) || 1 });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

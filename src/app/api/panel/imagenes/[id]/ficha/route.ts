import { failure } from "@/lib/commerce/http";
import { makeFicha } from "@/lib/agency/photo-groups";
import { requireAgency } from "@/lib/agency/server";
export const runtime = "nodejs";

/** Creates the ficha from a photo group of the agency: a draft, its photos kept. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { agency } = await requireAgency(request, "create");
    return await makeFicha(agency.id, id);
  } catch (e) {
    return failure(e);
  }
}

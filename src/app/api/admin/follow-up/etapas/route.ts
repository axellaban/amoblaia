import { HttpError, failure, requireAdmin } from "@/lib/commerce/http";
import { createStage, customStages } from "@/lib/followup/commercial-catalog";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json({ stages: await customStages() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Etapa inválida.");
    return Response.json(await createStage(input), { status: 201 });
  } catch (error) { return failure(error); }
}

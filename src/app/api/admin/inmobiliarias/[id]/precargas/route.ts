import { failure } from "@/lib/commerce/http";
import { requireAgencyEdit } from "@/lib/agency/admin-edit";
import { findPreloads } from "@/lib/agency/preload-discovery";
import { readJson } from "@/lib/demos/input";
export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/**
 * Dos publicaciones más de la web de la inmobiliaria, con fotos interiores, para dejarlas
 * precargadas ({ exclude: [urls] } las que ya se eligieron). Solo lee: se importan después con
 * «Dejarlas precargadas», como si se hubieran pegado a mano.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAgencyEdit(request, id);
    const body = await readJson(request);
    const exclude = Array.isArray(body.exclude) ? body.exclude.filter((u: unknown): u is string => typeof u === "string").slice(0, 10) : [];
    const candidates = await findPreloads(id, { want: 2, exclude });
    return Response.json({ candidates }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

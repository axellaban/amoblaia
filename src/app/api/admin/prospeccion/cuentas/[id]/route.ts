import { HttpError, requireAdmin } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { body, iso, NO_STORE, prospectAccount, prospectFailure, prospectRpc, text } from "@/lib/prospecting/server";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** One account with history, contacts, attempts, suppressions and its demos. */
export async function GET(request: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la cuenta.");
    return Response.json(await prospectAccount(id, new URL(request.url).origin), { headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}

const TEXT_FIELDS: Record<string, number> = {
  sdr: 80,
  campaign: 80,
  zone: 120,
  priority: 40,
  next_action: 300,
  decision_maker: 160,
  decision_maker_role: 120,
  team_notes: 8000,
  scoring_version: 80,
};

/** Edits operational fields. `version` is required: a concurrent edit gets 409. */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la cuenta.");
    const b = await body(request);
    if (!Number.isInteger(b.version)) throw new HttpError(400, "Falta la versión de la cuenta.");
    const patch: Record<string, unknown> = {};
    for (const [k, max] of Object.entries(TEXT_FIELDS)) if (k in b) patch[k] = b[k] == null ? null : text(b[k], max);
    if ("due_at" in b) patch.due_at = iso(b.due_at);
    if ("due_precision" in b) {
      if (b.due_precision !== "time" && b.due_precision !== "day") throw new HttpError(400, "Precisión inválida.");
      patch.due_precision = b.due_precision;
    }
    if ("stage" in b) patch.stage = b.stage;
    if ("score" in b) {
      if (b.score !== null && (typeof b.score !== "number" || !Number.isFinite(b.score) || Math.abs(b.score) > 1e6)) throw new HttpError(400, "Score inválido.");
      patch.score = b.score;
    }
    if ("score_components" in b) {
      const c = b.score_components;
      if (!c || typeof c !== "object" || Array.isArray(c) || Object.keys(c).length > 20) throw new HttpError(400, "Componentes inválidos.");
      for (const v of Object.values(c)) if (typeof v !== "number" && typeof v !== "string") throw new HttpError(400, "Componentes inválidos.");
      patch.score_components = c;
    }
    if (!Object.keys(patch).length) throw new HttpError(400, "No hay cambios.");
    const account = await prospectRpc("habita_prospect_update", { p_actor: actor.id, p_account: id, p_version: b.version, p_patch: patch });
    return Response.json(account, { headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}

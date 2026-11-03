import { HttpError } from "@/lib/commerce/http";
import { sameSecret } from "@/lib/session";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { isUuid } from "@/lib/demos/shared";
import { LEGACY_CHANNELS, type LegacyChannel } from "@/lib/prospecting/import";
import { body, NO_STORE, prospectFailure, text } from "@/lib/prospecting/server";
import { runSheetSync } from "@/lib/prospecting/sync";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Automatic sync of the prospecting sheet, called by the script in the sheet
 * (scripts/prospeccion-sync.gs). It has no admin session, so it is guarded by
 * PROSPECT_SYNC_TOKEN (a Bearer secret of at least 32 characters). Writes are
 * recorded as PROSPECT_SYNC_ACTOR_ID, an existing team member's user id.
 */
export async function POST(request: Request) {
  try {
    if (!cloudEnabled() || !cloudConfigured()) throw new HttpError(503, "La base de prospección no está disponible.");
    const secret = process.env.PROSPECT_SYNC_TOKEN;
    if (!secret || secret.length < 32 || !sameSecret(request.headers.get("authorization") || "", `Bearer ${secret}`))
      throw new HttpError(401, "No autorizado.");
    const actor = process.env.PROSPECT_SYNC_ACTOR_ID;
    if (!isUuid(actor)) throw new HttpError(503, "Falta PROSPECT_SYNC_ACTOR_ID en la configuración.");
    const b = await body(request);
    if (typeof b.csv !== "string" || !b.csv.trim()) throw new HttpError(400, "Falta el contenido de la pestaña.");
    const source = text(b.source, 80);
    if (!source) throw new HttpError(400, "Indicá el origen de la planilla.");
    const legacyChannel: LegacyChannel =
      typeof b.legacyChannel === "string" && b.legacyChannel in LEGACY_CHANNELS ? (b.legacyChannel as LegacyChannel) : "unknown";
    const report = await runSheetSync({ actor, csv: b.csv, source, legacyChannel });
    return Response.json(report, { headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}

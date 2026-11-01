import { failure, HttpError, requireUser } from "@/lib/commerce/http";
import { membershipFor, requireAgency } from "@/lib/agency/server";
import { isFutureFeature } from "@/lib/agency/future-features";
import { readJson } from "@/lib/demos/input";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };
type Row = { notify_email: boolean; notify_whatsapp: boolean; cancelled_at: string | null };
const state = (row: Row | null) => ({
  interested: Boolean(row && !row.cancelled_at),
  notifyEmail: Boolean(row && !row.cancelled_at && row.notify_email),
  notifyWhatsapp: Boolean(row && !row.cancelled_at && row.notify_whatsapp),
});

/**
 * Any member of the agency says it for itself, viewers included (it is not an
 * edit), from the panel's own origin; the team's support view only reads.
 */
async function member(request: Request) {
  const user = await requireUser(request);
  const m = await membershipFor(user);
  if (!m) throw new HttpError(404, "Todavía no creaste tu inmobiliaria.");
  if (m.support) throw new HttpError(403, "En la vista de soporte no se registra interés en nombre de la inmobiliaria.");
  return { user, ...m };
}

async function current(agencyId: string, userId: string, feature: string) {
  const { data, error } = await adminClient()
    .from("feature_interest")
    .select("notify_email,notify_whatsapp,cancelled_at")
    .eq("feature_key", feature)
    .eq("agency_id", agencyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("FEATURE_INTEREST_LOOKUP_FAILED");
  return data as Row | null;
}

/** ?feature=tour_360: whether this user already asked to be told. */
export async function GET(request: Request) {
  try {
    const m = await requireAgency();
    const feature = new URL(request.url).searchParams.get("feature");
    if (!isFutureFeature(feature)) throw new HttpError(400, "Funcionalidad desconocida.");
    if (m.support) return Response.json(state(null), { headers: PRIVATE });
    return Response.json(state(await current(m.agency.id, m.user.id, feature)), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** { feature, notifyEmail, notifyWhatsapp, source }: registers (or updates) the interest. Idempotent. */
export async function POST(request: Request) {
  try {
    const m = await member(request);
    const body = await readJson(request, 1024);
    if (!isFutureFeature(body.feature)) throw new HttpError(400, "Funcionalidad desconocida.");
    const source = typeof body.source === "string" ? body.source.replace(/[^\w-]/g, "").slice(0, 40) || null : null;
    const now = new Date().toISOString();
    const existing = await current(m.agency.id, m.user.id, body.feature);
    const { error } = await adminClient()
      .from("feature_interest")
      .upsert(
        {
          feature_key: body.feature,
          agency_id: m.agency.id,
          user_id: m.user.id,
          notify_email: body.notifyEmail === true,
          notify_whatsapp: body.notifyWhatsapp === true,
          source_surface: source,
          updated_at: now,
          cancelled_at: null,
        },
        { onConflict: "feature_key,agency_id,user_id" },
      );
    if (error) throw new Error("FEATURE_INTEREST_SAVE_FAILED");
    return Response.json(
      { ...state({ notify_email: body.notifyEmail === true, notify_whatsapp: body.notifyWhatsapp === true, cancelled_at: null }), first: !existing || Boolean(existing.cancelled_at) },
      { headers: PRIVATE },
    );
  } catch (e) {
    return failure(e);
  }
}

/** ?feature=tour_360: withdraws the interest and its notices (the row stays, cancelled). */
export async function DELETE(request: Request) {
  try {
    const m = await member(request);
    const feature = new URL(request.url).searchParams.get("feature");
    if (!isFutureFeature(feature)) throw new HttpError(400, "Funcionalidad desconocida.");
    const { error } = await adminClient()
      .from("feature_interest")
      .update({ cancelled_at: new Date().toISOString(), notify_email: false, notify_whatsapp: false, updated_at: new Date().toISOString() })
      .eq("feature_key", feature)
      .eq("agency_id", m.agency.id)
      .eq("user_id", m.user.id);
    if (error) throw new Error("FEATURE_INTEREST_SAVE_FAILED");
    return Response.json(state(null), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

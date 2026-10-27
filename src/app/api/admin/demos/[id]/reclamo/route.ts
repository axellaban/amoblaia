import { randomBytes } from "node:crypto";
import { failure, HttpError, requireAdmin, rpc } from "@/lib/commerce/http";
import { claimHash } from "@/lib/agency/server";
import { demoRow } from "@/lib/demos/server";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

const DAYS = 30;

/**
 * A one-time link for the agency of this demo to take over its demos, with
 * their stagings, in its own habita account. Only the team creates it and
 * sends it to the agency; it expires in 30 days and works once.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin(request);
    const { id } = await params;
    const demo = await demoRow(id);
    const db = adminClient();
    const { data, error } = await db.from("agencies").select("owner_id").eq("id", demo.agency_id).single();
    if (error) throw new HttpError(409, "Para esto falta aplicar la migración 202610280001_agency_accounts.sql en Supabase.");
    if ((data as { owner_id: string | null }).owner_id) throw new HttpError(409, "Esta inmobiliaria ya tiene su cuenta en habita.");
    const code = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + DAYS * 86400000).toISOString();
    const saved = await db.from("agency_claims").insert({
      agency_id: demo.agency_id,
      code_hash: claimHash(code),
      created_by: actor.id,
      expires_at: expiresAt,
    });
    if (saved.error) throw new Error("CLAIM_CREATE_FAILED");
    await rpc("amobla_account", { p_user: actor.id, p_trial: false });
    await db.from("admin_audit").insert({ actor_id: actor.id, action: "agency_claim_link", subject_id: demo.agency_id, details: { demo: demo.id } });
    const origin = new URL(request.url).origin;
    return Response.json(
      { url: `${origin}/panel/empezar?codigo=${code}&demo=${demo.token}`, expiresAt },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

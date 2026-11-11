import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { BUYER_AGENT_OFF, type BuyerAgentSettings } from "./buyer-agent";

/**
 * The general test of the property assistant. Fails closed: without the
 * migration (202612120002_buyer_agent_demo.sql) or on any read error, it is
 * off, so no agency sees the block unless its demo forces it.
 */
export async function buyerAgentSettings(): Promise<BuyerAgentSettings & { ready: boolean; updatedAt: string | null }> {
  try {
    const { data, error } = await adminClient()
      .from("habita_experiment_settings")
      .select("buyer_agent_enabled,buyer_agent_share,updated_at")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return { ...BUYER_AGENT_OFF, ready: false, updatedAt: null };
    const row = data as { buyer_agent_enabled: boolean; buyer_agent_share: number; updated_at: string };
    return { enabled: row.buyer_agent_enabled === true, share: row.buyer_agent_share, ready: true, updatedAt: row.updated_at };
  } catch {
    return { ...BUYER_AGENT_OFF, ready: false, updatedAt: null };
  }
}

export async function updateBuyerAgentSettings(input: { enabled?: unknown; share?: unknown }, actorId: string) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actorId };
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new HttpError(400, "Valor inválido.");
    patch.buyer_agent_enabled = input.enabled;
  }
  if (input.share !== undefined) {
    if (!Number.isInteger(input.share) || Number(input.share) < 0 || Number(input.share) > 100)
      throw new HttpError(400, "El reparto tiene que ser un porcentaje entre 0 y 100.");
    patch.buyer_agent_share = input.share;
  }
  const { error } = await adminClient().from("habita_experiment_settings").update(patch).eq("id", true);
  if (error) throw new HttpError(503, "No se pudo guardar. Verificá que la migración 202612120002_buyer_agent_demo.sql esté aplicada.");
  await adminClient()
    .from("admin_audit")
    .insert({ actor_id: actorId, action: "buyer_agent_settings", subject_id: null, details: patch })
    .then(
      () => undefined,
      () => undefined,
    );
  return buyerAgentSettings();
}

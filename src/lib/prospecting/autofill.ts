// Prospectos: el llenado automático de la cola de primeros saludos.
// Cada mañana (cron de las 06:00) mira cuántos primeros saludos tiene la cola listos o esperando
// cupo y suma las mejores calificadas hasta la meta del día, con la misma regla que «Sumar las
// mejores» (ranking + 15% de exploración). Lo que no se puede sumar queda dicho en `last`.
import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { firstContactWaiting, invalidateBoard, readQuotaSettings } from "@/lib/followup/server";
import { adminClient } from "@/lib/supabase/server";
import { autofillNeed, FILL_MAX } from "./pool";
import { fillQueue } from "./pool-server";

export type AutofillRun = {
  at: string;
  by: string;
  target: number;
  waiting: number;
  asked: number;
  added: number;
  explore: number;
  /** Cuántas faltaron para llegar a la meta porque no había calificadas. */
  short: number;
  error?: string;
};
export type AutofillSettings = {
  /** `false` si falta la migración 202612270001_prospect_autofill.sql: no corre y no se puede configurar. */
  available: boolean;
  enabled: boolean;
  /** La meta configurada; `null` = el cupo diario de primeros saludos. */
  target: number | null;
  /** La meta que se usa: la configurada o el cupo. */
  effectiveTarget: number;
  cap: number;
  last: AutofillRun | null;
};

const MIGRATION = "Falta aplicar en Supabase 202612270001_prospect_autofill.sql (llenado automático).";

export async function readAutofill(): Promise<AutofillSettings> {
  const quota = await readQuotaSettings().catch(() => ({ cap: 48 }));
  const cap = Math.min(FILL_MAX, quota.cap);
  // A failed read must not take the Prospectos view down: it shows the autofill as unavailable.
  const { data, error } = await (async () =>
    adminClient().from("followup_quota_settings").select("autofill_enabled,autofill_target,autofill_last").eq("id", true).maybeSingle())()
    .catch(() => ({ data: null, error: true }));
  if (error || !data) return { available: false, enabled: false, target: null, effectiveTarget: cap, cap: quota.cap, last: null };
  const target = typeof data.autofill_target === "number" ? data.autofill_target : null;
  return {
    available: true,
    enabled: data.autofill_enabled !== false,
    target,
    effectiveTarget: target ?? cap,
    cap: quota.cap,
    last: (data.autofill_last as AutofillRun | null) ?? null,
  };
}

/** Prende o apaga el llenado automático y cambia la meta (`null` vuelve al cupo diario). */
export async function updateAutofill(input: { activo?: unknown; meta?: unknown }) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.activo !== undefined) {
    if (typeof input.activo !== "boolean") throw new HttpError(400, "Indicá si el llenado automático queda activo.");
    patch.autofill_enabled = input.activo;
  }
  if (input.meta !== undefined) {
    if (input.meta !== null && (!Number.isInteger(input.meta) || Number(input.meta) < 1 || Number(input.meta) > FILL_MAX))
      throw new HttpError(400, `La meta diaria debe ser un número entre 1 y ${FILL_MAX}.`);
    patch.autofill_target = input.meta;
  }
  if (Object.keys(patch).length === 1) throw new HttpError(400, "No hay cambios.");
  const current = await readAutofill();
  if (!current.available) throw new HttpError(503, MIGRATION);
  const { error } = await adminClient().from("followup_quota_settings").update(patch).eq("id", true);
  if (error) throw new HttpError(503, "No se pudo guardar el llenado automático.");
  return readAutofill();
}

/**
 * Una corrida: suma lo que falta para la meta. El cron la llama cada mañana (si está activa) y el
 * panel puede pedirla a mano (`force`). Queda registrada en `autofill_last`.
 */
export async function runAutofill({ actor = null, by = "Llenado automático", force = false, now = new Date() }: { actor?: string | null; by?: string; force?: boolean; now?: Date } = {}) {
  const settings = await readAutofill();
  if (!settings.available) {
    if (force) throw new HttpError(503, MIGRATION);
    return null;
  }
  if (!settings.enabled && !force) return null;
  const run: AutofillRun = { at: now.toISOString(), by, target: settings.effectiveTarget, waiting: 0, asked: 0, added: 0, explore: 0, short: 0 };
  try {
    run.waiting = await firstContactWaiting(now);
    run.asked = autofillNeed(run.target, run.waiting);
    const added = run.asked ? await fillQueue(run.asked, actor) : [];
    if (!added) throw new Error("Falta aplicar la migración de Prospectos (202612140001_prospect_pool.sql).");
    run.added = added.length;
    run.explore = added.filter((a) => a.explore).length;
    run.short = run.asked - run.added;
  } catch (e) {
    run.error = e instanceof Error ? e.message.slice(0, 300) : "Error desconocido";
  }
  await adminClient().from("followup_quota_settings").update({ autofill_last: run }).eq("id", true);
  invalidateBoard();
  if (run.error && force) throw new HttpError(503, `No se pudo completar la cola: ${run.error}`);
  return run;
}

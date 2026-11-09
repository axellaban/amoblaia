import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { isStageKey, type StageKey } from "./stages";
import { isSituation, type Situation } from "./plan";

export type CustomStage = { key: string; label: string; technical_stage: StageKey; entry_situation: Situation };

export async function customStages(): Promise<CustomStage[]> {
  const { data, error } = await adminClient().from("followup_commercial_stages")
    .select("key,label,technical_stage,entry_situation").not("technical_stage", "is", null).order("created_at");
  if (error) throw new Error("FOLLOWUP_STAGE_READ_FAILED");
  return data ?? [];
}

export async function createStage(input: Record<string, unknown>) {
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (label.length < 2 || label.length > 80 || !isStageKey(input.technical_stage) || !isSituation(input.entry_situation))
    throw new HttpError(400, "Revisá el nombre, la etapa de origen y la situación de entrada.");
  const key = "etapa_" + crypto.randomUUID();
  const { error } = await adminClient().from("followup_commercial_stages").insert({
    key, label, technical_stage: input.technical_stage, entry_situation: input.entry_situation,
  });
  if (error?.code === "23505") throw new HttpError(409, "Ya existe una etapa con ese nombre o esa condición de entrada.");
  if (error) throw new Error("FOLLOWUP_STAGE_SAVE_FAILED");
  return { key };
}

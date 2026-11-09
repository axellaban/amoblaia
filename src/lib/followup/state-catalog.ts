import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { isCommercialStage } from "./stages";
import { customStages } from "./commercial-catalog";
import { CLOSED_SITUATIONS, REPLY_CLASSES, SITUATIONS, isSituation, isReplyClass, type ReplyClass, type Situation } from "./plan";

/**
 * User-configurable WhatsApp classifications. A custom key is always explicitly
 * mapped to one canonical Situation before it can influence the existing engine.
 * Unmapped/inactive classifications NEVER trigger a send.
 */
export type StateDefinition = {
  key: string;
  label: string;
  description: string;
  examples: string;
  commercial_stage: string;
  source: "whatsapp" | "manual";
  maps_to: ReplyClass | null;
  active: boolean;
  updated_at: string;
};

const COLS = "key,label,description,examples,commercial_stage,source,maps_to,active,updated_at";

const CUSTOM = /^custom_[a-z0-9_]{3,60}$/;

export async function readStateCatalog(): Promise<StateDefinition[]> {
  const { data, error } = await adminClient().from("followup_state_catalog").select(COLS).is("removed_at", null).order("created_at", { ascending: true }).limit(300);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") throw new HttpError(409, "Falta aplicar la migración 202612020001_followup_state_catalog.sql en Supabase.");
    throw new Error("FOLLOWUP_STATE_READ_FAILED");
  }
  return (data ?? []) as StateDefinition[];
}

export async function updateStateCatalog(input: Record<string, unknown>, actorId: string): Promise<StateDefinition> {
  const txt = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const key = txt(input.key);
  const label = txt(input.label);
  const commercial_stage = txt(input.commercial_stage);
  const description = txt(input.description);
  const examples = txt(input.examples);
  const source = txt(input.source) || "whatsapp";
  const maps_to = txt(input.maps_to) || null;
  const active = input.active === true;
  if (!CUSTOM.test(key)) throw new HttpError(400, "La clave debe empezar con custom_ y usar minúsculas y guiones bajos.");
  if (label.length < 2 || label.length > 80) throw new HttpError(400, "El nombre debe tener entre 2 y 80 caracteres.");
  if (!isCommercialStage(commercial_stage) && !(await customStages()).some(s => s.key === commercial_stage)) throw new HttpError(400, "Etapa comercial desconocida.");
  if (!["whatsapp", "manual"].includes(source)) throw new HttpError(400, "Origen de clasificación desconocido.");
  if (description.length > 800 || examples.length > 2000) throw new HttpError(400, "La descripción o los ejemplos son demasiado largos.");
  if (maps_to && (!isReplyClass(maps_to) || !(maps_to in SITUATIONS))) throw new HttpError(400, "La situación elegida no se puede usar para clasificar respuestas.");
  // Closed situations are allowed only as closed: never create an automated outbound rule.
  if (active && !maps_to) throw new HttpError(400, "Para activar el estado, elegí la situación canónica a la que corresponde.");
  const db = adminClient();
  const fields = { label, description, examples, source, maps_to, active, updated_by: actorId, updated_at: new Date().toISOString() };
  const table = db.from("followup_state_catalog");
  const change = input.create === true ? table.insert({ ...fields, key, commercial_stage }) :
    table.update(fields).eq("key", key).eq("commercial_stage", commercial_stage).is("removed_at", null);
  const { data, error } = await change.select(COLS).maybeSingle();
  if (!error && !data) throw new HttpError(404, "La situación ya no está en esta etapa.");
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") throw new HttpError(409, "Falta aplicar la migración 202612020001_followup_state_catalog.sql.");
    throw new Error("FOLLOWUP_STATE_SAVE_FAILED");
  }
  return data as StateDefinition;
}

export type ResolvedCustomClassification = { canonical: ReplyClass; definition: StateDefinition };

export async function resolveCustomClassification(key: string): Promise<ResolvedCustomClassification | null> {
  if (!CUSTOM.test(key)) return null;
  const { data, error } = await adminClient().from("followup_state_catalog").select(COLS)
    .eq("key", key).is("removed_at", null).eq("active", true).maybeSingle();
  if (error) throw new Error("FOLLOWUP_STATE_READ_FAILED");
  const definition = data as StateDefinition | null;
  if (!definition?.maps_to || !isReplyClass(definition.maps_to) || !(definition.maps_to in SITUATIONS)) return null;
  return { canonical: definition.maps_to, definition };
}

/** Classifier documentation for the extension. Closed states always remain no-contact. */
export const canonicalClassifierOptions = () =>
  Object.entries(REPLY_CLASSES).map(([key, label]) => ({
    key, label, permanent_stop: key !== "rechazo" && CLOSED_SITUATIONS.includes(key as Situation),
  }));

export async function readSituationOverrides() {
  const { data, error } = await adminClient().from("followup_stage_situation_overrides").select("commercial_stage,key,label,description,examples,removed,enabled");
  if (error) throw new Error("FOLLOWUP_OVERRIDES_READ_FAILED");
  return data ?? [];
}

export async function changeBaseSituation(input: Record<string, unknown>, removed: boolean) {
  const key = input.key;
  const stage = input.commercial_stage;
  if (!isSituation(key) || typeof stage !== "string") throw new HttpError(400, "Situación o etapa inválida.");
  const label = removed ? SITUATIONS[key] : String(input.label ?? "").trim();
  const description = String(input.description ?? "").trim();
  const examples = String(input.examples ?? "").trim();
  if (label.length < 2 || label.length > 80 || description.length > 800 || examples.length > 2000)
    throw new HttpError(400, "Revisá el nombre y la longitud de los campos.");
  const { error } = await adminClient().from("followup_stage_situation_overrides")
    .upsert({ key, commercial_stage: stage, label, description, examples, removed }, { onConflict: "commercial_stage,key" });
  if (error) throw new Error("FOLLOWUP_OVERRIDE_SAVE_FAILED");
  return { key };
}

export async function removeCustomSituation(input: Record<string, unknown>) {
  if (typeof input.key !== "string" || !CUSTOM.test(input.key) || typeof input.commercial_stage !== "string")
    throw new HttpError(400, "Situación inválida.");
  const { error } = await adminClient().from("followup_state_catalog").update({ active: false, removed_at: new Date().toISOString() })
    .eq("key", input.key).eq("commercial_stage", input.commercial_stage);
  if (error) throw new Error("FOLLOWUP_STATE_DELETE_FAILED");
  return { key: input.key };
}

export async function toggleSituation(input: Record<string, unknown>) {
  const { commercial_stage: stage, key, enabled } = input;
  if (typeof stage !== "string" || typeof key !== "string" || typeof enabled !== "boolean")
    throw new HttpError(400, "Etapa, situación o valor inválido.");
  const db = adminClient();
  if (isSituation(key)) {
    const { error } = await db.rpc("habita_toggle_base_situation", { p_stage: stage, p_key: key, p_label: SITUATIONS[key], p_enabled: enabled });
    if (error) throw new Error("FOLLOWUP_TOGGLE_FAILED");
  } else {
    const { data, error } = await db.from("followup_state_catalog").update({ active: enabled, updated_at: new Date().toISOString() })
      .eq("key", key).eq("commercial_stage", stage).is("removed_at", null).select("key").maybeSingle();
    if (error?.code === "23514") throw new HttpError(400, "Editá la situación y elegí primero a qué respuesta corresponde.");
    if (error || !data) throw new HttpError(400, "No se pudo actualizar la situación.");
  }
  return { enabled };
}

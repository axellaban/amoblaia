import "server-only";
import { HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { COMMERCIAL_STAGES, type CommercialStageKey } from "./stages";
import { CLOSED_SITUATIONS, REPLY_CLASSES, SITUATIONS, isReplyClass, type ReplyClass, type Situation } from "./plan";

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
  commercial_stage: CommercialStageKey;
  source: "whatsapp" | "manual";
  maps_to: ReplyClass | null;
  active: boolean;
  updated_at: string;
};

const COLS = "key,label,description,examples,commercial_stage,source,maps_to,active,updated_at";
const VALID_STAGE = COMMERCIAL_STAGES.filter((s) => s.key !== "cliente").map((s) => s.key);
const CUSTOM = /^custom_[a-z0-9_]{3,60}$/;

export async function readStateCatalog(): Promise<StateDefinition[]> {
  const { data, error } = await adminClient().from("followup_state_catalog").select(COLS).order("created_at", { ascending: true }).limit(300);
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
  if (!VALID_STAGE.includes(commercial_stage as CommercialStageKey)) throw new HttpError(400, "Etapa comercial desconocida.");
  if (!["whatsapp", "manual"].includes(source)) throw new HttpError(400, "Origen de clasificación desconocido.");
  if (description.length > 800 || examples.length > 2000) throw new HttpError(400, "La descripción o los ejemplos son demasiado largos.");
  if (maps_to && (!isReplyClass(maps_to) || !(maps_to in SITUATIONS))) throw new HttpError(400, "La situación elegida no se puede usar para clasificar respuestas.");
  // Closed situations are allowed only as closed: never create an automated outbound rule.
  if (active && !maps_to) throw new HttpError(400, "Para activar el estado, elegí la situación canónica a la que corresponde.");
  const { data, error } = await adminClient().from("followup_state_catalog")
    .upsert({ key, label, commercial_stage, description, examples, source, maps_to, active, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "key" })
    .select(COLS).single();
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
    .eq("key", key).eq("active", true).maybeSingle();
  if (error) throw new Error("FOLLOWUP_STATE_READ_FAILED");
  const definition = data as StateDefinition | null;
  if (!definition?.maps_to || !isReplyClass(definition.maps_to) || !(definition.maps_to in SITUATIONS)) return null;
  return { canonical: definition.maps_to, definition };
}

/** Classifier documentation for the extension. Closed states always remain no-contact. */
export const canonicalClassifierOptions = () =>
  Object.entries(REPLY_CLASSES).map(([key, label]) => ({
    key, label, permanent_stop: CLOSED_SITUATIONS.includes(key as Situation),
  }));

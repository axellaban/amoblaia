import "server-only";
import { incrementalTable } from "@/lib/supabase/incremental";
import type { ScoreRow } from "@/lib/leads/rollup";
import type { Stage as ProspectStage } from "@/lib/prospecting/types";

/**
 * Las tablas que la cola de Follow-up, Inmobiliarias y Chapa Labs leen enteras en cada recarga,
 * leídas de forma incremental (ver lib/supabase/incremental.ts): la primera vez completas y
 * después solo lo que cambió. Cada una tiene su cursor puesto por la base:
 *  - agencies, prospect_accounts, prospect_contacts: updated_at (trigger touch_updated_at).
 *  - prospect_events: recorded_at (solo inserts: la tabla no admite update ni delete).
 *  - lead_visitor_scores: calculated_at (cada recálculo borra e inserta las filas de su demo).
 *  - followup_agencies: updated_at, con el trigger de 202612200001 (sin él se lee completa).
 * Las columnas son las de los listados: nada de source_data, signals ni explanation, que se
 * piden solo al abrir una inmobiliaria o un lead.
 */

export type AgencyTableRow = {
  id: string; name: string; owner_id: string | null; claimed_at: string | null; created_at: string;
  contact_whatsapp: string | null; website: string | null; contact_name: string | null; updated_at: string;
};
export const agenciesTable = incrementalTable<AgencyTableRow>({
  table: "agencies",
  columns: "id,name,owner_id,claimed_at,created_at,contact_whatsapp,website,contact_name,updated_at",
  cursor: "updated_at",
  key: ["id"],
});

export type AccountTableRow = { id: string; agency_id: string; stage: ProspectStage; created_at: string; address: string | null; updated_at: string };
export const accountsTable = incrementalTable<AccountTableRow>({
  table: "prospect_accounts",
  columns: "id,agency_id,stage,created_at,address,updated_at",
  cursor: "updated_at",
  key: ["id"],
});

export type ContactTableRow = { id: string; account_id: string; channel: string; address: string | null; invalid_at: string | null; updated_at: string };
export const contactsTable = incrementalTable<ContactTableRow>({
  table: "prospect_contacts",
  columns: "id,account_id,channel,address,invalid_at,updated_at",
  cursor: "updated_at",
  key: ["id"],
});

export type EventTableRow = {
  id: string; account_id: string; type: string; occurred_at: string; human: boolean | null; channel: string | null;
  corrects_event_id: string | null; recorded_at: string;
};
export const FUNNEL_EVENT_TYPES = ["sent", "reply", "interest", "correction"];
export const eventsTable = incrementalTable<EventTableRow>({
  table: "prospect_events",
  columns: "id,account_id,type,occurred_at,human,channel,corrects_event_id,recorded_at",
  // occurred_at puede ser del pasado (un envío cargado después): lo que cuenta es cuándo se registró.
  cursor: "recorded_at",
  key: ["id"],
  filter: (q) => q.in("type", FUNNEL_EVENT_TYPES),
});

/** Lo que necesitan los listados de cada visitante: el puntaje y su clase, sin señales ni explicación. */
export const LIGHT_SCORE_FIELDS =
  "demo_id,agency_id,visitor_id,aliases,score,classification,commercial_score,activation_score,last_event_at,attribution_confidence,visitor_type,is_internal,score_data_quality";
export const scoresTable = incrementalTable<ScoreRow & { calculated_at: string }>({
  table: "lead_visitor_scores",
  columns: `${LIGHT_SCORE_FIELDS},calculated_at`,
  cursor: "calculated_at",
  key: ["demo_id", "visitor_id"],
});
/** Filas livianas completas para el tipo ScoreRow (las señales y la explicación quedan vacías). */
export const lightScore = (r: Partial<ScoreRow>): ScoreRow => ({ ...r, signals: r.signals ?? [], explanation: r.explanation ?? "" }) as ScoreRow;

/** Después de una escritura: ninguna lectura nueva se suma a una que empezó antes. */
export function touchCommercialTables() {
  for (const t of [agenciesTable, accountsTable, contactsTable, eventsTable, scoresTable]) t.touch();
}

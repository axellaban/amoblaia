import "server-only";
import { randomInt } from "node:crypto";
import { HttpError } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { panelLinkPath, SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from "./demo-invite";
import type { AgencyAccount } from "./server";

// The agency's fixed link to its panel (agency_panel_links): the team copies
// it from «Enlaces de esta inmobiliaria» and it is always the same, until the
// team changes it. Holding it lets someone look around the panel as a guest
// (read only) and, while the agency has no owner, create its account.

const MISSING = "Para el enlace fijo al panel falta aplicar la migración 202611240001_agency_panel_links.sql en Supabase.";
const AGENCY_FIELDS = "id,name,website,slug,owner_id,site_published";
/** Same alphabet as the demos' short links (admin.ts newShortCode; not imported, to keep visit.ts free of cycles). */
const newShortCode = () => Array.from({ length: SHORT_CODE_LENGTH }, () => SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)]).join("");
const CODE = new RegExp(`^[2-9a-hjkmnp-z]{${SHORT_CODE_LENGTH}}$`);

/** The table is missing (PostgREST's schema cache or Postgres itself). */
const missingTable = (error: { code?: string; message?: string }) =>
  error.code === "PGRST205" || error.code === "42P01" || /agency_panel_links/.test(error.message ?? "");

async function agencyName(agencyId: string) {
  const { data, error } = await adminClient().from("agencies").select("name").eq("id", agencyId).maybeSingle();
  if (error) throw new Error("PANEL_LINK_AGENCY_LOOKUP_FAILED");
  if (!data) throw new HttpError(404, "No encontramos la inmobiliaria.");
  return (data as { name: string }).name;
}

/**
 * The agency's link, created the first time it is asked for. `rotate` gives
 * it a new code: the previous link stops working at once. Audited.
 */
export async function agencyPanelLink(agencyId: string, actorId: string, origin: string, rotate = false) {
  if (!isUuid(agencyId)) throw new HttpError(404, "No encontramos la inmobiliaria.");
  const name = await agencyName(agencyId);
  const db = adminClient();
  const found = await db.from("agency_panel_links").select("code").eq("agency_id", agencyId).maybeSingle();
  if (found.error) throw missingTable(found.error) ? new HttpError(409, MISSING) : new Error("PANEL_LINK_LOOKUP_FAILED");
  let code = (found.data as { code: string } | null)?.code ?? null;
  if (!code || rotate) {
    // A collision with another agency's code is astronomically rare; one retry covers it.
    for (let attempt = 0; attempt < 2; attempt++) {
      const next = newShortCode();
      const saved = code
        ? await db.from("agency_panel_links").update({ code: next, rotated_at: new Date().toISOString() }).eq("agency_id", agencyId)
        : await db.from("agency_panel_links").insert({ agency_id: agencyId, code: next, created_by: actorId });
      if (!saved.error) {
        await db.from("admin_audit").insert({ actor_id: actorId, action: code ? "agency_panel_link_rotate" : "agency_panel_link", subject_id: agencyId, details: {} });
        code = next;
        break;
      }
      if (attempt === 1 || saved.error.code !== "23505") throw new Error("PANEL_LINK_SAVE_FAILED");
    }
  }
  return { url: `${origin}${panelLinkPath(name, code!)}`, path: panelLinkPath(name, code!) };
}

export type PanelLinkAgency = { agency: AgencyAccount; createdBy: string | null };

/** The agency a fixed link's code opens, or null (unknown code, changed link or no migration yet). */
export async function panelLinkAgency(code: string): Promise<PanelLinkAgency | null> {
  if (!CODE.test(code)) return null;
  const { data, error } = await adminClient()
    .from("agency_panel_links")
    .select(`created_by,agencies(${AGENCY_FIELDS})`)
    .eq("code", code)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return null;
    throw new Error("PANEL_LINK_LOOKUP_FAILED");
  }
  const row = data as unknown as { created_by: string | null; agencies: AgencyAccount | null } | null;
  return row?.agencies ? { agency: row.agencies, createdBy: row.created_by } : null;
}

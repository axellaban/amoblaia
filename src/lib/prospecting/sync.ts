import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "@/lib/commerce/http";
import { buildRows, guessMapping, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsv, preview, type LegacyChannel, type Mapping, type PreviewRow } from "./import";
import { existingAgencies, prospectRpc } from "./server";

/** The rows of a preview as the import function receives them. Links to existing agencies are never sent from here. */
export function importRows(rows: PreviewRow[], links: Record<string, unknown> = {}) {
  return rows
    .filter((r) => r.action !== "error")
    .map((r) => {
      const link = links[r.source_key];
      const agency_id = r.action === "create" && typeof link === "string" && link === r.suggestion?.agencyId ? link : null;
      return {
        row_number: r.row_number,
        source_key: r.source_key,
        name: r.name,
        website: r.website,
        sdr: r.sdr,
        campaign: r.campaign,
        priority: r.priority,
        score: r.score,
        score_components: r.score_components,
        zone: r.zone,
        address: r.address,
        decision_maker: r.decision_maker,
        notes: r.notes,
        legacy_status: r.legacy_status,
        sent_date: r.sent_date,
        contacts: r.contacts,
        raw: r.raw,
        agency_id,
        messages: [...r.messages, ...r.duplicates],
      };
    });
}

/**
 * The automatic sync applies updates to rows it already knows, and new rows
 * with no possible match to an existing agency. A new row that looks like an
 * existing agency is held for the team, since linking or merging is their decision.
 */
export function splitForSync(rows: PreviewRow[]) {
  const apply: PreviewRow[] = [];
  const held: PreviewRow[] = [];
  for (const r of rows) {
    if (r.action === "error") continue;
    if (r.action === "create" && r.suggestion) held.push(r);
    else apply.push(r);
  }
  return { apply, held };
}

/**
 * Applies the sheet as an import without a person in the session. Each run
 * gets its own import id, and the database updates existing rows by source
 * key, so repeating a run changes nothing that is already there.
 */
export async function runSheetSync(input: { actor: string; csv: string; source: string; legacyChannel: LegacyChannel }) {
  if (Buffer.byteLength(input.csv) > MAX_IMPORT_BYTES) throw new HttpError(413, "El archivo supera 2 MB.");
  const parsed = parseCsv(input.csv);
  if (!parsed.headers.length || !parsed.rows.length) throw new HttpError(400, "El archivo no tiene filas.");
  if (parsed.rows.length > MAX_IMPORT_ROWS) throw new HttpError(413, `El archivo tiene más de ${MAX_IMPORT_ROWS} filas.`);
  const mapping: Mapping = guessMapping(parsed.headers);
  if (!mapping.name) throw new HttpError(400, "La pestaña no tiene columna de nombre.");
  const rows = preview(buildRows(parsed, mapping), input.source, await existingAgencies());
  const { apply, held } = splitForSync(rows);
  const report = await prospectRpc<Record<string, unknown>>("habita_prospect_import", {
    p_actor: input.actor,
    p_import: randomUUID(),
    p_source: input.source,
    p_file_name: "sincronizacion automatica",
    p_file_hash: createHash("sha256").update(input.csv).digest("hex"),
    p_mapping: mapping,
    p_rows: importRows(apply),
    p_overwrite: false,
    p_legacy_channel: input.legacyChannel,
  });
  return {
    ...report,
    held: held.map((r) => ({ row: r.row_number, name: r.name, reason: r.suggestion?.reason ?? null, agencyName: r.suggestion?.name ?? null })),
    rejected: rows.filter((r) => r.action === "error").map((r) => ({ row: r.row_number, error: r.error })),
  };
}

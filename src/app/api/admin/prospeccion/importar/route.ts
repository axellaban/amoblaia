import { createHash } from "node:crypto";
import { HttpError, requireAdmin } from "@/lib/commerce/http";
import { isUuid } from "@/lib/demos/shared";
import { buildRows, guessMapping, IMPORT_FIELDS, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsv, preview, type Mapping } from "@/lib/prospecting/import";
import { body, existingAgencies, NO_STORE, prospectFailure, prospectRpc, text } from "@/lib/prospecting/server";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Import of the sheet (CSV per tab). mode "preview" writes nothing: it
 * returns the detected mapping, each row with its action, duplicate
 * candidates and messages. mode "apply" re-parses the same file on the
 * server with the reviewed mapping and links, and applies it in one
 * transaction, idempotent by importId and by (source, row key).
 */
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const b = await body(request);
    if (typeof b.csv !== "string" || !b.csv.trim()) throw new HttpError(400, "Elegí un archivo CSV.");
    if (Buffer.byteLength(b.csv) > MAX_IMPORT_BYTES) throw new HttpError(413, "El archivo supera 2 MB: dividilo por pestaña.");
    const source = text(b.source, 80);
    if (!source) throw new HttpError(400, "Indicá el origen (por ejemplo, el nombre de la planilla y la pestaña).");
    const parsed = parseCsv(b.csv);
    if (!parsed.headers.length || !parsed.rows.length) throw new HttpError(400, "El archivo no tiene filas.");
    if (parsed.rows.length > MAX_IMPORT_ROWS) throw new HttpError(413, `El archivo tiene más de ${MAX_IMPORT_ROWS} filas.`);
    let mapping: Mapping = guessMapping(parsed.headers);
    if (b.mapping && typeof b.mapping === "object" && !Array.isArray(b.mapping)) {
      mapping = {};
      for (const [field, header] of Object.entries(b.mapping as Record<string, unknown>))
        if (field in IMPORT_FIELDS && typeof header === "string" && parsed.headers.includes(header)) mapping[field as keyof Mapping] = header;
    }
    if (!mapping.name) throw new HttpError(400, "Elegí qué columna tiene el nombre de la inmobiliaria.");
    const rows = preview(buildRows(parsed, mapping), source, await existingAgencies());
    if (b.mode !== "apply")
      return Response.json(
        {
          headers: parsed.headers,
          mapping,
          unmapped: parsed.headers.filter((h) => !Object.values(mapping).includes(h)),
          rows,
          totals: {
            rows: rows.length,
            create: rows.filter((r) => r.action === "create").length,
            update: rows.filter((r) => r.action === "update").length,
            errors: rows.filter((r) => r.action === "error").length,
            duplicates: rows.filter((r) => r.duplicates.length).length,
            suggestions: rows.filter((r) => r.suggestion).length,
            legacySends: rows.filter((r) => r.legacy_status === "sent" && r.sent_date).length,
          },
        },
        { headers: NO_STORE },
      );
    if (!isUuid(b.importId)) throw new HttpError(400, "Falta la clave de la importación.");
    // Links to existing agencies are the team's decision from the preview, never automatic.
    const links = (b.links && typeof b.links === "object" ? b.links : {}) as Record<string, unknown>;
    const apply = rows
      .filter((r) => r.action !== "error")
      .map((r) => {
        const link = links[r.source_key];
        const agency_id = r.action === "create" && isUuid(link) && link === r.suggestion?.agencyId ? link : null;
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
    const report = await prospectRpc<Record<string, unknown>>("habita_prospect_import", {
      p_actor: actor.id,
      p_import: b.importId,
      p_source: source,
      p_file_name: text(b.fileName, 200),
      p_file_hash: createHash("sha256").update(b.csv).digest("hex"),
      p_mapping: mapping,
      p_rows: apply,
      p_overwrite: b.overwrite === true,
    });
    const errors = rows.filter((r) => r.action === "error").map((r) => ({ row: r.row_number, error: r.error }));
    return Response.json({ ...report, rejected: errors }, { headers: NO_STORE });
  } catch (e) {
    return prospectFailure(e);
  }
}

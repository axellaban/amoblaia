"use client";

import { useState } from "react";
import { IMPORT_FIELDS, LEGACY_CHANNELS, type ImportField, type LegacyChannel, type Mapping, type PreviewRow } from "@/lib/prospecting/import";
import { formatWhen } from "@/lib/prospecting/time";
import type { Dataset } from "@/lib/prospecting/types";
import { ErrorNote, Pill, api, useOperationKey } from "./shared";

type Preview = {
  headers: string[];
  mapping: Mapping;
  unmapped: string[];
  rows: PreviewRow[];
  totals: Record<"rows" | "create" | "update" | "errors" | "duplicates" | "suggestions" | "legacySends", number>;
};
type Report = Record<string, unknown> & { rejected: { row: number; error: string }[] };

/**
 * CSV import with preview, explicit mapping, reviewable matches and a report.
 * Nothing is written until "Aplicar". Re-importing the same sheet updates the
 * same accounts (by source and row key) and never duplicates them.
 */
export function ImportPanel({ onDone, lastImport }: { onDone: () => Promise<void>; lastImport: Dataset["last_import"] }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [source, setSource] = useState("");
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [overwrite, setOverwrite] = useState(false);
  const [legacyChannel, setLegacyChannel] = useState<LegacyChannel>("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [importId, resetImportId] = useOperationKey();

  async function load(file: File | undefined) {
    setPreview(null);
    setReport(null);
    setMapping(null);
    setError("");
    if (!file) return;
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setError("Exportá cada pestaña de la planilla como CSV (Archivo → Descargar → CSV) y elegí ese archivo.");
      return;
    }
    if (file.size > 2_000_000) {
      setError("El archivo supera 2 MB: dividilo por pestaña.");
      return;
    }
    setCsv(await file.text());
    setFileName(file.name);
    if (!source) setSource(file.name.replace(/\.(csv|tsv|txt)$/i, ""));
    resetImportId();
  }
  async function run(mode: "preview" | "apply") {
    setBusy(true);
    setError("");
    try {
      if (mode === "preview") {
        const p = await api<Preview>("/api/admin/prospeccion/importar", { method: "POST", body: JSON.stringify({ csv, source, mapping, mode }) });
        setPreview(p);
        setMapping(p.mapping);
        // Matches are proposed, not accepted: the team ticks each one.
        setLinks({});
      } else {
        setReport(await api<Report>("/api/admin/prospeccion/importar", { method: "POST", body: JSON.stringify({ csv, source, mapping, mode, links, overwrite, legacyChannel, importId, fileName }) }));
        await onDone();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos procesar el archivo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pr-panel pr-form" aria-labelledby="pr-import-title">
      <h3 id="pr-import-title">Importar planilla (CSV)</h3>
      <p className="pr-caption">
        Una pestaña por archivo. Se conservan todas las columnas y notas originales, el score y sus componentes tal cual. «Enviado» con fecha se registra como envío
        histórico con precisión de día y canal/variante desconocidos; «Número incorrecto» invalida ese número, no la cuenta. Nada se escribe hasta aplicar.
        {lastImport && ` Última importación: ${lastImport.source} el ${formatWhen(lastImport.applied_at)}.`}
      </p>
      <div className="pr-form-row">
        <label>
          <span>Archivo CSV</span>
          <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => void load(e.target.files?.[0])} data-testid="import-file" />
        </label>
        <label>
          <span>Origen (planilla y pestaña)</span>
          <input value={source} maxLength={80} onChange={(e) => setSource(e.target.value)} placeholder="Planilla prospección · Mar del Plata" data-testid="import-source" />
        </label>
      </div>
      <p className="pr-caption">Reimportar con el mismo origen actualiza las mismas cuentas. Con otro origen, se tratan como filas nuevas.</p>
      <ErrorNote error={error} />
      <button type="button" className="button button-small" disabled={!csv || !source.trim() || busy} onClick={() => void run("preview")} data-testid="import-preview">
        {busy && !preview ? "Leyendo…" : preview ? "Volver a previsualizar con este mapeo" : "Vista previa"}
      </button>

      {preview && mapping && (
        <>
          <h4>Mapeo de columnas</h4>
          <div className="pr-mapping">
            {(Object.keys(IMPORT_FIELDS) as ImportField[]).map((f) => (
              <label key={f}>
                <span>{IMPORT_FIELDS[f]}</span>
                <select value={mapping[f] ?? ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value || undefined })}>
                  <option value="">— sin columna —</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {preview.unmapped.length > 0 && (
            <p className="pr-caption">Columnas sin mapear (se guardan igual en los datos originales de cada fila): {preview.unmapped.join(", ")}. Confirmá a qué corresponden antes de usarlas.</p>
          )}
          <p className="pr-chips">
            <Pill>{preview.totals.rows} filas</Pill>
            <Pill tone="green">{preview.totals.create} nuevas</Pill>
            <Pill>{preview.totals.update} actualizan</Pill>
            <Pill tone="red">{preview.totals.errors} con error</Pill>
            <Pill tone="amber">{preview.totals.duplicates} posibles duplicados</Pill>
            <Pill tone="blue">{preview.totals.suggestions} coincidencias con inmobiliarias existentes</Pill>
            <Pill>{preview.totals.legacySends} envíos históricos</Pill>
          </p>
          <div className="pr-tablewrap">
            <table className="pr-table" data-testid="import-preview-table">
              <thead>
                <tr>
                  <th scope="col">Fila</th>
                  <th scope="col">Inmobiliaria</th>
                  <th scope="col">Acción</th>
                  <th scope="col">Score</th>
                  <th scope="col">Contactos</th>
                  <th scope="col">Estado histórico</th>
                  <th scope="col">Revisar</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row_number}>
                    <td>{r.row_number}</td>
                    <td>
                      <strong>{r.name || "—"}</strong>
                      <small>{r.source_key}</small>
                    </td>
                    <td>
                      {r.action === "error" ? <Pill tone="red">Error</Pill> : r.action === "update" ? <Pill>Actualiza</Pill> : <Pill tone="green">Nueva</Pill>}
                      {r.suggestion && (
                        <label className="pr-check">
                          <input
                            type="checkbox"
                            checked={links[r.source_key] === r.suggestion.agencyId}
                            disabled={r.suggestion.hasAccount}
                            onChange={(e) => setLinks({ ...links, [r.source_key]: e.target.checked ? r.suggestion!.agencyId : "" })}
                          />
                          Vincular a «{r.suggestion.name}» ({r.suggestion.reason}){r.suggestion.hasAccount ? " — ya está en la base: revisar a mano" : ""}
                        </label>
                      )}
                    </td>
                    <td>
                      {r.score ?? "—"}
                      <small>{Object.entries(r.score_components).map(([k, v]) => `${k} ${v}`).join(" · ")}</small>
                    </td>
                    <td>
                      {r.contacts.map((c, i) => (
                        <small key={i}>
                          {c.channel}: {c.address ?? c.address_original}
                          {c.invalid ? " (inválido)" : c.verified ? " (verificado en la planilla)" : c.needs_review ? " (revisar)" : ""}
                        </small>
                      ))}
                    </td>
                    <td>
                      {r.legacy_status ?? "—"}
                      {r.sent_date && <small>{r.sent_date.split("-").reverse().join("/")} · sin hora</small>}
                    </td>
                    <td>
                      {[r.error, ...r.duplicates, ...r.messages].filter(Boolean).map((m, i) => (
                        <small key={i}>{m}</small>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.totals.legacySends > 0 && (
            <label>
              <span>Canal de los {preview.totals.legacySends} envíos históricos (la variante queda desconocida)</span>
              <select value={legacyChannel} onChange={(e) => setLegacyChannel(e.target.value as LegacyChannel)} data-testid="import-legacy-channel">
                {(Object.keys(LEGACY_CHANNELS) as LegacyChannel[]).map((c) => (
                  <option key={c} value={c}>
                    {LEGACY_CHANNELS[c]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="pr-check">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            En cuentas existentes, reemplazar también SDR y campaña con los de la planilla (por defecto se conservan los del equipo). Historial y próximas acciones nunca se pisan.
          </label>
          <button type="button" className="button button-small" disabled={busy || !!report} onClick={() => void run("apply")} data-testid="import-apply">
            {busy ? "Aplicando…" : `Aplicar ${preview.totals.rows - preview.totals.errors} filas`}
          </button>
        </>
      )}
      {report && (
        <div className="pr-banner" role="status" data-testid="import-report">
          <strong>{report.replayed ? "Esta importación ya estaba aplicada." : "Importación aplicada."}</strong> {String(report.created)} creadas · {String(report.updated)} actualizadas ·{" "}
          {String(report.unchanged)} sin cambios · {String(report.conflicts)} en conflicto · {String(report.legacy_sends)} envíos históricos ·{" "}
          {report.rejected.length} filas rechazadas
          {report.rejected.map((r) => (
            <small key={r.row}>
              Fila {r.row}: {r.error}
            </small>
          ))}
        </div>
      )}
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import { index, today } from "@/lib/prospecting/metrics";
import { formatWhen } from "@/lib/prospecting/time";
import { CHANNEL_LABEL, STAGE_LABEL, STEP_LABEL, type Dataset, type ProspectAccount, type Stage } from "@/lib/prospecting/types";
import { ImportPanel } from "./import";
import { ErrorNote, Pill, api } from "./shared";

/** The operational base: search, filters, "Para hoy" and the account sheet. */
export function AccountsView({ ds, onOpen, onChanged }: { ds: Dataset; onOpen: (id: string) => void; onChanged: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [sdr, setSdr] = useState("");
  const [mode, setMode] = useState<"all" | "today">("all");
  const [panel, setPanel] = useState<"" | "import" | "add">("");
  const idx = useMemo(() => index(ds), [ds]);
  const todayItems = useMemo(() => today(ds, { sdr: sdr || null }), [ds, sdr]);
  const sdrs = [...new Set(ds.accounts.map((a) => a.sdr).filter((v): v is string => !!v))].sort();
  const needle = q.trim().toLowerCase();
  const match = (a: ProspectAccount) =>
    (!needle || a.name.toLowerCase().includes(needle) || (a.zone ?? "").toLowerCase().includes(needle) || a.contacts.some((c) => (c.address ?? "").toLowerCase().includes(needle))) &&
    (!stage || a.stage === stage) &&
    (!sdr || a.sdr === sdr);
  const rows: { account: ProspectAccount; reason?: string }[] =
    mode === "today"
      ? todayItems.filter((i) => match(i.account)).map((i) => ({ account: i.account, reason: i.reason }))
      : ds.accounts
          .filter(match)
          .sort((x, y) => (y.score ?? -1) - (x.score ?? -1) || x.name.localeCompare(y.name))
          .map((account) => ({ account }));
  const live = new Map(ds.attempts.filter((a) => ["prepared", "opened", "uncertain"].includes(a.status)).map((a) => [a.account_id, a]));

  return (
    <div>
      <div className="pr-top">
        <div>
          <h2>Base de prospección</h2>
          <p className="pr-caption">Conserva el criterio del sheet y suma historial, variantes y próximas acciones.</p>
        </div>
        <div className="pr-actions">
          <button type="button" className="button button-small button-outline" onClick={() => setPanel(panel === "add" ? "" : "add")} aria-expanded={panel === "add"}>
            Agregar inmobiliaria
          </button>
          <button type="button" className="button button-small button-outline" onClick={() => setPanel(panel === "import" ? "" : "import")} aria-expanded={panel === "import"} data-testid="open-import">
            Importar planilla
          </button>
        </div>
      </div>
      {panel === "add" && <AddAccount
          onDone={async (id) => {
            setPanel("");
            await onChanged();
            if (id) onOpen(id);
          }}
        />}
      {panel === "import" && <ImportPanel onDone={onChanged} lastImport={ds.last_import} />}
      <div className="pr-filters" role="search">
        <label>
          <span>Buscar</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Inmobiliaria, zona o contacto…" aria-label="Buscar inmobiliaria" data-testid="accounts-search" />
        </label>
        <label>
          <span>Estado comercial</span>
          <select value={stage} onChange={(e) => setStage(e.target.value)} data-testid="accounts-stage">
            <option value="">Todos los estados</option>
            {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>SDR</span>
          <select value={sdr} onChange={(e) => setSdr(e.target.value)} data-testid="accounts-sdr">
            <option value="">Todos los SDR</option>
            {sdrs.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <div className="pr-segment" role="radiogroup" aria-label="Vista">
          <button type="button" role="radio" aria-checked={mode === "all"} onClick={() => setMode("all")}>
            Todas ({ds.accounts.length})
          </button>
          <button type="button" role="radio" aria-checked={mode === "today"} onClick={() => setMode("today")} data-testid="accounts-today">
            Para hoy ({todayItems.length})
          </button>
        </div>
      </div>
      <div className="pr-panel">
        <div className="pr-tablewrap">
          <table className="pr-table" data-testid="accounts-table">
            <caption className="sr-only">Cuentas de la base de prospección</caption>
            <thead>
              <tr>
                <th scope="col">Prioridad / Score</th>
                <th scope="col">Inmobiliaria / SDR</th>
                <th scope="col">Decisor / Contacto</th>
                <th scope="col">Estado</th>
                <th scope="col">Último envío</th>
                <th scope="col">Próxima acción</th>
                <th scope="col">
                  <span className="sr-only">Ficha</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ account: a, reason }) => {
                const sends = idx.sends.get(a.id) ?? [];
                const last = sends[sends.length - 1];
                const contact = a.contacts.find((c) => c.is_primary && !c.invalid) ?? a.contacts.find((c) => !c.invalid && c.address);
                const attempt = live.get(a.id);
                return (
                  <tr key={a.id} data-account-id={a.id}>
                    <td>
                      <strong>{a.score ?? "—"}</strong>
                      <small>{a.priority ? `Prioridad ${a.priority}` : "Sin prioridad"}</small>
                    </td>
                    <td>
                      <strong>{a.name}</strong>
                      <small>
                        SDR: {a.sdr ?? "sin asignar"}
                        {a.zone ? ` · ${a.zone}` : ""}
                      </small>
                    </td>
                    <td>
                      {a.decision_maker ?? "Decisor por confirmar"}
                      <small>
                        {contact
                          ? `${CHANNEL_LABEL[contact.channel]}${contact.verified ? " verificado" : contact.needs_review ? " por revisar" : ""}${contact.confidence ? ` · confianza ${contact.confidence}` : ""}`
                          : a.contacts.some((c) => c.invalid)
                            ? "Contacto inválido"
                            : "Sin contacto"}
                      </small>
                    </td>
                    <td>
                      <Pill tone={a.stage === "interested" || a.stage === "conversation" ? "blue" : a.stage === "lost" ? "red" : undefined}>{STAGE_LABEL[a.stage]}</Pill>
                      {a.suppressed && <Pill tone="red">Baja</Pill>}
                      {attempt && <Pill tone={attempt.status === "uncertain" ? "red" : "amber"}>{attempt.status === "uncertain" ? "Incierto" : "Intento abierto"}</Pill>}
                    </td>
                    <td>
                      {last ? (
                        <>
                          {CHANNEL_LABEL[last.channel]} · {STEP_LABEL[last.step]} · {last.variant_label ?? "variante desconocida"}
                          <small>{formatWhen(last.sent_at, last.sent_precision ?? "time")}</small>
                        </>
                      ) : (
                        "Sin envío confirmado"
                      )}
                    </td>
                    <td>
                      {reason ? <strong className="pr-reason">{reason}</strong> : (a.next_action ?? "—")}
                      <small>{a.due_at ? `${a.due_at && Date.parse(a.due_at) < Date.parse(ds.now) ? "Vencido · " : ""}${formatWhen(a.due_at, a.due_precision)}` : "Sin fecha"}</small>
                    </td>
                    <td>
                      <button type="button" className="button button-small button-outline" onClick={() => onOpen(a.id)} aria-label={`Ver ficha de ${a.name}`} data-testid="open-account">
                        Ver ficha
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="pr-zero">
                    {ds.accounts.length
                      ? mode === "today"
                        ? "Nada para hoy con estos filtros: no hay vencidos, respuestas pendientes ni cuentas nuevas con contacto usable."
                        : "Sin cuentas con estos filtros."
                      : "Todavía no hay cuentas. Importá la planilla o agregá una inmobiliaria."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="pr-foot">
          «Para hoy» ordena: resultados inciertos, compromisos vencidos, respuestas sin contestar, acciones de hoy y luego cuentas sin envíos por score. Estados de contacto
          separados de la calidad del número. Web, Instagram, Argenprop, teléfonos alternativos y notas completas viven en la ficha.
        </p>
      </div>
    </div>
  );
}

function AddAccount({ onDone }: { onDone: (id: string | null) => Promise<void> | void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [sdr, setSdr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string }>("/api/admin/prospeccion", { method: "POST", body: JSON.stringify({ name, website, sdr }) });
      await onDone(r.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos agregarla.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="pr-panel pr-form" onSubmit={submit}>
      <h3>Agregar inmobiliaria a la base</h3>
      <p className="pr-caption">Crea la inmobiliaria si no existe. Para sumar una que ya tiene demos, usá «Agregar a la base» desde su ficha en Inmobiliarias o la importación, que propone coincidencias.</p>
      <div className="pr-form-row">
        <label>
          <span>Nombre</span>
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>Web</span>
          <input maxLength={300} value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
        <label>
          <span>SDR</span>
          <input maxLength={80} value={sdr} onChange={(e) => setSdr(e.target.value)} />
        </label>
      </div>
      <ErrorNote error={error} />
      <button type="submit" className="button button-small" disabled={busy}>
        {busy ? "Agregando…" : "Agregar"}
      </button>
    </form>
  );
}

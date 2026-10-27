"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AccountDetail } from "@/lib/prospecting/server";
import { formatWhen } from "@/lib/prospecting/time";
import { ATTEMPT_STATUS_LABEL, CHANNEL_LABEL, STAGE_LABEL, STEP_LABEL, type Channel, type Dataset, type Stage } from "@/lib/prospecting/types";
import { ErrorNote, Pill, api, artInput, fromArtDate, fromArtInput, useOperationKey } from "./shared";

const EVENT_LABEL: Record<string, string> = {
  imported: "Importada desde la planilla",
  sent: "Envío confirmado",
  failed: "Envío fallido",
  bounced: "Rebote",
  invalid_endpoint: "Destino inválido",
  uncertain: "Resultado incierto",
  cancelled: "Intento cancelado",
  reply: "Respuesta humana",
  auto_reply: "Respuesta automática",
  interest: "Interés explícito",
  not_interested: "No le interesa",
  meeting: "Reunión acordada",
  lost: "Cuenta perdida",
  reopened: "Reabierta",
  note: "Nota",
  suppressed: "Baja",
  suppression_lifted: "Baja levantada",
  activated: "Activación (servidor)",
  purchased: "Primera compra (servidor)",
  refunded: "Devolución (servidor)",
  account_updated: "Datos editados",
  score_changed: "Score editado",
  contact_changed: "Contacto editado",
  correction: "Corrección",
};
const CORRECTABLE = new Set(["reply", "auto_reply", "interest", "not_interested", "meeting", "lost", "note"]);
type Ev = { id: string; type: string; occurred_at: string; occurred_precision: "time" | "day"; channel: string | null; evidence: string | null; details: Record<string, unknown>; corrects_event_id: string | null; source: string };
type Contact = AccountDetail["contacts"][number] & Record<string, unknown>;

/** The account sheet: a side panel, so the table keeps its position. Escape closes it. */
export function AccountDrawer({
  id,
  ds,
  version,
  onClose,
  onChanged,
  onPrepare,
}: {
  id: string;
  ds: Dataset;
  version: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onPrepare: (id: string) => void;
}) {
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<"" | "event" | "next" | "suppress" | "contact" | "score">("");
  const [eventType, setEventType] = useState("reply");
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = ds.accounts.find((a) => a.id === id);

  useEffect(() => {
    let active = true;
    api<AccountDetail>(`/api/admin/prospeccion/cuentas/${id}`)
      .then((d) => active && (setDetail(d), setError("")))
      .catch((e) => active && setError(e instanceof Error ? e.message : "No pudimos cargar la ficha."));
    return () => {
      active = false;
    };
  }, [id, version]);
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const a = detail?.account as (Record<string, unknown> & { version: number; stage: Stage; score_components: Record<string, unknown> }) | undefined;
  const done = async () => {
    setForm("");
    await onChanged();
  };
  const corrected = new Set((detail?.events as Ev[] | undefined)?.map((e) => e.corrects_event_id).filter(Boolean));
  const active = (detail?.suppressions ?? []).filter((s) => !(s as { lifted_at: string | null }).lifted_at) as { id: string; scope: string; channel: string | null; reason: string; created_at: string }[];

  return (
    <aside className="pr-drawer" role="dialog" aria-modal="false" aria-labelledby="pr-drawer-title" data-testid="account-drawer" data-account-id={id}>
      <div className="pr-drawer-head">
        <h2 id="pr-drawer-title" tabIndex={-1} ref={heading}>
          {summary?.name ?? detail?.agency?.name ?? "Cuenta"}
        </h2>
        <button type="button" className="button button-small button-outline" onClick={onClose} data-testid="close-account">
          Cerrar ficha
        </button>
      </div>
      <ErrorNote error={error} />
      {!detail && !error && <p className="pr-muted">Cargando ficha…</p>}
      {detail && a && (
        <>
          <p className="pr-chips">
            <Pill tone="blue">{STAGE_LABEL[a.stage]}</Pill>
            {a.lost_reason ? <Pill tone="red">Perdida: {String(a.lost_reason)}</Pill> : null}
            {active.length > 0 && <Pill tone="red">Baja vigente</Pill>}
            <Pill>SDR: {String(a.sdr ?? "sin asignar")}</Pill>
            {a.campaign ? <Pill>Campaña: {String(a.campaign)}</Pill> : null}
          </p>
          <div className="pr-actions">
            <button type="button" className="button button-small" onClick={() => onPrepare(id)} data-testid="prepare-contact">
              Preparar contacto
            </button>
            <button type="button" className="button button-small button-outline" onClick={() => (setEventType("reply"), setForm("event"))} data-testid="register-reply">
              Registrar respuesta
            </button>
            <button type="button" className="button button-small button-outline" onClick={() => (setEventType("interest"), setForm("event"))}>
              Registrar interés u otro hecho
            </button>
            <button type="button" className="button button-small button-outline" onClick={() => setForm("next")}>
              Próxima acción
            </button>
            <button type="button" className="button button-small button-outline" onClick={() => setForm("suppress")} data-testid="suppress">
              Baja
            </button>
          </div>
          {form === "event" && <EventForm key={eventType} accountId={id} initialType={eventType} attempts={detail.attempts as { id: string; status: string; channel: string; step: number; sent_at: string | null }[]} onDone={done} onCancel={() => setForm("")} />}
          {form === "next" && <NextActionForm accountId={id} account={a} onDone={done} onCancel={() => setForm("")} />}
          {form === "suppress" && <SuppressForm accountId={id} contacts={detail.contacts as Contact[]} onDone={done} onCancel={() => setForm("")} />}

          <section className="pr-drawer-section" aria-labelledby="pr-d-next">
            <h3 id="pr-d-next">Próximo movimiento</h3>
            <p>
              {String(a.next_action ?? "Sin próxima acción")} · {a.due_at ? formatWhen(String(a.due_at), a.due_precision as "time" | "day") : "sin fecha"}
            </p>
          </section>

          <section className="pr-drawer-section" aria-labelledby="pr-d-score">
            <div className="pr-top">
              <h3 id="pr-d-score">Score {a.score != null ? String(a.score) : "—"}</h3>
              <button type="button" className="pr-link" onClick={() => setForm(form === "score" ? "" : "score")}>
                Editar score
              </button>
            </div>
            <dl className="pr-score">
              {Object.entries(a.score_components ?? {}).map(([k, v]) => (
                <div key={k}>
                  <dt>{k.replace(/_/g, " ")}</dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
            </dl>
            <p className="pr-key">
              {Object.keys(a.score_components ?? {}).length ? "Componentes tal como vienen de la planilla o de la última edición; no se recalculan." : "Sin componentes cargados."}
              {a.scoring_version ? ` Versión de puntaje: ${String(a.scoring_version)}.` : ""}
            </p>
            {form === "score" && <ScoreForm accountId={id} account={a} onDone={done} onCancel={() => setForm("")} />}
          </section>

          <section className="pr-drawer-section" aria-labelledby="pr-d-contacts">
            <div className="pr-top">
              <h3 id="pr-d-contacts">Contactos comerciales (privados)</h3>
              <button type="button" className="pr-link" onClick={() => setForm(form === "contact" ? "" : "contact")}>
                Agregar contacto
              </button>
            </div>
            <p className="pr-key">Decisor: {String(a.decision_maker ?? "por confirmar")}{a.decision_maker_role ? ` (${String(a.decision_maker_role)})` : ""}. Estos datos nunca se muestran en demos ni en el sitio público.</p>
            {form === "contact" && <ContactForm accountId={id} onDone={done} onCancel={() => setForm("")} />}
            <ul className="pr-list">
              {(detail.contacts as Contact[]).map((c) => (
                <ContactItem key={c.id as string} accountId={id} contact={c} onDone={done} />
              ))}
              {!detail.contacts.length && <li>Sin contactos cargados.</li>}
            </ul>
          </section>

          {active.length > 0 && (
            <section className="pr-drawer-section" aria-labelledby="pr-d-supp">
              <h3 id="pr-d-supp">Bajas vigentes</h3>
              <ul className="pr-list">
                {active.map((s) => (
                  <LiftItem key={s.id} accountId={id} s={s} onDone={done} />
                ))}
              </ul>
            </section>
          )}

          <section className="pr-drawer-section" aria-labelledby="pr-d-demos">
            <div className="pr-top">
              <h3 id="pr-d-demos">Demos y cuenta</h3>
              {detail.agency && (
                <Link className="pr-link" href={`/admin/demos/nueva?inmobiliaria=${detail.agency.id}`}>
                  Crear demo
                </Link>
              )}
            </div>
            <p className="pr-key">
              {detail.agency?.linked
                ? `Cuenta de habita vinculada${detail.agency.claimedAt ? ` (reclamada el ${formatWhen(detail.agency.claimedAt)})` : ""}: activación y compra se leen del servidor.`
                : "Sin cuenta vinculada: activación y compra no se miden (no se infieren por visitas a la demo)."}
            </p>
            <ul className="pr-list">
              {detail.demos.map((d) => (
                <li key={d.id}>
                  <Link href={`/admin/demos/${d.id}`}>{d.title}</Link> · {d.status === "published" ? "publicada" : "borrador"}
                  {d.url && (
                    <small>
                      Enlace público: <a href={d.url} target="_blank" rel="noreferrer">{d.url}</a>
                    </small>
                  )}
                </li>
              ))}
              {!detail.demos.length && <li>Sin demos para esta inmobiliaria.</li>}
              {detail.agency && (
                <li>
                  <Link href={`/admin/inmobiliarias/${detail.agency.id}`}>Ver inmobiliaria</Link>
                </li>
              )}
            </ul>
          </section>

          <section className="pr-drawer-section" aria-labelledby="pr-d-attempts">
            <h3 id="pr-d-attempts">Intentos</h3>
            <ul className="pr-list">
              {(detail.attempts as { id: string; status: keyof typeof ATTEMPT_STATUS_LABEL; channel: keyof typeof CHANNEL_LABEL; step: number; variant_label: string | null; sent_at: string | null; sent_precision: "time" | "day" | null; prepared_at: string; legacy: boolean; status_reason: string | null }[]).map((t) => (
                <li key={t.id} data-attempt-id={t.id}>
                  <strong>{ATTEMPT_STATUS_LABEL[t.status]}</strong> · {CHANNEL_LABEL[t.channel]} · {STEP_LABEL[t.step]} · {t.variant_label ?? "variante desconocida"}
                  <small>
                    {t.sent_at ? `Enviado ${formatWhen(t.sent_at, t.sent_precision ?? "time")}` : `Preparado ${formatWhen(t.prepared_at)}`}
                    {t.legacy ? " · histórico de la planilla" : ""}
                    {t.status_reason ? ` · ${t.status_reason}` : ""}
                  </small>
                </li>
              ))}
              {!detail.attempts.length && <li>Sin intentos.</li>}
            </ul>
          </section>

          <section className="pr-drawer-section" aria-labelledby="pr-d-history">
            <h3 id="pr-d-history">Historial</h3>
            <ol className="pr-timeline">
              {(detail.events as Ev[]).map((e) => (
                <li key={e.id} className={corrected.has(e.id) ? "is-corrected" : ""}>
                  <strong>{EVENT_LABEL[e.type] ?? e.type}</strong>
                  {corrected.has(e.id) && <Pill tone="amber">Corregido</Pill>}
                  <small>
                    {formatWhen(e.occurred_at, e.occurred_precision)}
                    {e.channel ? ` · ${CHANNEL_LABEL[e.channel as keyof typeof CHANNEL_LABEL] ?? e.channel}` : ""}
                    {e.source !== "manual" ? ` · ${e.source === "import" ? "importación" : "servidor"}` : ""}
                  </small>
                  {e.evidence && <small>Evidencia: {e.evidence}</small>}
                  {typeof e.details?.reason === "string" && <small>Motivo: {e.details.reason}</small>}
                  {CORRECTABLE.has(e.type) && !corrected.has(e.id) && <CorrectButton accountId={id} eventId={e.id} onDone={done} />}
                </li>
              ))}
            </ol>
          </section>

          <section className="pr-drawer-section" aria-labelledby="pr-d-notes">
            <h3 id="pr-d-notes">Notas</h3>
            {a.source_notes ? <p className="pr-notes">Planilla: {String(a.source_notes)}</p> : <p className="pr-key">Sin notas de la planilla.</p>}
            <TeamNotes accountId={id} account={a} onDone={done} />
            {!!a.source_data && Object.keys(a.source_data as object).length > 0 && (
              <details>
                <summary>Datos originales de la planilla</summary>
                <dl className="pr-raw">
                  {Object.entries(a.source_data as Record<string, string>).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </section>
        </>
      )}
    </aside>
  );
}

/** Registers what was observed: a reply, interest, a loss… with date, channel and evidence. */
export function EventForm({
  accountId,
  initialType,
  attempts,
  onDone,
  onCancel,
}: {
  accountId: string;
  initialType: string;
  attempts: { id: string; status: string; channel: string; step: number; sent_at: string | null }[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [key, nextKey] = useOperationKey();
  const [type, setType] = useState(initialType);
  const [noTime, setNoTime] = useState(false);
  const [when, setWhen] = useState(artInput());
  const [day, setDay] = useState(artInput().slice(0, 10));
  const lastSent = attempts.find((t) => t.status === "sent");
  const [channel, setChannel] = useState(lastSent?.channel ?? "whatsapp");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsEvidence = type === "reply" || type === "interest";
  const needsReason = type === "lost" || type === "not_interested";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ stopped?: number }>(`/api/admin/prospeccion/cuentas/${accountId}/eventos`, {
        method: "POST",
        body: JSON.stringify({
          key,
          type,
          occurredAt: noTime ? fromArtDate(day) : fromArtInput(when),
          precision: noTime ? "day" : "time",
          channel,
          attemptId: null,
          evidence,
          reason,
        }),
      });
      nextKey();
      if (r.stopped) window.alert(`Se cancelaron ${r.stopped} seguimientos preparados: la secuencia se detuvo por la respuesta.`);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos registrarlo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="pr-subform" onSubmit={submit} data-testid="event-form">
      <div className="pr-form-row">
        <label>
          <span>Qué pasó</span>
          <select value={type} onChange={(e) => setType(e.target.value)} data-testid="event-type">
            <option value="reply">Respondió (persona)</option>
            <option value="auto_reply">Respuesta automática</option>
            <option value="interest">Interés explícito</option>
            <option value="not_interested">No le interesa</option>
            <option value="meeting">Reunión acordada</option>
            <option value="lost">Cuenta perdida</option>
            <option value="reopened">Reabrir cuenta</option>
            <option value="note">Nota</option>
          </select>
        </label>
        <label>
          <span>Canal</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {(["whatsapp", "email", "phone", "instagram", "other"] as Channel[]).map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        {noTime ? (
          <label>
            <span>Día (hora Argentina)</span>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
          </label>
        ) : (
          <label>
            <span>Cuándo (hora Argentina)</span>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          </label>
        )}
      </div>
      <label className="pr-check">
        <input type="checkbox" checked={noTime} onChange={(e) => setNoTime(e.target.checked)} /> No sé la hora (se guarda con precisión de día)
      </label>
      {needsReason && (
        <label>
          <span>Motivo</span>
          <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} required={type === "lost"} />
        </label>
      )}
      <label>
        <span>Evidencia {needsEvidence ? "(obligatoria)" : "(opcional)"}: qué dijo y dónde, sin copiar datos personales de más</span>
        <textarea value={evidence} maxLength={1000} onChange={(e) => setEvidence(e.target.value)} required={needsEvidence} rows={3} data-testid="event-evidence" />
      </label>
      <p className="pr-key">Una respuesta humana detiene los seguimientos pendientes de la secuencia. Abrir la demo o el chat no es una respuesta.</p>
      <ErrorNote error={error} />
      <div className="pr-actions">
        <button type="submit" className="button button-small" disabled={busy} data-testid="event-submit">
          {busy ? "Guardando…" : "Registrar"}
        </button>
        <button type="button" className="button button-small button-outline" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function NextActionForm({ accountId, account, onDone, onCancel }: { accountId: string; account: Record<string, unknown> & { version: number }; onDone: () => Promise<void>; onCancel: () => void }) {
  const [action, setAction] = useState(String(account.next_action ?? ""));
  const [when, setWhen] = useState(account.due_at ? artInput(new Date(String(account.due_at))) : "");
  const [sdr, setSdr] = useState(String(account.sdr ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/prospeccion/cuentas/${accountId}`, {
        method: "PATCH",
        body: JSON.stringify({ version: account.version, next_action: action, due_at: fromArtInput(when), due_precision: "time", sdr }),
      });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardarla.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="pr-subform" onSubmit={submit}>
      <div className="pr-form-row">
        <label>
          <span>Próxima acción</span>
          <input value={action} maxLength={300} onChange={(e) => setAction(e.target.value)} />
        </label>
        <label>
          <span>Fecha (hora Argentina)</span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label>
          <span>SDR</span>
          <input value={sdr} maxLength={80} onChange={(e) => setSdr(e.target.value)} />
        </label>
      </div>
      <ErrorNote error={error} />
      <div className="pr-actions">
        <button type="submit" className="button button-small" disabled={busy}>
          Guardar
        </button>
        <button type="button" className="button button-small button-outline" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ScoreForm({ accountId, account, onDone, onCancel }: { accountId: string; account: Record<string, unknown> & { version: number; score_components: Record<string, unknown> }; onDone: () => Promise<void>; onCancel: () => void }) {
  const [score, setScore] = useState(account.score == null ? "" : String(account.score));
  const [parts, setParts] = useState<Record<string, string>>(Object.fromEntries(Object.entries(account.score_components ?? {}).map(([k, v]) => [k, String(v)])));
  const [scoringVersion, setScoringVersion] = useState(String(account.scoring_version ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const components = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v]));
      await api(`/api/admin/prospeccion/cuentas/${accountId}`, {
        method: "PATCH",
        body: JSON.stringify({ version: account.version, score: score.trim() === "" ? null : Number(score), score_components: components, scoring_version: scoringVersion }),
      });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardarlo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="pr-subform" onSubmit={submit}>
      <p className="pr-key">El cambio queda en el historial con el valor anterior. No se recalcula automáticamente: las reglas de la planilla no están documentadas.</p>
      <div className="pr-form-row">
        <label>
          <span>Score</span>
          <input type="number" step="any" value={score} onChange={(e) => setScore(e.target.value)} />
        </label>
        {Object.keys(parts).map((k) => (
          <label key={k}>
            <span>{k.replace(/_/g, " ")}</span>
            <input value={parts[k]} onChange={(e) => setParts({ ...parts, [k]: e.target.value })} />
          </label>
        ))}
        <label>
          <span>Versión de puntaje</span>
          <input value={scoringVersion} maxLength={80} onChange={(e) => setScoringVersion(e.target.value)} placeholder="planilla-2026-10" />
        </label>
      </div>
      <ErrorNote error={error} />
      <div className="pr-actions">
        <button type="submit" className="button button-small" disabled={busy}>
          Guardar score
        </button>
        <button type="button" className="button button-small button-outline" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function SuppressForm({ accountId, contacts, onDone, onCancel }: { accountId: string; contacts: Contact[]; onDone: () => Promise<void>; onCancel: () => void }) {
  const [scope, setScope] = useState<"account" | "channel" | "contact">("account");
  const [channel, setChannel] = useState("whatsapp");
  const [contactId, setContactId] = useState(String(contacts[0]?.id ?? ""));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/prospeccion/cuentas/${accountId}/bajas`, { method: "POST", body: JSON.stringify({ scope, channel, contactId, reason }) });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos registrar la baja.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="pr-subform" onSubmit={submit} data-testid="suppress-form">
      <div className="pr-form-row">
        <label>
          <span>Alcance</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="account">Toda la cuenta (todos los contactos y canales)</option>
            <option value="channel">Un canal</option>
            <option value="contact">Un contacto</option>
          </select>
        </label>
        {scope === "channel" && (
          <label>
            <span>Canal</span>
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="phone">Teléfono</option>
            </select>
          </label>
        )}
        {scope === "contact" && (
          <label>
            <span>Contacto</span>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              {contacts.map((c) => (
                <option key={c.id as string} value={c.id as string}>
                  {CHANNEL_LABEL[c.channel as Channel]}: {String(c.address ?? c.address_original ?? "—")}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>Motivo</span>
          <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} required />
        </label>
      </div>
      <p className="pr-key">Cancela los intentos preparados que cubre. Un contacto alternativo no levanta una baja de toda la cuenta.</p>
      <ErrorNote error={error} />
      <div className="pr-actions">
        <button type="submit" className="button button-small" disabled={busy}>
          Registrar baja
        </button>
        <button type="button" className="button button-small button-outline" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function LiftItem({ accountId, s, onDone }: { accountId: string; s: { id: string; scope: string; channel: string | null; reason: string; created_at: string }; onDone: () => Promise<void> }) {
  const [error, setError] = useState("");
  async function lift() {
    const reason = window.prompt("¿Por qué se levanta la baja? (por ejemplo: la inmobiliaria volvió a pedir información)");
    if (!reason) return;
    try {
      await api(`/api/admin/prospeccion/cuentas/${accountId}/bajas`, { method: "PATCH", body: JSON.stringify({ suppressionId: s.id, reason }) });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos levantarla.");
    }
  }
  return (
    <li>
      <strong>{s.scope === "account" ? "Toda la cuenta" : s.scope === "channel" ? `Canal ${s.channel}` : "Un contacto"}</strong> · {s.reason}
      <small>Desde {formatWhen(s.created_at)}</small>
      <button type="button" className="pr-link" onClick={lift}>
        Levantar baja
      </button>
      <ErrorNote error={error} />
    </li>
  );
}

function ContactForm({ accountId, onDone, onCancel }: { accountId: string; onDone: () => Promise<void>; onCancel: () => void }) {
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [address, setAddress] = useState("");
  const [person, setPerson] = useState("");
  const [source, setSource] = useState("");
  const [decider, setDecider] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/prospeccion/cuentas/${accountId}/contactos`, {
        method: "POST",
        body: JSON.stringify({ channel, address, person_name: person, source, is_decision_maker: decider, verified }),
      });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardarlo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="pr-subform" onSubmit={submit}>
      <div className="pr-form-row">
        <label>
          <span>Canal</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {(["whatsapp", "email", "phone", "instagram", "web", "other"] as Channel[]).map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{channel === "whatsapp" ? "Número completo (+54 9 …)" : channel === "email" ? "Email" : "Dirección o enlace"}</span>
          <input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} required />
        </label>
        <label>
          <span>Persona</span>
          <input value={person} maxLength={160} onChange={(e) => setPerson(e.target.value)} />
        </label>
        <label>
          <span>Fuente (dónde se obtuvo)</span>
          <input value={source} maxLength={200} onChange={(e) => setSource(e.target.value)} />
        </label>
      </div>
      <label className="pr-check">
        <input type="checkbox" checked={decider} onChange={(e) => setDecider(e.target.checked)} /> Es quien decide
      </label>
      <label className="pr-check">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> Verificado (revisé que es correcto y de esta inmobiliaria)
      </label>
      <ErrorNote error={error} />
      <div className="pr-actions">
        <button type="submit" className="button button-small" disabled={busy}>
          Guardar contacto
        </button>
        <button type="button" className="button button-small button-outline" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ContactItem({ accountId, contact: c, onDone }: { accountId: string; contact: Contact; onDone: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(String(c.address ?? c.address_original ?? ""));
  async function patch(fields: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/prospeccion/cuentas/${accountId}/contactos`, { method: "POST", body: JSON.stringify({ contactId: c.id, currentChannel: c.channel, ...fields }) });
      setEditing(false);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardarlo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li data-contact-id={String(c.id)}>
      <strong>
        {CHANNEL_LABEL[c.channel as Channel]}: {String(c.address ?? c.address_original ?? "—")}
      </strong>
      {c.is_primary ? <Pill>Principal</Pill> : null}
      {c.is_decision_maker ? <Pill>Decisor</Pill> : null}
      {c.invalid_at ? <Pill tone="red">Inválido</Pill> : c.verified_at ? <Pill tone="green">Verificado</Pill> : c.needs_review ? <Pill tone="amber">Por revisar</Pill> : <Pill>Sin verificar</Pill>}
      <small>
        {c.person_name ? `${String(c.person_name)} · ` : ""}Fuente: {String(c.source ?? "sin fuente")}
        {c.confidence ? ` · confianza ${String(c.confidence)}` : ""}
        {c.address_original && c.address_original !== c.address ? ` · original: ${String(c.address_original)}` : ""}
      </small>
      {c.review_reason ? <small>Revisar: {String(c.review_reason)}</small> : null}
      {c.invalid_reason ? <small>Inválido: {String(c.invalid_reason)}</small> : null}
      {editing ? (
        <form
          className="pr-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ address, verified: true });
          }}
        >
          <input value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Dirección corregida" />
          <button type="submit" className="button button-small" disabled={busy}>
            Guardar y verificar
          </button>
        </form>
      ) : (
        <span className="pr-actions">
          {!c.invalid_at && !c.verified_at && (
            <button type="button" className="pr-link" disabled={busy} onClick={() => (c.address ? void patch({ verified: true }) : setEditing(true))} data-testid="verify-contact">
              Verificar
            </button>
          )}
          {!c.invalid_at && (
            <button type="button" className="pr-link" disabled={busy} onClick={() => setEditing(true)}>
              Corregir
            </button>
          )}
          {!c.is_primary && !c.invalid_at && (
            <button type="button" className="pr-link" disabled={busy} onClick={() => void patch({ is_primary: true })}>
              Hacer principal
            </button>
          )}
          {!c.invalid_at ? (
            <button type="button" className="pr-link" disabled={busy} onClick={() => { const r = window.prompt("¿Por qué es inválido? (por ejemplo: número incorrecto)"); if (r) void patch({ invalid: true, invalid_reason: r }); }}>
              Marcar inválido
            </button>
          ) : (
            <button type="button" className="pr-link" disabled={busy} onClick={() => void patch({ invalid: false })}>
              Quitar inválido
            </button>
          )}
        </span>
      )}
      <ErrorNote error={error} />
    </li>
  );
}

function CorrectButton({ accountId, eventId, onDone }: { accountId: string; eventId: string; onDone: () => Promise<void> }) {
  const [key] = useOperationKey();
  async function correct() {
    const reason = window.prompt("¿Qué se corrige? El registro original queda en el historial marcado como corregido.");
    if (!reason) return;
    try {
      await api(`/api/admin/prospeccion/cuentas/${accountId}/eventos`, { method: "POST", body: JSON.stringify({ key, type: "correction", corrects: eventId, reason }) });
      await onDone();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No pudimos corregirlo.");
    }
  }
  return (
    <button type="button" className="pr-link" onClick={correct}>
      Corregir
    </button>
  );
}

function TeamNotes({ accountId, account, onDone }: { accountId: string; account: Record<string, unknown> & { version: number }; onDone: () => Promise<void> }) {
  const [notes, setNotes] = useState(String(account.team_notes ?? ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/prospeccion/cuentas/${accountId}`, { method: "PATCH", body: JSON.stringify({ version: account.version, team_notes: notes }) });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardarlas.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <label>
        <span>Notas del equipo</span>
        <textarea value={notes} maxLength={8000} rows={3} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <ErrorNote error={error} />
      <button type="button" className="button button-small button-outline" disabled={busy || notes === String(account.team_notes ?? "")} onClick={save}>
        Guardar notas
      </button>
    </div>
  );
}

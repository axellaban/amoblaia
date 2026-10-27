"use client";

import { useEffect, useMemo, useState } from "react";
import { index, today } from "@/lib/prospecting/metrics";
import { render, unresolved } from "@/lib/prospecting/render";
import type { AccountDetail } from "@/lib/prospecting/server";
import { formatWhen } from "@/lib/prospecting/time";
import { ATTEMPT_STATUS_LABEL, CHANNEL_LABEL, STEP_LABEL, type Dataset, type OutreachAttempt, type ProspectAccount } from "@/lib/prospecting/types";
import { EventForm } from "./drawer";
import { ErrorNote, Pill, api, artInput, fromArtInput, useOperationKey } from "./shared";

/**
 * The execution queue. Every step is a separate, explicit server call that an
 * operator or the Claude Code browser extension performs in the same
 * authorized session: prepare → review → open channel → confirm (or mark
 * failed / invalid / uncertain). Nothing is sent by loading the page,
 * preparing or opening a channel, and nothing here sends by itself.
 */
export function ExecutionView({
  ds,
  target,
  onTarget,
  onChanged,
  onOpenAccount,
}: {
  ds: Dataset;
  target: string | null;
  onTarget: (id: string | null) => void;
  onChanged: () => Promise<void>;
  onOpenAccount: (id: string) => void;
}) {
  const live = ds.attempts.filter((a) => ["prepared", "opened", "uncertain"].includes(a.status));
  const candidates = useMemo(() => {
    const busy = new Set(ds.attempts.filter((a) => ["prepared", "opened", "uncertain"].includes(a.status)).map((a) => a.account_id));
    return today(ds, {}).filter((i) => !busy.has(i.account.id)).slice(0, 25);
  }, [ds]);
  const byId = new Map(ds.accounts.map((a) => [a.id, a]));
  const account = target ? byId.get(target) : undefined;
  const attempt = target ? live.find((a) => a.account_id === target) : undefined;
  const recent = target ? ds.attempts.filter((a) => a.account_id === target && a.status === "sent").pop() : undefined;

  return (
    <div>
      <div className="pr-top">
        <div>
          <h2>Preparado para operar con Claude Code</h2>
          <p className="pr-caption">La extensión y el operador usan los mismos pasos visibles y verificables, con la sesión del equipo.</p>
        </div>
        <Pill>Sin envío automático · confirmación explícita</Pill>
      </div>
      <div className="pr-execution">
        <section className="pr-panel" aria-labelledby="pr-queue">
          <span className="pr-label" id="pr-queue">
            Cola revisable
          </span>
          {live.length > 0 && <h3 className="pr-queue-title">Intentos abiertos ({live.length})</h3>}
          <ul className="pr-queue" data-testid="queue-open">
            {live.map((a) => {
              const acc = byId.get(a.account_id);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className={`pr-queue-item${target === a.account_id ? " is-active" : ""}`}
                    aria-pressed={target === a.account_id}
                    onClick={() => onTarget(a.account_id)}
                    data-testid="queue-item"
                    data-attempt-id={a.id}
                    data-account-id={a.account_id}
                  >
                    <strong>{acc?.name ?? "Cuenta"}</strong>
                    <small>
                      {a.sender} · {CHANNEL_LABEL[a.channel]} · {STEP_LABEL[a.step]}
                    </small>
                    <small className={a.status === "uncertain" ? "pr-warn" : ""}>{ATTEMPT_STATUS_LABEL[a.status]}</small>
                  </button>
                </li>
              );
            })}
          </ul>
          <h3 className="pr-queue-title">Para preparar ({candidates.length})</h3>
          <ul className="pr-queue" data-testid="queue-candidates">
            {candidates.map((i) => (
              <li key={i.account.id}>
                <button
                  type="button"
                  className={`pr-queue-item${target === i.account.id ? " is-active" : ""}`}
                  aria-pressed={target === i.account.id}
                  onClick={() => onTarget(i.account.id)}
                  data-testid="queue-item"
                  data-account-id={i.account.id}
                >
                  <strong>{i.account.name}</strong>
                  <small>
                    {i.account.sdr ?? "Sin SDR"} · score {i.account.score ?? "—"}
                  </small>
                  <small>{i.reason}</small>
                </button>
              </li>
            ))}
            {!candidates.length && !live.length && <li className="pr-zero">Nada en cola. Elegí una cuenta desde Prospectos → Ver ficha → Preparar contacto.</li>}
          </ul>
          <p className="pr-foot">Cada intento tiene un ID estable. Si un envío queda incierto, se revisa el canal antes de reintentar: nunca se reenvía solo.</p>
        </section>
        <section className="pr-panel" aria-labelledby="pr-exec-title" data-testid="execution-panel" data-account-id={target ?? undefined} data-attempt-id={attempt?.id}>
          {!account && (
            <>
              <h3 id="pr-exec-title">Revisar antes de contactar</h3>
              <p className="pr-muted">Elegí una cuenta de la cola o desde su ficha.</p>
            </>
          )}
          {account && attempt && <AttemptPanel key={`${attempt.id}:${attempt.version}`} attempt={attempt} account={account} onChanged={onChanged} onOpenAccount={onOpenAccount} />}
          {account && !attempt && (
            <PrepareForm
              key={`${account.id}:${account.version}:${ds.attempts.filter((a) => a.account_id === account.id).length}`}
              ds={ds}
              account={account}
              recent={recent}
              onChanged={onChanged}
              onOpenAccount={onOpenAccount}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/** Step 1: choose a reviewed recipient, step and version; the exact text is frozen when prepared. */
function PrepareForm({ ds, account, recent, onChanged, onOpenAccount }: { ds: Dataset; account: ProspectAccount; recent?: OutreachAttempt; onChanged: () => Promise<void>; onOpenAccount: (id: string) => void }) {
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const idx = useMemo(() => index(ds), [ds]);
  const sends = idx.sends.get(account.id) ?? [];
  const replied = (idx.events.get(account.id) ?? []).some((e) => e.type === "reply" && e.human !== false && !e.corrected);
  const usable = account.contacts.filter((c) => (c.channel === "whatsapp" || c.channel === "email") && c.address);
  const ok = (c: (typeof usable)[number]) => !c.invalid && !c.needs_review && !c.blocked;
  const [contactId, setContactId] = useState(usable.find(ok)?.id ?? "");
  const contact = usable.find((c) => c.id === contactId);
  const nextStep = replied ? 0 : Math.min(3, Math.max(0, ...sends.filter((s) => s.step > 0).map((s) => s.step)) + 1);
  const [step, setStep] = useState(nextStep);
  const [campaign, setCampaign] = useState(account.campaign ?? "general");
  const [sender, setSender] = useState(account.sdr ?? "");
  const templates = ds.templates.filter((t) => !t.archived && t.channel === contact?.channel && t.step === step && t.versions.length);
  const [versionId, setVersionId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [key, nextKey] = useOperationKey();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replyForm, setReplyForm] = useState(false);

  useEffect(() => {
    let active = true;
    api<AccountDetail>(`/api/admin/prospeccion/cuentas/${account.id}`).then((d) => active && setDetail(d)).catch(() => {});
    return () => {
      active = false;
    };
  }, [account.id]);
  const demo = detail?.demos.find((d) => d.url)?.url ?? null;
  const ctx = { inmobiliaria: account.name, decisor: account.decision_maker, sdr: sender, demo };
  const choose = (id: string) => {
    setVersionId(id);
    const t = ds.templates.flatMap((x) => x.versions).find((v) => v.id === id);
    setBody(t ? render(t.body, ctx) : "");
    setSubject(t?.subject ? render(t.subject, ctx) : "");
    setReviewed(false);
  };
  const template = ds.templates.flatMap((t) => t.versions.map((v) => ({ t, v }))).find((x) => x.v.id === versionId);
  const edited = template ? render(template.v.body, ctx).trim() !== body.trim() || render(template.v.subject ?? "", ctx).trim() !== subject.trim() : true;
  const missing = unresolved(`${subject} ${body}`);

  async function prepare(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/prospeccion/intentos", {
        method: "POST",
        body: JSON.stringify({ key, accountId: account.id, contactId, step, campaign, templateVersionId: versionId || null, subject, body, sender, reviewed }),
      });
      nextKey();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos preparar el intento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="pr-top">
        <h3 id="pr-exec-title">Revisar antes de contactar: {account.name}</h3>
        <button type="button" className="pr-link" onClick={() => onOpenAccount(account.id)}>
          Ver ficha
        </button>
      </div>
      <dl className="pr-score">
        <div>
          <dt>Score</dt>
          <dd>{account.score ?? "—"}</dd>
        </div>
        <div>
          <dt>Decisor</dt>
          <dd>{account.decision_maker ?? "Por confirmar"}</dd>
        </div>
        <div>
          <dt>Último envío</dt>
          <dd>{recent ? `${CHANNEL_LABEL[recent.channel]} · ${STEP_LABEL[recent.step]}` : "Ninguno"}</dd>
        </div>
        <div>
          <dt>Próxima acción</dt>
          <dd>{account.next_action ?? "—"}</dd>
        </div>
      </dl>
      {recent && (
        <div className="pr-step" data-testid="last-sent" data-attempt-id={recent.id}>
          <span className="pr-label">Último envío confirmado</span>
          <strong>
            {CHANNEL_LABEL[recent.channel]} · {STEP_LABEL[recent.step]} · {recent.variant_label ?? "variante desconocida"}
          </strong>
          <small>
            {formatWhen(recent.sent_at, recent.sent_precision ?? "time")}
            {recent.legacy ? " · histórico de la planilla" : ` · ID ${recent.id}`}
          </small>
          <button type="button" className="pr-link" onClick={() => setReplyForm(!replyForm)} data-testid="register-reply">
            Registrar respuesta
          </button>
        </div>
      )}
      {replyForm && <EventForm accountId={account.id} initialType="reply" attempts={[]} onDone={async () => (setReplyForm(false), await onChanged())} onCancel={() => setReplyForm(false)} />}
      <form onSubmit={prepare} data-testid="prepare-form" data-account-id={account.id}>
      {account.suppressed && <p className="inline-error">Baja vigente de toda la cuenta: no se puede contactar.</p>}
      {replied && <p className="pr-banner">Esta cuenta ya respondió: la secuencia está detenida. Solo se preparan mensajes de conversación.</p>}
      <div className="pr-form-row">
        <label>
          <span>Destinatario</span>
          <select value={contactId} onChange={(e) => (setContactId(e.target.value), setVersionId(""), setReviewed(false))} data-testid="prepare-contact-select" required>
            <option value="">Elegí un contacto</option>
            {usable.map((c) => (
              <option key={c.id} value={c.id} disabled={!ok(c)}>
                {CHANNEL_LABEL[c.channel]}: {c.address}
                {c.person_name ? ` (${c.person_name})` : ""}
                {c.invalid ? " — inválido" : c.blocked ? " — baja" : c.needs_review ? " — por revisar" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Paso</span>
          <select value={step} onChange={(e) => (setStep(Number(e.target.value)), setVersionId(""))} data-testid="prepare-step">
            {[1, 2, 3, 0].map((s) => (
              <option key={s} value={s} disabled={replied && s > 0}>
                {STEP_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Campaña</span>
          <input value={campaign} maxLength={80} onChange={(e) => setCampaign(e.target.value)} />
        </label>
        <label>
          <span>Quién envía (SDR / cuenta emisora)</span>
          <input value={sender} maxLength={160} onChange={(e) => setSender(e.target.value)} required data-testid="prepare-sender" />
        </label>
      </div>
      {contact && (
        <p className="pr-key" data-testid="recipient-detail">
          {CHANNEL_LABEL[contact.channel]} {contact.address} · fuente: {contact.source ?? "sin fuente"}
          {contact.confidence ? ` · confianza ${contact.confidence}` : ""}
          {contact.verified ? " · verificado" : " · sin verificación registrada"}
          {contact.is_decision_maker ? " · decisor" : ""}
        </p>
      )}
      {!usable.some(ok) && (
        <p className="inline-error">No hay un contacto de WhatsApp o email usable: revisá, corregí o verificá uno en la ficha.</p>
      )}
      <label>
        <span>Versión</span>
        <select value={versionId} onChange={(e) => choose(e.target.value)} data-testid="prepare-template">
          <option value="">Mensaje personalizado (no entra en comparaciones)</option>
          {templates.map((t) => (
            <option key={t.versions[0].id} value={t.versions[0].id}>
              {t.name} v{t.versions[0].version}
            </option>
          ))}
        </select>
      </label>
      {contact?.channel === "email" && (
        <label>
          <span>Asunto</span>
          <input value={subject} maxLength={200} onChange={(e) => (setSubject(e.target.value), setReviewed(false))} required data-testid="prepare-subject" />
        </label>
      )}
      <label>
        <span>Texto exacto del intento</span>
        <textarea value={body} maxLength={4000} rows={6} onChange={(e) => (setBody(e.target.value), setReviewed(false))} required data-testid="prepare-body" />
      </label>
      <p className="pr-key">
        {versionId ? (edited ? "Editaste el texto: se guardará como mensaje personalizado, no como esta versión." : "Texto idéntico a la versión elegida.") : "Sin plantilla: se guarda como personalizado."}{" "}
        {demo ? `{{demo}} → ${demo}` : "Esta inmobiliaria no tiene demo publicada: {{demo}} queda sin completar."} El texto se congela al preparar.
      </p>
      {missing.length > 0 && <p className="inline-error">Faltan datos: {missing.map((m) => `{{${m}}}`).join(", ")}. Completalos o quitá la variable.</p>}
      <label className="pr-check">
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} data-testid="prepare-reviewed" />
        Revisé destinatario, canal, quién envía y el texto exacto
      </label>
      <ErrorNote error={error} />
      <div className="pr-actions">
        <button type="submit" className="button button-small" disabled={busy || !reviewed || !contactId || !body.trim() || missing.length > 0 || account.suppressed} data-testid="prepare-attempt">
          {busy ? "Preparando…" : "Preparar intento"}
        </button>
      </div>
      <p className="pr-banner" role="status">
        Preparar y abrir el canal no incrementan los enviados. Solo la confirmación explícita registra el envío.
      </p>
      </form>
    </div>
  );
}

/** Steps 2–3 of a live attempt: open the channel, then confirm or record what happened. */
function AttemptPanel({ attempt: a, account, onChanged, onOpenAccount }: { attempt: OutreachAttempt; account: ProspectAccount; onChanged: () => Promise<void>; onOpenAccount: (id: string) => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [method, setMethod] = useState<"channel_observed" | "manual">("channel_observed");
  const [sentAt, setSentAt] = useState(artInput());
  const [externalId, setExternalId] = useState("");
  const [evidence, setEvidence] = useState("");
  const [observed, setObserved] = useState(false);
  const [outcome, setOutcome] = useState<"" | "failed" | "invalid_endpoint" | "cancelled" | "uncertain">("");
  const [reason, setReason] = useState("");
  const [replyForm, setReplyForm] = useState(false);

  async function call(action: string, payload: Record<string, unknown>) {
    setBusy(action);
    setError("");
    try {
      return await api<{ attempt: OutreachAttempt; url?: string | null }>(`/api/admin/prospeccion/intentos/${a.id}`, { method: "POST", body: JSON.stringify({ action, ...payload }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos completar la acción.");
      await onChanged();
      return null;
    } finally {
      setBusy("");
    }
  }
  async function openChannel() {
    // A blank tab opened in the click keeps the popup allowed; it gets the link only after the server re-checks opt-outs.
    const win = a.channel === "whatsapp" ? window.open("about:blank", "_blank") : null;
    const r = await call("open", { version: a.version });
    if (!r?.url) {
      win?.close();
      return;
    }
    setLink(r.url);
    if (win) {
      win.opener = null;
      win.location.href = r.url;
    } else if (a.channel === "email") window.location.href = r.url;
    await onChanged();
  }
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (await call("confirm", { method, sentAt: fromArtInput(sentAt), externalId, evidence, observed })) await onChanged();
  }
  async function resolve(e: React.FormEvent) {
    e.preventDefault();
    if (outcome && (await call("resolve", { outcome, reason }))) await onChanged();
  }

  return (
    <div data-testid="attempt-panel" data-attempt-id={a.id} data-attempt-status={a.status}>
      <div className="pr-top">
        <h3 id="pr-exec-title">{account.name}</h3>
        <button type="button" className="pr-link" onClick={() => onOpenAccount(account.id)}>
          Ver ficha
        </button>
      </div>
      <div className="pr-step">
        <span className="pr-label">Estado del intento</span>
        <strong data-testid="attempt-status">{ATTEMPT_STATUS_LABEL[a.status]}</strong>
        <small data-testid="attempt-id">ID {a.id}</small>
        <small>
          Preparado {formatWhen(a.prepared_at)}
          {a.opened_at ? ` · canal abierto ${formatWhen(a.opened_at)}` : ""}
          {a.lock_expires_at && a.status === "opened" ? ` · bloqueo hasta ${formatWhen(a.lock_expires_at)}` : ""}
        </small>
      </div>
      <dl className="pr-score">
        <div>
          <dt>Responsable</dt>
          <dd>{a.sender}</dd>
        </div>
        <div>
          <dt>Canal</dt>
          <dd>{CHANNEL_LABEL[a.channel]}</dd>
        </div>
        <div>
          <dt>Versión</dt>
          <dd>{a.variant_label ?? "—"}</dd>
        </div>
        <div>
          <dt>Secuencia</dt>
          <dd>
            {STEP_LABEL[a.step]} · {a.campaign}
          </dd>
        </div>
      </dl>
      <p className="pr-key" data-testid="attempt-recipient">
        Destinatario: {a.recipient}
      </p>
      {a.subject && <p className="pr-key">Asunto: {a.subject}</p>}
      <p className="pr-frozen" data-testid="attempt-body">
        {a.body}
      </p>

      {a.status === "prepared" && (
        <div className="pr-actions">
          <button type="button" className="button button-small" disabled={!!busy} onClick={openChannel} data-testid="open-channel" data-attempt-id={a.id}>
            {a.channel === "email" ? "Abrir email" : "Abrir WhatsApp"}
          </button>
          <button type="button" className="button button-small button-outline" disabled={!!busy} onClick={() => setOutcome("cancelled")}>
            Cancelar intento
          </button>
        </div>
      )}
      {(a.status === "opened" || a.status === "uncertain") && (
        <>
          {a.status === "uncertain" ? (
            <p className="pr-banner is-warn" role="status">
              Resultado incierto: el canal se abrió y no se confirmó a tiempo. Puede haberse enviado. Revisá el chat o la carpeta de enviados y conciliá: «se envió»
              (confirmar) o «no se envió» (fallido). No se reintenta solo.
            </p>
          ) : (
            <p className="pr-key">
              Canal abierto: enviá en {CHANNEL_LABEL[a.channel]} y volvé a confirmar. Abrir el chat o el mail no prueba entrega.{" "}
              {link ? (
                <a href={link} target="_blank" rel="noreferrer" data-testid="channel-link">
                  Volver a abrir el canal
                </a>
              ) : (
                <button type="button" className="pr-link" onClick={openChannel} disabled={!!busy} data-testid="reopen-channel">
                  Volver a abrir el canal
                </button>
              )}
            </p>
          )}
          <form className="pr-subform" onSubmit={confirm} data-testid="confirm-form">
            <div className="pr-form-row">
              <label>
                <span>Cómo lo verificaste</span>
                <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} data-testid="confirm-method">
                  <option value="channel_observed">Lo vi enviado en el canal</option>
                  <option value="manual">Registro manual del operador</option>
                </select>
              </label>
              <label>
                <span>Hora del envío (Argentina)</span>
                <input type="datetime-local" value={sentAt} onChange={(e) => setSentAt(e.target.value)} required />
              </label>
              <label>
                <span>ID externo (opcional)</span>
                <input value={externalId} maxLength={200} onChange={(e) => setExternalId(e.target.value)} />
              </label>
            </div>
            <label>
              <span>Evidencia breve (opcional, sin datos personales de más)</span>
              <input value={evidence} maxLength={500} onChange={(e) => setEvidence(e.target.value)} />
            </label>
            <label className="pr-check">
              <input type="checkbox" checked={observed} onChange={(e) => setObserved(e.target.checked)} data-testid="confirm-observed" />
              Observé que este mensaje, a este destinatario, salió desde {a.sender}
            </label>
            <div className="pr-actions">
              <button type="submit" className="button button-small" disabled={!!busy || !observed} data-testid="confirm-send" data-attempt-id={a.id}>
                {busy === "confirm" ? "Confirmando…" : a.status === "uncertain" ? "Conciliar: se envió" : "Confirmar envío"}
              </button>
              {a.status === "opened" && (
                <button type="button" className="button button-small button-outline" disabled={!!busy} onClick={() => setOutcome("uncertain")} data-testid="mark-uncertain">
                  Resultado incierto
                </button>
              )}
              <button type="button" className="button button-small button-outline" disabled={!!busy} onClick={() => setOutcome("failed")} data-testid="mark-failed">
                {a.status === "uncertain" ? "Conciliar: no se envió" : "No se envió"}
              </button>
              <button type="button" className="button button-small button-outline" disabled={!!busy} onClick={() => setOutcome("invalid_endpoint")} data-testid="mark-invalid">
                Número o email inválido
              </button>
            </div>
            <p className="pr-key">«Confirmado por operador» no equivale a un recibo del proveedor. Confirmar dos veces registra un solo envío.</p>
          </form>
        </>
      )}
      {outcome && (
        <form className="pr-subform" onSubmit={resolve} data-testid="resolve-form">
          <p>
            <strong>
              {outcome === "cancelled"
                ? "Cancelar el intento (no se envió)"
                : outcome === "failed"
                  ? "Registrar que no se envió"
                  : outcome === "invalid_endpoint"
                    ? "Marcar el destino como inválido (solo este contacto)"
                    : "Marcar resultado incierto (bloquea reintentos hasta conciliar)"}
            </strong>
          </p>
          <label>
            <span>Motivo{outcome === "cancelled" || outcome === "uncertain" ? " (opcional)" : ""}</span>
            <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} required={outcome === "failed" || outcome === "invalid_endpoint"} />
          </label>
          <div className="pr-actions">
            <button type="submit" className="button button-small" disabled={!!busy} data-testid="resolve-submit">
              Guardar
            </button>
            <button type="button" className="button button-small button-outline" onClick={() => setOutcome("")}>
              Volver
            </button>
          </div>
        </form>
      )}
      <ErrorNote error={error} />
      <div className="pr-actions">
        <button type="button" className="button button-small button-outline" onClick={() => setReplyForm(!replyForm)} data-testid="register-reply">
          Registrar respuesta
        </button>
      </div>
      {replyForm && <EventForm accountId={account.id} initialType="reply" attempts={[]} onDone={async () => (setReplyForm(false), await onChanged())} onCancel={() => setReplyForm(false)} />}
      <p className="pr-foot">Sin integración con el canal, las respuestas se registran a mano. Antes de abrir el canal el servidor revisa bajas, el contacto y el bloqueo del operador.</p>
    </div>
  );
}

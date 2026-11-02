"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  ImageIcon,
  MessageCircle,
  Plus,
  Search,
} from "lucide-react";
import { ImportFromListing } from "./demo-import";
import { LeadBadge } from "./lead-score";
import { CreditsDialog, type CreditTarget } from "./admin-agencies";
import { EDIT_HEADER } from "@/lib/agency/edit-scope";
import type { LeadClassKey } from "@/lib/leads/config";

type DemoLeadScore = { score: number | null; classification: LeadClassKey | null; external: number; internal: number; quality: string | null };
import {
  adminPhotoUrl,
  demoUrl,
  whatsappShareUrl,
  type AgencyRow,
  type DemoActivity,
  type DemoSendEvent,
  type DemoSummary,
} from "@/lib/demos/shared";
import {
  DEFAULT_MESSAGE_TEMPLATE,
  MESSAGE_VARIABLES,
  STAGES,
  normalizeArNumber,
  notSent,
  renderMessage,
  stageLabel,
  stageOf,
  whatsappWebUrl,
} from "@/lib/demos/send";

/**
 * The edit context of this tab ("Editar inmobiliaria"), sent with every
 * call to the admin API while it is set. It lives in this page's memory
 * only, so another tab editing another agency never sends it.
 */
let editContext: string | null = null;
export function setEditContext(token: string | null) {
  editContext = token;
}
export const EDIT_EXPIRED_EVENT = "habita:edicion-vencida";

/** fetch for the admin API: JSON in and out, the server's message on errors. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const json = typeof init.body === "string";
  const headers = new Headers(init.headers);
  if (json && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (editContext && path.startsWith("/api/admin/") && !headers.has(EDIT_HEADER)) headers.set(EDIT_HEADER, editContext);
  const r = await fetch(path, {
    cache: "no-store",
    ...init,
    headers,
  });
  const payload = await r.json().catch(() => ({}));
  if (r.status === 401) {
    window.location.assign(`/acceso?next=${encodeURIComponent(window.location.pathname)}`);
    throw new Error("Tu sesión venció. Volvé a ingresar.");
  }
  // The edit context ran out: the banner offers to renew it; nothing was saved and drafts stay.
  if (r.status === 412 && editContext) window.dispatchEvent(new Event(EDIT_EXPIRED_EVENT));
  if (!r.ok) throw new ApiError(payload.error || "No pudimos completar la operación.", r.status, payload);
  return payload as T;
}
/** A failed request, with its status and the server's answer (e.g. the new preview of a changed listing). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** The buyers' link, or the one for presenting the demo to the agency (it may show the strip). */
export const publicLink = (token: string, presentation = false) =>
  demoUrl(window.location.origin, token, presentation);

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Copiá el enlace:", text);
    return false;
  }
}

/**
 * Copies a link that is still being prepared (the agency's needs a server call). The
 * clipboard write starts with the click, so browsers accept it; the same request is
 * reused if the browser refuses, so no second one-time link is created.
 */
export async function copyLinkWhenReady(getLink: () => Promise<string>) {
  const link = getLink();
  try {
    const text = link.then((t) => new Blob([t], { type: "text/plain" }));
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": text })]);
    return true;
  } catch {
    return copyText(await link);
  }
}

export function StatusChip({ status }: { status: DemoSummary["status"] }) {
  return (
    <span className={`dm-status ${status === "published" ? "is-live" : ""}`}>
      {status === "published" ? "Publicada" : "Borrador"}
    </span>
  );
}

/**
 * The agency's link to its demo. While the agency has no account, the link
 * carries a fresh one-time code, so the demo opens its panel for it; once
 * claimed, the plain presentation link does.
 */
async function agencyLink(demo: Pick<DemoSummary, "id" | "token" | "agencyClaimed">) {
  // With its account, the agency sees the demo inside its own panel.
  if (demo.agencyClaimed === true) return `${window.location.origin}/panel/propiedades/${demo.id}`;
  const claim = await api<{ presentationUrl: string | null }>(`/api/admin/demos/${demo.id}/reclamo`, { method: "POST" });
  return claim.presentationUrl ?? publicLink(demo.token, true);
}

/**
 * For an agency that asks about prices: its same demo opened on the plans, under its
 * own bar. Also a fresh one-time code; with an account, the plans as anyone sees them.
 */
async function agencyPricesLink(demo: Pick<DemoSummary, "id" | "token" | "agencyClaimed">) {
  if (demo.agencyClaimed === true) return `${window.location.origin}/precios`;
  const claim = await api<{ pricesUrl: string | null }>(`/api/admin/demos/${demo.id}/reclamo`, { method: "POST" });
  return claim.pricesUrl ?? publicLink(demo.token, true);
}

/** A text action that copies one of the demo's links (the agency's, its prices or the buyers'). */
export function LinkCopy({ demo, which }: { demo: Pick<DemoSummary, "id" | "token" | "status" | "agencyClaimed">; which: "agency" | "prices" | "buyer" }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = demo.status === "published";
  async function copy() {
    setBusy(true);
    setError("");
    try {
      const ok = await copyLinkWhenReady(() =>
        which === "agency" ? agencyLink(demo) : which === "prices" ? agencyPricesLink(demo) : Promise.resolve(publicLink(demo.token)),
      );
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos crear el enlace.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="dm-text" disabled={!live || busy} title={live ? undefined : "Publicá la demo para compartirla"} onClick={copy}>
        {copied ? "Copiado" : "Copiar link"}
      </button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/**
 * "Ver": the agency's view (the same link as Copiar link) or the buyers' page.
 * A draft has no public page yet, so the buyers' view opens the team's preview.
 */
export function ViewLink({ demo, which }: { demo: Pick<DemoSummary, "id" | "token" | "status" | "agencyClaimed">; which: "agency" | "buyer" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    setBusy(true);
    setError("");
    // Opened now, while the click still counts, so the browser does not block it.
    const tab = window.open("about:blank", "_blank");
    try {
      const url =
        which === "agency"
          ? await agencyLink(demo)
          : demo.status === "published"
            ? publicLink(demo.token)
            : `${window.location.origin}/admin/demos/${demo.id}/vista-previa`;
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.open(url, "_blank", "noopener");
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "No pudimos abrir la vista.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="dm-text" disabled={busy} onClick={open}>
        Ver
      </button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** WhatsApp with only the agency's link: no text of ours. Opens the agency's chat when its number is known. */
export function WhatsappText({ demo }: { demo: Pick<DemoSummary, "id" | "token" | "agencyClaimed" | "agencyWhatsapp"> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    setBusy(true);
    setError("");
    // Opened now, while the click still counts, so the browser does not block it.
    const tab = window.open("about:blank", "_blank");
    try {
      const url = whatsappShareUrl(await agencyLink(demo), demo.agencyWhatsapp);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.href = url;
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "No pudimos crear el enlace.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="dm-text dm-text-wa"
        disabled={busy}
        onClick={send}
        title={demo.agencyWhatsapp ? `Enviar a +${demo.agencyWhatsapp}` : "Sin WhatsApp de la inmobiliaria: elegís el chat al enviar"}
      >
        WhatsApp
      </button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** One way to share a demo: the same view every time, copied or sent on WhatsApp. */
function ShareCard({
  title,
  hint,
  shown,
  live,
  resolve,
  to,
}: {
  title: string;
  hint: string;
  shown: string;
  live: boolean;
  resolve: () => Promise<string>;
  /** The recipient's WhatsApp (wa.me digits); without one, WhatsApp asks who to send it to. */
  to?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function copy() {
    setBusy(true);
    setError("");
    try {
      if (await copyLinkWhenReady(resolve)) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos crear el enlace.");
    } finally {
      setBusy(false);
    }
  }
  async function whatsapp() {
    setBusy(true);
    setError("");
    // Opened now, while the click still counts, so the browser does not block it.
    const tab = window.open("about:blank", "_blank");
    try {
      const url = whatsappShareUrl(await resolve(), to);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.href = url;
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "No pudimos crear el enlace.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dm-share-card">
      <strong>{title}</strong>
      <span className="dm-help">{hint}</span>
      <code className="dm-share-url">{live ? shown : "Se activa al publicar la demo"}</code>
      <div className="dm-share-buttons">
        <button type="button" className="button button-small button-outline" disabled={!live || busy} onClick={copy}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Enlace copiado" : "Copiar enlace"}
        </button>
        <button type="button" className="button button-small dm-whatsapp" disabled={!live || busy} onClick={whatsapp}>
          <MessageCircle size={15} /> WhatsApp
        </button>
      </div>
      {to !== undefined && (
        <span className="dm-help">{to ? `WhatsApp abre el chat de +${to}.` : "Sin WhatsApp de la inmobiliaria: elegís el chat al enviar."}</span>
      )}
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * The two ways to share a demo, always the same: to the agency (its
 * presentation, as from its panel) and to the buyers (the clean ficha).
 * No step to create a link first.
 */
export function ShareCards({ demo }: { demo: Pick<DemoSummary, "id" | "token" | "status" | "agencyClaimed" | "agencyWhatsapp"> }) {
  const live = demo.status === "published";
  return (
    <div className="dm-share-cards">
      <ShareCard
        title="Enviar a la inmobiliaria"
        hint="Siempre entra a la vista de presentación, como desde su panel."
        shown={publicLink(demo.token, true)}
        live={live}
        resolve={() => agencyLink(demo)}
        to={demo.agencyWhatsapp ?? null}
      />
      <ShareCard
        title="Precios para la inmobiliaria"
        hint="Su misma demo, abierta en los planes y sin salir de su entorno."
        shown={`${publicLink(demo.token, true)}/…/precios`}
        live={live}
        resolve={() => agencyPricesLink(demo)}
        to={demo.agencyWhatsapp ?? null}
      />
      <ShareCard
        title="Enviar al comprador"
        hint="Siempre la ficha limpia, sin franja ni acceso al panel."
        shown={publicLink(demo.token)}
        live={live}
        resolve={async () => publicLink(demo.token)}
      />
    </div>
  );
}

/**
 * The agency's credits in the demo's row: its available balance and the ones
 * reserved until it accepts the invitation. The same dialog as Inmobiliarias.
 */
export function DemoCredits({ demo, onDone }: { demo: DemoSummary; onDone: (text: string) => void }) {
  const [target, setTarget] = useState<CreditTarget | null>(null);
  const show = (n: number | null) => (n === null ? "—" : String(n));
  // With an account: its balance. Without one: what waits for it.
  const shown = demo.agencyClaimed ? show(demo.credits.available) : show(demo.credits.reserved);
  return (
    <div className="dm-credits">
      <span className="dm-credits-label">{demo.agencyClaimed ? "Créditos" : "Créditos reservados"}</span>
      <div className="dm-credits-nums">
        <b>{shown}</b>
        <button
          type="button"
          className="dm-text"
          onClick={() =>
            setTarget({
              id: demo.agencyId,
              name: demo.agencyName,
              hasOwner: demo.agencyClaimed === true,
              available: demo.credits.available,
              reserved: demo.credits.reserved,
            })
          }
        >
          Cargar
        </button>
      </div>
      <CreditsDialog
        target={target}
        onClose={() => setTarget(null)}
        onDone={(text) => {
          setTarget(null);
          onDone(text);
        }}
      />
    </div>
  );
}

/** How long ago something happened, for the team's list. */
function agoText(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/**
 * The follow-up bar: Sin enviar → Enviada → Ingresó → … → Suscribió. Gray
 * until sent; "Enviada" in the brand green; from "Ingresó" on, the steps
 * reached are green and the rest gray.
 */
export function StageBar({ stage }: { stage: number }) {
  return (
    <ol className="dm-stage" aria-label={`Seguimiento: ${stageLabel(stage)}`}>
      {STAGES.slice(1).map((name, i) => {
        const step = i + 1;
        const cls = step > stage ? "" : step === 1 ? "is-sent" : "on";
        return <li key={name} className={cls} title={name} />;
      })}
    </ol>
  );
}

/**
 * The demo's follow-up and what visitors did, at a glance: the stage bar,
 * when it was sent, how many people came and when last. Team only.
 */
export function ActivityStatus({ activity, sentAt }: { activity: DemoActivity; sentAt?: string | null }) {
  const stage = stageOf(sentAt ?? null, activity.level);
  const people = `${activity.visitors} ${activity.visitors === 1 ? "persona" : "personas"}`;
  const sentText = sentAt ? `Enviada ${agoText(sentAt)}` : "";
  const visitText = activity.at ? `${people} · última visita ${agoText(activity.at)}` : "Sin visitas todavía";
  return (
    <div className="dm-activity" aria-label={`Seguimiento: ${stageLabel(stage)}`}>
      <span className="dm-activity-label">Seguimiento</span>
      <strong>{stageLabel(stage)}</strong>
      <StageBar stage={stage} />
      <span className="dm-activity-foot">{[sentText, visitText].filter(Boolean).join(" · ")}</span>
    </div>
  );
}

/** A small modal: a title, the content and a close button. Keyboard: Escape closes. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dm-dialog-backdrop" onMouseDown={onClose}>
      <div className="dm-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <button type="button" className="dm-text" onClick={onClose} aria-label="Cerrar">
            Cerrar
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** The global message template, edited once for every demo. Each demo can override it. */
export function MessageTemplateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (text: string) => void }) {
  const [template, setTemplate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ template: string }>("/api/admin/demos/plantilla")
      .then((d) => setTemplate(d.template))
      .catch((e) => setError(e.message));
  }, []);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await api<{ template: string }>("/api/admin/demos/plantilla", { method: "PUT", body: JSON.stringify({ template }) });
      onSaved("Mensaje de WhatsApp guardado.");
      setTemplate(saved.template);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Mensaje de WhatsApp" onClose={onClose}>
      <div className="dm-dialog-body">
        <p className="dm-help">
          Variables: {MESSAGE_VARIABLES.map((v) => `{${v}}`).join(" ")}. {"{nombre}"} es el contacto de la inmobiliaria o, si no hay, su nombre. {"{ubicacion}"} es el barrio de la propiedad.
        </p>
        <textarea
          rows={6}
          maxLength={1000}
          aria-label="Plantilla del mensaje"
          value={template ?? ""}
          disabled={template === null || busy}
          onChange={(e) => setTemplate(e.target.value)}
        />
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="dm-dialog-actions">
          <button type="button" className="text-link" disabled={busy || template === null} onClick={() => setTemplate(DEFAULT_MESSAGE_TEMPLATE)}>
            Volver al predeterminado
          </button>
          <button type="button" className="button button-small" disabled={busy || !template?.trim()} onClick={save}>
            Guardar
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * "Enviar por WhatsApp": opens WhatsApp Web in this same tab with the chat of
 * the agency and the message (the link included) already written. Shows the
 * final text first; sending marks the demo as "Enviada". Team only.
 */
export function SendWhatsapp({ demo, fixHere = false }: { demo: DemoSummary; fixHere?: boolean }) {
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState(DEFAULT_MESSAGE_TEMPLATE);
  const [globalTemplate, setGlobalTemplate] = useState(DEFAULT_MESSAGE_TEMPLATE);
  const [ownTemplate, setOwnTemplate] = useState(demo.messageTemplate != null);
  const [savedForAll, setSavedForAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const phone = normalizeArNumber(demo.agencyWhatsapp);
  const published = demo.status === "published";
  const missing = !published
    ? "Publicá la demo para enviarla."
    : !phone
      ? `Falta el WhatsApp de la inmobiliaria: ${fixHere ? "cargalo acá abajo" : "cargalo en la demo"}.`
      : null;
  const preview = renderMessage(template, {
    nombre: demo.agencyContact ?? null,
    inmobiliaria: demo.agencyName,
    ubicacion: demo.propertyLocation ?? null,
    propiedad: demo.propertyTitle,
    link: publicLink(demo.token, true),
    creditos: demo.credits.reserved,
  });

  async function openDialog() {
    setError("");
    setSavedForAll(false);
    setOpen(true);
    try {
      const { template: general } = await api<{ template: string }>("/api/admin/demos/plantilla");
      setGlobalTemplate(general);
      setOwnTemplate(demo.messageTemplate != null);
      setTemplate(demo.messageTemplate ?? general);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos leer el mensaje.");
    }
  }

  // The text becomes the general message, and this demo goes back to using it.
  async function saveForAll() {
    setBusy(true);
    setError("");
    try {
      const saved = await api<{ template: string }>("/api/admin/demos/plantilla", { method: "PUT", body: JSON.stringify({ template }) });
      if (demo.messageTemplate != null)
        await api(`/api/admin/demos/${demo.id}`, { method: "PATCH", body: JSON.stringify({ action: "message", message: null }) });
      setGlobalTemplate(saved.template);
      setTemplate(saved.template);
      setOwnTemplate(false);
      setSavedForAll(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar el mensaje general.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!phone) return;
    setBusy(true);
    setError("");
    try {
      // The real link: an agency without account gets its one-time code here, as the copy buttons do.
      const link = await agencyLink(demo);
      const text = renderMessage(template, {
        nombre: demo.agencyContact ?? null,
        inmobiliaria: demo.agencyName,
        ubicacion: demo.propertyLocation ?? null,
        propiedad: demo.propertyTitle,
        link,
        creditos: demo.credits.reserved,
      });
      // This demo's own message is kept only when it differs from the general one.
      const wanted = ownTemplate && template !== globalTemplate ? template : null;
      if (wanted !== demo.messageTemplate)
        await api(`/api/admin/demos/${demo.id}`, { method: "PATCH", body: JSON.stringify({ action: "message", message: wanted }) });
      // Marked as sent before leaving (a second send keeps the first date and goes to the history).
      await api(`/api/admin/demos/${demo.id}`, { method: "PATCH", body: JSON.stringify({ action: "sent", sent: true, via: "whatsapp" }) });
      window.location.href = whatsappWebUrl(phone, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos preparar el envío.");
      setBusy(false);
    }
  }

  return (
    <div className="dm-send">
      <button
        type="button"
        className="button button-small dm-whatsapp"
        data-testid="send-demo-whatsapp"
        disabled={Boolean(missing) || busy}
        onClick={openDialog}
      >
        <MessageCircle size={15} /> Enviar por WhatsApp
      </button>
      {missing && <span className="dm-help">{missing}</span>}
      {open && (
        <Dialog title={`Enviar «${demo.title}» a ${demo.agencyName}`} onClose={() => !busy && setOpen(false)}>
          <div className="dm-dialog-body">
            <p className="dm-help">
              Se abre WhatsApp Web con el chat de +{phone} y el mensaje escrito. Lo enviás vos.
              {demo.sentAt ? ` Ya se envió ${agoText(demo.sentAt)}: queda registrado otro envío.` : ""}
            </p>
            <label className="checkbox-label dm-check">
              <input
                type="checkbox"
                checked={ownTemplate}
                onChange={(e) => {
                  setOwnTemplate(e.target.checked);
                  // Back to the general text when the demo stops having its own.
                  if (!e.target.checked) setTemplate(globalTemplate);
                }}
              />
              Mensaje propio para esta demo
            </label>
            <textarea
              rows={6}
              maxLength={1000}
              aria-label="Mensaje"
              value={template}
              disabled={!ownTemplate || busy}
              onChange={(e) => setTemplate(e.target.value)}
            />
            {!ownTemplate ? (
              <p className="dm-help">Se usa el mensaje general, el mismo para todas las demos. Para cambiarlo, marcá «Mensaje propio» y editalo.</p>
            ) : (
              template !== globalTemplate && (
                <div className="dm-dialog-actions">
                  <span className="dm-help">Por ahora este texto queda solo para esta demo.</span>
                  <button type="button" className="button button-small button-outline" disabled={busy || !template.trim()} onClick={saveForAll}>
                    Guardar para todas las demos
                  </button>
                </div>
              )
            )}
            {savedForAll && (
              <p className="inline-notice" role="status">
                Guardado como mensaje general: queda para todas las demos que no tengan uno propio.
              </p>
            )}
            <div className="dm-msg-preview" aria-label="Vista previa del mensaje">
              <span className="dm-help">Vista previa</span>
              <p>{preview}</p>
              <span className="dm-help">El enlace definitivo se prepara al enviar.</span>
            </div>
            {demo.credits.reserved === null && (
              <p className="inline-notice" role="status">
                No pudimos leer los créditos reservados: revisá el texto antes de enviar.
              </p>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="dm-dialog-actions">
              <button type="button" className="text-link" disabled={busy} onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="button button-small dm-whatsapp" data-testid="confirm-send-demo-whatsapp" disabled={busy || !template.trim()} onClick={send}>
                {busy ? "Preparando…" : "Abrir WhatsApp"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** Marks the demo as sent by hand (it went out another way), or undoes it. The team's follow-up only. */
export function SentToggle({ demo, onDone }: { demo: DemoSummary; onDone: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sent = Boolean(demo.sentAt);
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/demos/${demo.id}`, { method: "PATCH", body: JSON.stringify({ action: "sent", sent: !sent }) });
      onDone(sent ? "Vuelve a «Sin enviar»." : "Marcada como enviada.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="dm-text" disabled={busy} onClick={toggle}>
        {sent ? "Deshacer envío" : "Marcar como enviada"}
      </button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** "+549 223 633-7191"-style display of wa.me digits, for the team to check the number at a glance. */
export function phoneText(digits: string | null | undefined) {
  return digits ? `+${digits}` : "";
}

/**
 * The agency's WhatsApp where a demo is created: optional but highlighted,
 * since without it the demo cannot be sent from the panel. Shows how the
 * number will be saved.
 */
export function AgencyWhatsappField({
  value,
  onChange,
  note,
}: {
  value: string;
  onChange: (v: string) => void;
  note?: string;
}) {
  const number = normalizeArNumber(value);
  return (
    <div className="dm-wa-field dm-wide">
      <label>
        WhatsApp de la inmobiliaria <small>(opcional, para enviarle la demo)</small>
        <input
          type="tel"
          inputMode="tel"
          maxLength={40}
          placeholder="223 633-7191"
          data-testid="agency-whatsapp-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <span className="dm-help">
        {value.trim()
          ? number
            ? `Se guarda como ${phoneText(number)}.`
            : "No parece un número argentino: incluí el código de área."
          : (note ?? "Sin él, «Enviar por WhatsApp» queda deshabilitado. Se puede cargar después en la demo.")}
      </span>
    </div>
  );
}

/** The agency's WhatsApp on the demo's screen, to correct it right there. It is the agency's: it applies to all its demos. */
export function AgencyWhatsappEditor({ demo, onDone }: { demo: DemoSummary; onDone: (text: string) => void }) {
  const [value, setValue] = useState(phoneText(demo.agencyWhatsapp));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setValue(phoneText(demo.agencyWhatsapp)), [demo.agencyWhatsapp]);
  const number = normalizeArNumber(value);
  const changed = (number ?? "") !== (demo.agencyWhatsapp ?? "") || (!number && value.trim() !== "");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/demos/${demo.id}`, { method: "PATCH", body: JSON.stringify({ action: "whatsapp", whatsapp: value.trim() || null }) });
      onDone(value.trim() ? "WhatsApp de la inmobiliaria guardado." : "WhatsApp de la inmobiliaria borrado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dm-wa-field">
      <label htmlFor={`wa-${demo.id}`}>WhatsApp de la inmobiliaria</label>
      <div className="dm-wa-row">
        <input
          id={`wa-${demo.id}`}
          type="tel"
          inputMode="tel"
          maxLength={40}
          placeholder="223 633-7191"
          data-testid="agency-whatsapp-input"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" className="button button-small button-outline" disabled={busy || !changed || (value.trim() !== "" && !number)} onClick={save}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </div>
      <span className="dm-help">
        {value.trim() && !number
          ? "No parece un número argentino: incluí el código de área."
          : number && changed
            ? `Se guarda como ${phoneText(number)}, para todas sus demos.`
            : demo.agencyWhatsapp
              ? "Es el de la inmobiliaria: vale para todas sus demos."
              : "Cargalo para poder enviar la demo por WhatsApp."}
      </span>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

const SEND_KIND = { whatsapp: "Enviada por WhatsApp", manual: "Marcada como enviada", unsent: "Envío deshecho" } as const;

/** The demo's sending history with date and time, newest first. */
export function SendLog({ events }: { events: DemoSendEvent[] | undefined }) {
  if (!events?.length) return null;
  const when = (iso: string) =>
    new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <ul className="dm-send-log" aria-label="Historial de envío">
      {events.map((e) => (
        <li key={`${e.at}-${e.kind}`}>
          {SEND_KIND[e.kind]} · {when(e.at)}
        </li>
      ))}
    </ul>
  );
}

/** How the link will look when pasted in WhatsApp (image, title, description, domain). */
export function LinkPreview({ demo, location }: { demo: DemoSummary; location?: string | null }) {
  const host = typeof window === "undefined" ? "www.habitaia.app" : window.location.host;
  return (
    <div className="dm-link-preview" aria-label="Previsualización del enlace">
      {demo.cover ? (
        <img
          src={adminPhotoUrl(demo.cover.id, demo.cover.version, undefined, true)}
          alt=""
        />
      ) : (
        <div className="dm-link-preview-empty">
          <ImageIcon size={26} aria-hidden="true" /> Sin portada
        </div>
      )}
      <div>
        <strong>
          {demo.title} · {demo.agencyName}
        </strong>
        <p>
          {location ? `${location} · ` : ""}Imaginá cada espacio a tu estilo con {demo.agencyName}.
        </p>
        <span>{host}</span>
      </div>
    </div>
  );
}

export function DemoList() {
  const [demos, setDemos] = useState<DemoSummary[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | DemoSummary["status"] | "unsent">("all");
  const [template, setTemplate] = useState(false);
  const load = useCallback(async () => {
    const data = await api<{ demos: DemoSummary[] }>("/api/admin/demos");
    setDemos(data.demos);
  }, []);
  // The lead scores come apart and after the list, so they never slow it down.
  const [scores, setScores] = useState<Record<string, DemoLeadScore>>({});
  const loadScores = useCallback(() => {
    api<Record<string, DemoLeadScore>>("/api/admin/leads/demos").then(setScores, () => undefined);
  }, []);
  useEffect(() => {
    void load()
      .catch((e) => setError(e.message))
      .finally(loadScores);
  }, [load, loadScores]);
  async function act(demo: DemoSummary, action: "publish" | "unpublish" | "delete") {
    if (
      action === "delete" &&
      !window.confirm(
        `¿Eliminar la demo "${demo.title}" de ${demo.agencyName}? El enlace deja de funcionar y se borran sus fotos. La inmobiliaria se conserva.`,
      )
    )
      return;
    setBusy(demo.id);
    setError("");
    setNotice("");
    try {
      if (action === "delete") await api(`/api/admin/demos/${demo.id}`, { method: "DELETE" });
      else
        await api(`/api/admin/demos/${demo.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action }),
        });
      setNotice(
        action === "delete"
          ? "Demo eliminada."
          : action === "publish"
            ? "Demo publicada. Ya podés copiar el enlace."
            : "Demo despublicada: el enlace dejó de estar disponible.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setBusy("");
    }
  }
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (demos || []).filter(
      (d) =>
        (status === "all" ||
          (status === "unsent" ? notSent(stageOf(d.sentAt ?? null, d.activity.level), d.status) : d.status === status)) &&
        (!q || `${d.agencyName} ${d.propertyTitle} ${d.title}`.toLowerCase().includes(q)),
    );
  }, [demos, query, status]);
  return (
    <div className="account-page container dm-page">
      <div className="dm-heading">
        <div>
          <span className="eyebrow">Operación comercial</span>
          <h1>
            Demos comerciales<span className="accent">.</span>
          </h1>
          <p>
            Galerías con fotos reales de cada inmobiliaria, ambientadas con IA, para enviar por
            WhatsApp. Solo el equipo ve este panel.
          </p>
        </div>
        <Link href="/admin/demos/nueva" className="button button-primary button-large">
          <Plus size={18} /> Crear nueva demo
        </Link>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}
      {template && (
        <MessageTemplateDialog
          onClose={() => setTemplate(false)}
          onSaved={(text) => {
            setTemplate(false);
            setNotice(text);
          }}
        />
      )}
      <div className="dm-filters">
        <label className="dm-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar inmobiliaria o propiedad"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar inmobiliaria o propiedad"
          />
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Filtrar por estado"
        >
          <option value="all">Todas</option>
          <option value="draft">Borradores</option>
          <option value="published">Publicadas</option>
          <option value="unsent">Sin enviar</option>
        </select>
        <button type="button" className="button button-small button-outline" onClick={() => setTemplate(true)}>
          Mensaje de WhatsApp
        </button>
      </div>
      {!demos && !error && <p>Cargando demos…</p>}
      {demos && !demos.length && (
        <div className="account-panel dm-empty">
          <h2>Todavía no hay demos</h2>
          <p>Creá la primera: cargás la inmobiliaria, las fotos de una propiedad y las ambientás.</p>
        </div>
      )}
      {demos && demos.length > 0 && !shown.length && <p>No hay demos que coincidan.</p>}
      <ul className="dm-list">
        {shown.map((d) => (
          <li key={d.id} className="dm-row">
            <Link href={`/admin/demos/${d.id}`} className="dm-thumb" aria-label={`Editar ${d.title}`}>
              {d.cover ? (
                <img
                  src={adminPhotoUrl(d.cover.id, d.cover.version, 480)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <ImageIcon size={24} aria-hidden="true" />
              )}
            </Link>
            <div className="dm-row-main">
              <Link href={`/admin/inmobiliarias/${d.agencyId}`} className="dm-agency">
                {d.agencyName}
                {d.agencyClaimed && <span className="dm-claimed"> · ya tiene su panel</span>}
              </Link>
              <strong>{d.propertyTitle}</strong>
              <span className="dm-meta">
                {d.photos} {d.photos === 1 ? "foto" : "fotos"} · {d.staged}{" "}
                {d.staged === 1 ? "ambientada" : "ambientadas"} · creada el{" "}
                {new Date(d.createdAt).toLocaleDateString("es-AR")}
              </span>
            </div>
            <StatusChip status={d.status} />
            <div className="dm-links">
              <span className="dm-who">Inmobiliaria</span>
              <ViewLink demo={d} which="agency" />
              <LinkCopy demo={d} which="agency" />
              <span className="dm-sep">·</span>
              <span className="dm-who">Comprador</span>
              <ViewLink demo={d} which="buyer" />
              <LinkCopy demo={d} which="buyer" />
              <span className="dm-sep">·</span>
              <span className="dm-who">Precios</span>
              <LinkCopy demo={d} which="prices" />
              {d.status === "published" && (
                <>
                  <span className="dm-sep">·</span>
                  <WhatsappText demo={d} />
                </>
              )}
            </div>
            <div className="dm-bottom">
              <div className="dm-facts">
                <DemoCredits demo={d} onDone={(text) => { setNotice(text); void load(); }} />
                <ActivityStatus activity={d.activity} sentAt={d.sentAt} />
                {scores[d.id] && (
                  <Link href={`/admin/leads?inmobiliaria=${d.agencyId}`} className="dm-lead" title="Ver el detalle en Leads">
                    <span className="dm-activity-label">Lead score</span>
                    <LeadBadge score={scores[d.id].score} classification={scores[d.id].classification} partial={scores[d.id].quality === "partial"} />
                  </Link>
                )}
              </div>
              <div className="dm-actions">
                {d.status === "published" && (
                  <>
                    <SendWhatsapp demo={d} />
                    <SentToggle demo={d} onDone={(text) => { setNotice(text); void load(); }} />
                    <span className="dm-sep">·</span>
                  </>
                )}
                <Link href={`/admin/demos/${d.id}`} className="dm-text">
                  Editar
                </Link>
                <span className="dm-sep">·</span>
                <button
                  type="button"
                  className={`dm-text ${d.status === "published" ? "" : "dm-text-primary"}`}
                  disabled={busy === d.id}
                  onClick={() => act(d, d.status === "published" ? "unpublish" : "publish")}
                >
                  {d.status === "published" ? "Despublicar" : "Publicar"}
                </button>
                <span className="dm-sep">·</span>
                <button
                  type="button"
                  className="dm-text dm-danger"
                  aria-label={`Eliminar ${d.title}`}
                  disabled={busy === d.id}
                  onClick={() => act(d, "delete")}
                >
                  Eliminar
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="dm-footer-link">
        <Link href="/admin/inmobiliarias" className="text-link">
          Ver inmobiliarias
        </Link>
        {" · "}
        <Link href="/administracion" className="text-link">
          Ir a Administración
        </Link>
      </p>
    </div>
  );
}

const emptyAgency = { name: "", website: "", contact_name: "", notes: "" };
const emptyProperty = { title: "", listing_url: "", location: "", description: "" };

export function AgencyFields({
  value,
  onChange,
}: {
  value: typeof emptyAgency;
  onChange: (v: typeof emptyAgency) => void;
}) {
  const set = (k: keyof typeof emptyAgency) => (e: { target: { value: string } }) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <div className="dm-fields">
      <label>
        Nombre de la inmobiliaria *
        <input required maxLength={120} value={value.name} onChange={set("name")} />
      </label>
      <label>
        Sitio web <small>(visible: el logo enlaza ahí)</small>
        <input
          maxLength={300}
          inputMode="url"
          placeholder="inmobiliaria.com.ar"
          value={value.website}
          onChange={set("website")}
        />
      </label>
      <label>
        Nombre de contacto
        <input maxLength={120} value={value.contact_name} onChange={set("contact_name")} />
      </label>
      <label className="dm-wide">
        Notas internas <small>(nunca se muestran en la demo)</small>
        <textarea rows={3} maxLength={4000} value={value.notes} onChange={set("notes")} />
      </label>
    </div>
  );
}

export function PropertyFields({
  value,
  onChange,
}: {
  value: typeof emptyProperty;
  onChange: (v: typeof emptyProperty) => void;
}) {
  const set = (k: keyof typeof emptyProperty) => (e: { target: { value: string } }) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <div className="dm-fields">
      <label>
        Título de la propiedad *
        <input
          required
          maxLength={160}
          placeholder="Departamento de 3 ambientes con balcón"
          value={value.title}
          onChange={set("title")}
        />
      </label>
      <label>
        Ubicación o barrio <small>(visible)</small>
        <input maxLength={160} placeholder="Palermo, CABA" value={value.location} onChange={set("location")} />
      </label>
      <label className="dm-wide">
        URL de la publicación original <small>(visible: «Ver publicación original»)</small>
        <input
          maxLength={500}
          inputMode="url"
          placeholder="https://…"
          value={value.listing_url}
          onChange={set("listing_url")}
        />
      </label>
      <label className="dm-wide">
        Descripción breve <small>(visible en la demo)</small>
        <textarea rows={3} maxLength={1000} value={value.description} onChange={set("description")} />
      </label>
    </div>
  );
}

/**
 * Creates the demo from the listing URL alone: the server reads the page and
 * returns the photos found, imported here one by one so progress is visible
 * and the order of the listing is kept.
 */
export function NewDemoForm({ agencyId: fixedAgency = null }: { agencyId?: string | null } = {}) {
  const router = useRouter();
  const [agencies, setAgencies] = useState<AgencyRow[] | null>(null);
  const [mode, setMode] = useState<"existing" | "new">(fixedAgency ? "existing" : "new");
  const [agencyId, setAgencyId] = useState(fixedAgency ?? "");
  const [agency, setAgency] = useState(emptyAgency);
  const [property, setProperty] = useState(emptyProperty);
  const [whatsapp, setWhatsapp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = agencies?.find((a) => a.id === agencyId) ?? null;
  // Asked when it is a new agency, or one we have no WhatsApp for.
  const askWhatsapp = mode === "new" || !agencies?.length || Boolean(chosen && !chosen.whatsapp);
  useEffect(() => {
    api<{ agencies: AgencyRow[] }>("/api/admin/demos")
      .then((d) => {
        setAgencies(d.agencies);
        if (d.agencies.length) setMode("existing");
        if (fixedAgency && !d.agencies.some((a) => a.id === fixedAgency)) setError("No encontramos esa inmobiliaria. Elegila de la lista.");
      })
      .catch((e) => setError(e.message));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api<{ id: string }>("/api/admin/demos", {
        method: "POST",
        body: JSON.stringify(
          {
            ...(mode === "existing" ? { agencyId } : { agency }),
            property,
            whatsapp: askWhatsapp && whatsapp.trim() ? whatsapp.trim() : undefined,
          },
        ),
      });
      router.push(`/admin/demos/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear la demo.");
      setBusy(false);
    }
  }
  return (
    <div className="account-page container dm-page dm-narrow">
      <Link href={fixedAgency ? `/admin/inmobiliarias/${fixedAgency}` : "/admin/inmobiliarias"} className="text-link">
        ← {fixedAgency ? "Volver a la inmobiliaria" : "Inmobiliarias"}
      </Link>
      <h1>
        {fixedAgency ? "Agregar propiedad" : "Nueva demo"}
        <span className="accent">.</span>
      </h1>
      {fixedAgency && agencies && (
        <p className="inline-notice">
          Se agrega a <strong>{agencies.find((a) => a.id === fixedAgency)?.name ?? "la inmobiliaria elegida"}</strong>.
        </p>
      )}
      <p>Pegá la URL de la ficha y la armamos sola, o cargá los datos a mano.</p>
      <ImportFromListing agencyId={fixedAgency} />
      <h2 className="dm-or">O a mano</h2>
      <p className="dm-help">Primero la inmobiliaria y la propiedad. Las fotos se cargan en el paso siguiente.</p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <section className="account-panel">
          <h2>Inmobiliaria</h2>
          {agencies && agencies.length > 0 && (
            <div className="dm-choice" role="radiogroup" aria-label="Inmobiliaria">
              <label>
                <input
                  type="radio"
                  name="agency-mode"
                  checked={mode === "existing"}
                  onChange={() => setMode("existing")}
                />
                Una que ya cargamos
              </label>
              <label>
                <input
                  type="radio"
                  name="agency-mode"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
                Nueva inmobiliaria
              </label>
            </div>
          )}
          {mode === "existing" && agencies?.length ? (
            <label className="dm-select">
              Elegí la inmobiliaria
              <select required value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                <option value="">Elegir…</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <AgencyFields value={agency} onChange={setAgency} />
          )}
          {askWhatsapp ? (
            <AgencyWhatsappField value={whatsapp} onChange={setWhatsapp} />
          ) : (
            chosen?.whatsapp && <p className="dm-help">WhatsApp para enviarle la demo: {phoneText(chosen.whatsapp)}.</p>
          )}
          <p className="dm-help">No necesita tener una cuenta en habita.</p>
        </section>
        <section className="account-panel">
          <h2>Propiedad</h2>
          <PropertyFields value={property} onChange={setProperty} />
        </section>
        <button className="button button-primary button-large" disabled={busy}>
          {busy ? "Creando…" : "Crear y cargar fotos"}
        </button>
      </form>
    </div>
  );
}

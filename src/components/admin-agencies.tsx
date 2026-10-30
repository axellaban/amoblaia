"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Copy, Eye, Gift, Link2, PencilLine, Plus, UserCog } from "lucide-react";
import { ApiError, api } from "@/components/admin-demos";
import { nextStep, ORIGIN_LABEL, type PanelProperty } from "@/lib/agency/shared";
import { CLAIM_LABEL, STAGE_LABEL, agencyStage, type AdminAgencyDetail, type AdminAgencyRow } from "@/lib/agency/stage";
import { adminPhotoUrl } from "@/lib/demos/shared";

const date = (iso: string) => new Date(iso).toLocaleDateString("es-AR");

/** Invitations of an agency without an account: create a new link, revoke a pending one. */
export function AgencyInvitations({ agencyId, claims, hasOwner }: { agencyId: string; claims: AdminAgencyDetail["claims"]; hasOwner: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy("new");
    setError("");
    try {
      setCreated(await api<{ url: string; expiresAt: string }>(`/api/admin/inmobiliarias/${agencyId}/invitaciones`, { method: "POST" }));
      setCopied(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos crear la invitación.");
    } finally {
      setBusy("");
    }
  }
  async function revoke(id: string) {
    if (!window.confirm("¿Revocar esta invitación? El enlace deja de funcionar enseguida.")) return;
    setBusy(id);
    setError("");
    try {
      await api(`/api/admin/inmobiliarias/${agencyId}/invitaciones/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos revocarla.");
    } finally {
      setBusy("");
    }
  }
  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setError("No pudimos copiarlo: seleccioná el enlace y copialo a mano.");
    }
  }

  return (
    <section className="account-panel aa-section" aria-labelledby="aa-claims">
      <div className="aa-section-head">
        <h2 id="aa-claims">Invitaciones</h2>
        {!hasOwner && (
          <button type="button" className="button button-small" disabled={busy === "new"} onClick={create}>
            <Plus size={15} /> Nueva invitación
          </button>
        )}
      </div>
      <p className="aa-help">
        {hasOwner
          ? "La inmobiliaria ya tiene su cuenta: no hacen falta invitaciones."
          : "Cada enlace sirve una vez y vence a los 30 días. Solo se guarda su huella: si se pierde, creá otro."}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {created && (
        <div className="aa-created" role="status">
          <Link2 size={16} aria-hidden="true" />
          <input readOnly value={created.url} aria-label="Enlace de la invitación" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="button button-small button-outline" onClick={copy}>
            <Copy size={15} /> {copied ? "Copiado" : "Copiar"}
          </button>
          <small>Vence el {date(created.expiresAt)}.</small>
        </div>
      )}
      {claims.length ? (
        <ul className="aa-list">
          {claims.map((c) => (
            <li key={c.id}>
              <span className={`dm-status ${c.state === "pending" ? "is-live" : ""}`}>{CLAIM_LABEL[c.state]}</span>
              <span>
                Creada el {date(c.createdAt)} ·{" "}
                {c.state === "used"
                  ? `usada el ${date(c.usedAt!)}`
                  : c.state === "revoked"
                    ? `revocada el ${date(c.revokedAt!)}`
                    : c.state === "expired"
                      ? `venció el ${date(c.expiresAt)}`
                      : `vence el ${date(c.expiresAt)}`}
              </span>
              {c.state === "pending" && (
                <button type="button" className="button button-small button-outline" disabled={busy === c.id} onClick={() => revoke(c.id)}>
                  Revocar
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="aa-empty">Todavía no se creó ninguna invitación.</p>
      )}
    </section>
  );
}

/** Opens the agency's panel as its owner sees it, read only (a support view, audited). */
/**
 * Opens the agency's panel for one hour, audited: read only ("Ver como
 * cliente") or, with act, working as the agency with its owner's
 * permissions ("Entrar como la inmobiliaria"), after confirming.
 */
export function SupportViewButton({
  agencyId,
  small = true,
  quiet = false,
  act = false,
}: {
  agencyId: string;
  small?: boolean;
  quiet?: boolean;
  act?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className={quiet ? "text-link aa-support-link" : `button ${small ? "button-small " : ""}button-outline`}
        disabled={busy}
        title={
          act
            ? "Entra a su panel como si fueras la inmobiliaria, con los permisos de su dueño, por una hora. Los cambios son reales y queda registrado."
            : "Soporte: abre su panel tal como lo ve la inmobiliaria, solo lectura, por una hora. Queda registrado."
        }
        onClick={async () => {
          if (
            act &&
            !window.confirm(
              "Vas a entrar al panel de esta inmobiliaria como su dueño, por una hora. Todo lo que hagas es real: cambia sus datos y las ambientaciones usan sus créditos. ¿Continuar?",
            )
          )
            return;
          setBusy(true);
          setError("");
          try {
            const { url } = await api<{ url: string }>(`/api/admin/inmobiliarias/${agencyId}/soporte`, {
              method: "POST",
              body: JSON.stringify({ mode: act ? "act" : "view" }),
            });
            window.location.assign(url);
          } catch (e) {
            setError(e instanceof Error ? e.message : "No pudimos abrir su panel.");
            setBusy(false);
          }
        }}
      >
        {act ? <UserCog size={15} /> : <Eye size={15} />} {busy ? "Abriendo…" : act ? "Entrar como la inmobiliaria" : "Ver como cliente"}
      </button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** A balance that could not be read is "no disponible", never 0. */
const credits = (n: number | null | undefined, none = "No disponible") => (n === null || n === undefined ? none : `${n} ${n === 1 ? "crédito" : "créditos"}`);

export type CreditTarget = { id: string; name: string; hasOwner: boolean; available: number | null; reserved: number | null };

/**
 * Free credits for one agency (a gift or an adjustment, not a sale), in one
 * dialog for every row. The destination is the server's: the owner's balance
 * when the agency has an account, reserved until it accepts its invitation
 * otherwise. One request key per opening: a double click, a retry after a
 * timeout or another tab never credit twice.
 */
export function CreditsDialog({ target, onClose, onDone }: { target: CreditTarget | null; onClose: () => void; onDone: (text: string) => void }) {
  const uid = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [photos, setPhotos] = useState("5");
  const [reason, setReason] = useState("Regalo de bienvenida");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (target && !d.open) {
      setKey(crypto.randomUUID());
      setError("");
      setConfirming(false);
      d.showModal();
    } else if (!target && d.open) d.close();
  }, [target]);
  const n = Number(photos);
  const valid = Number.isInteger(n) && n >= 1 && n <= 1000 && reason.trim().length >= 5;
  async function submit() {
    if (!target || !valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ applied: "owner" | "pending"; pending: number; replay?: boolean }>(`/api/admin/inmobiliarias/${target.id}/creditos`, {
        method: "POST",
        body: JSON.stringify({ key, photos: n, reason }),
      });
      onDone(
        r.applied === "owner"
          ? `${target.name}: ${n} ${n === 1 ? "crédito sumado" : "créditos sumados"} al saldo de la cuenta.${r.replay ? " (Ya se había hecho: no se repitió.)" : ""}`
          : `${target.name}: quedan ${r.pending} créditos reservados hasta que acepte la invitación.${r.replay ? " (Ya se había hecho: no se repitió.)" : ""}`,
      );
    } catch (e) {
      // A server answer ends this attempt; without an answer the same key is kept, so retrying is safe.
      if (e instanceof ApiError && e.status !== 502 && e.status !== 504) setKey(crypto.randomUUID());
      setError(e instanceof Error ? e.message : "No pudimos cargar los créditos.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} className="aa-dialog" aria-labelledby={`${uid}-title`} onClose={onClose} onCancel={onClose}>
      {target && (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (!confirming) setConfirming(true);
            else void submit();
          }}
        >
          <h2 id={`${uid}-title`}>
            <Gift size={18} aria-hidden="true" /> Créditos de regalo para {target.name}
          </h2>
          <dl className="aa-dialog-balance">
            <div>
              <dt>Saldo disponible</dt>
              <dd>{target.hasOwner ? credits(target.available) : "Sin cuenta todavía"}</dd>
            </div>
            <div>
              <dt>Reservados</dt>
              <dd>{credits(target.reserved)}</dd>
            </div>
          </dl>
          <p className="dm-help">
            Destino:{" "}
            <strong>{target.hasOwner ? "se suman al saldo de la cuenta de la inmobiliaria" : "quedan reservados hasta que acepte la invitación"}</strong>.
            Es un regalo o ajuste registrado con su motivo; no es una venta. 1 crédito = 1 foto ambientada por primera vez.
          </p>
          <label htmlFor={`${uid}-n`}>Cantidad (1 a 1000)</label>
          <input
            id={`${uid}-n`}
            type="number"
            min={1}
            max={1000}
            step={1}
            inputMode="numeric"
            value={photos}
            onChange={(e) => (setPhotos(e.target.value), setConfirming(false))}
            aria-describedby={`${uid}-err`}
          />
          <label htmlFor={`${uid}-r`}>Motivo (queda registrado)</label>
          <input id={`${uid}-r`} maxLength={200} value={reason} onChange={(e) => (setReason(e.target.value), setConfirming(false))} aria-describedby={`${uid}-err`} />
          <p id={`${uid}-err`} className={error ? "inline-error" : "dm-help"} role={error ? "alert" : undefined}>
            {error || (confirming ? `¿Confirmás ${n} ${n === 1 ? "crédito" : "créditos"} para ${target.name}?` : "")}
          </p>
          <div className="aa-dialog-actions">
            <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button className="button button-primary" disabled={!valid || busy}>
              {busy ? "Guardando…" : confirming ? "Confirmar" : "Continuar"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** The detail page's credits: balance and reserved apart, the dialog, and "Aplicar ahora" with a real outcome. */
export function AgencyCredits({ agency, credits: c }: { agency: { id: string; name: string; hasOwner: boolean }; credits: AdminAgencyDetail["credits"] }) {
  const router = useRouter();
  const [target, setTarget] = useState<CreditTarget | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function applyNow() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api<{ applied: number }>(`/api/admin/inmobiliarias/${agency.id}/creditos`, { method: "POST", body: JSON.stringify({ apply: true }) });
      setNotice(r.applied ? `Se aplicaron ${r.applied} créditos al saldo.` : "No había créditos reservados para aplicar.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos aplicar los créditos.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-panel aa-section" aria-labelledby="aa-credits">
      <div className="aa-section-head">
        <h2 id="aa-credits">Créditos</h2>
        <button
          type="button"
          className="button button-small"
          disabled={c.pending === null}
          onClick={() => setTarget({ ...agency, available: c.balance, reserved: c.pending })}
        >
          <Gift size={15} /> Agregar créditos
        </button>
      </div>
      <dl className="aa-dialog-balance">
        <div>
          <dt>Saldo disponible</dt>
          <dd>{agency.hasOwner ? credits(c.balance) : "Sin cuenta todavía"}</dd>
        </div>
        <div>
          <dt>Reservados hasta aceptar la invitación</dt>
          <dd>{credits(c.pending)}</dd>
        </div>
      </dl>
      {c.pending === null && <p className="inline-error">Falta aplicar la migración 202610300001_agency_free_credits.sql en Supabase.</p>}
      {agency.hasOwner && !!c.pending && (
        <p className="aa-pending">
          Hay {credits(c.pending)} reservados sin aplicar.
          <button type="button" className="button button-small button-outline" disabled={busy} onClick={() => void applyNow()}>
            Aplicar ahora
          </button>
        </p>
      )}
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
      <CreditsDialog
        target={target}
        onClose={() => setTarget(null)}
        onDone={(text) => {
          setTarget(null);
          setNotice(text);
          router.refresh();
        }}
      />
    </section>
  );
}

/**
 * One agency's properties for the team, loaded when opened, a page at a
 * time. Only the cover and real counts come; photos and versions are opened
 * in the editor.
 */
export function AgencyProperties({ agencyId, backTo, pageParam = "ppag" }: { agencyId: string; backTo: string; pageParam?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Math.max(1, Number(params.get(pageParam)) || 1);
  const [data, setData] = useState<{ items: PanelProperty[]; total: number } | null>(null);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const PER = 10;
  const load = useCallback(async () => {
    const n = ++seq.current;
    setError("");
    try {
      const d = await api<{ items: PanelProperty[]; total: number }>(`/api/admin/inmobiliarias/${agencyId}/propiedades?pagina=${page}&por=${PER}`);
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : "No pudimos cargar las propiedades.");
    }
  }, [agencyId, page]);
  useEffect(() => {
    void load();
  }, [load]);
  const go = (p: number) => {
    const next = new URLSearchParams(params.toString());
    if (p > 1) next.set(pageParam, String(p));
    else next.delete(pageParam);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  // Opened inside the agency's edit (its banner, its context), coming back here.
  const edit = (id: string, section: string) => `/admin/inmobiliarias/${agencyId}/propiedades/${id}?${new URLSearchParams({ seccion: section, volver: backTo })}`;
  if (error)
    return (
      <div className="ap-retry-row" role="alert">
        <span>{error}</span>
        <button type="button" className="button button-small button-outline" onClick={() => void load()}>
          Reintentar
        </button>
      </div>
    );
  if (!data) return <p role="status">Cargando propiedades…</p>;
  if (!data.items.length) return <p className="aa-empty">Todavía no tiene propiedades.</p>;
  const pages = Math.max(1, Math.ceil(data.total / PER));
  return (
    <div className="aa-props">
      <ul className="aa-prop-list">
        {data.items.map((p) => (
          <li key={p.id}>
            <span className="aa-prop-cover">{p.coverPhotoId ? <img src={adminPhotoUrl(p.coverPhotoId, null, 480)} alt="" loading="lazy" /> : null}</span>
            <span className="aa-prop-main">
              <strong>{p.title}</strong>
              <small>
                {[p.reference ? `Ref. ${p.reference}` : null, p.location, ORIGIN_LABEL[p.origin]].filter(Boolean).join(" · ")}
              </small>
              <small>
                {p.photos} {p.photos === 1 ? "foto" : "fotos"}
                {p.spaces ? ` · ${p.spaces} espacios` : ""} · {p.versions.ready} {p.versions.ready === 1 ? "versión creada" : "versiones creadas"}
                {p.versions.active ? ` · ${p.versions.active} en curso` : ""}
                {p.versions.issues ? ` · ${p.versions.issues} para revisar` : ""}
              </small>
            </span>
            <span className={`dm-status ${p.status === "published" ? "is-live" : ""}`}>{p.status === "published" ? "Publicada" : "Borrador"}</span>
            <span className="aa-prop-actions">
              <Link href={edit(p.id, nextStep(p).section)} className={`button button-small ${nextStep(p).primary ? "" : "button-outline"}`}>
                {nextStep(p).cta} →
              </Link>
            </span>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <nav className="ap-pages" aria-label="Páginas de propiedades">
          <button type="button" className="button button-small button-outline" disabled={page <= 1} onClick={() => go(page - 1)}>
            Anterior
          </button>
          <span>
            {page} de {pages} · {data.total} propiedades
          </span>
          <button type="button" className="button button-small button-outline" disabled={page >= pages} onClick={() => go(page + 1)}>
            Siguiente
          </button>
        </nav>
      )}
    </div>
  );
}

/**
 * The team's agencies, one row each: stage, properties and credits, with
 * one main action (Editar inmobiliaria), three secondary ones (properties,
 * add a property, credits) and the read-only support view as a quiet link.
 * Search, page and the open row live in the URL, so coming back keeps them.
 */
export function AgenciesTable({ items }: { items: AdminAgencyRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get("abierta");
  const [target, setTarget] = useState<CreditTarget | null>(null);
  const [notice, setNotice] = useState("");
  /** This list with one row open: where an agency's pages come back to. */
  const backFor = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("abierta", id);
    next.delete("ppag");
    return `${pathname}?${next}`;
  };
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("abierta", id);
    else next.delete("abierta");
    next.delete("ppag");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };
  // Back from an agency: its row is where it was left.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !openId) return;
    scrolled.current = true;
    const row = document.getElementById(`inmobiliaria-${openId}`);
    row?.scrollIntoView({ block: "center" });
    row?.querySelector<HTMLElement>(".aa-edit")?.focus({ preventScroll: true });
  }, [openId]);
  return (
    <>
      {notice && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}
      <ul className="aa-rows">
        {items.map((a) => {
          const stage = agencyStage(a);
          const open = openId === a.id;
          const pending = a.properties - a.published;
          const back = backFor(a.id);
          return (
            <li key={a.id} className={`account-panel aa-row ${open ? "is-open" : ""}`} id={`inmobiliaria-${a.id}`}>
              <div className="aa-row-main">
                <div className="aa-row-name">
                  <Link href={`/admin/inmobiliarias/${a.id}`}>
                    <strong>{a.name}</strong>
                  </Link>
                  <span className={`dm-status ${stage === "live" ? "is-live" : ""}`}>{STAGE_LABEL[stage]}</span>
                </div>
                <dl className="aa-row-facts">
                  <div>
                    <dt>Propiedades</dt>
                    <dd>
                      {a.properties} · {a.published} publicadas · {pending} en borrador
                    </dd>
                  </div>
                  <div>
                    <dt>Saldo disponible</dt>
                    <dd>{a.hasOwner ? credits(a.available) : "Sin cuenta"}</dd>
                  </div>
                  <div>
                    <dt>Créditos reservados</dt>
                    <dd>{credits(a.reserved)}</dd>
                  </div>
                  {a.partialImports + a.failedImports + a.review > 0 && (
                    <div>
                      <dt>Para revisar</dt>
                      <dd>
                        {[
                          a.partialImports ? `${a.partialImports} importación parcial` : "",
                          a.failedImports ? `${a.failedImports} fallida` : "",
                          a.review ? `${a.review} en revisión técnica` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
              <div className="aa-row-actions">
                <Link href={`/admin/inmobiliarias/${a.id}/editar?${new URLSearchParams({ volver: back })}`} className="button button-small button-primary aa-edit">
                  <PencilLine size={15} /> Editar inmobiliaria →
                </Link>
                <button type="button" className="button button-small button-outline" aria-expanded={open} aria-controls={`props-${a.id}`} onClick={() => setOpen(open ? null : a.id)}>
                  <ChevronDown size={15} className={open ? "aa-rot" : ""} /> {open ? "Ocultar propiedades" : "Ver propiedades"}
                </button>
                <Link
                  href={`/admin/inmobiliarias/${a.id}/propiedades/nueva?${new URLSearchParams({ volver: back })}`}
                  className="button button-small button-outline"
                >
                  <Plus size={15} /> Agregar propiedad
                </Link>
                <button
                  type="button"
                  className="button button-small button-outline"
                  disabled={a.reserved === null}
                  title={a.reserved === null ? "Falta aplicar la migración de créditos" : "Regalo o ajuste con motivo; no es una venta"}
                  onClick={() => setTarget({ id: a.id, name: a.name, hasOwner: a.hasOwner, available: a.available, reserved: a.reserved })}
                >
                  <Gift size={15} /> Créditos
                </button>
                <SupportViewButton agencyId={a.id} quiet />
                <SupportViewButton agencyId={a.id} quiet act />
              </div>
              {open && (
                <div id={`props-${a.id}`} className="aa-row-props">
                  <AgencyProperties agencyId={a.id} backTo={back} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <CreditsDialog
        target={target}
        onClose={() => setTarget(null)}
        onDone={(text) => {
          setTarget(null);
          setNotice(text);
          // The row and the totals come again from the server; filters and the open row stay in the URL.
          router.refresh();
        }}
      />
    </>
  );
}

"use client";
// "Nueva inmobiliaria": the team's record of an agency, on its own. A name is
// enough; contact and site can wait. Possible duplicates are shown before
// creating, never merged. Creating it does not create the client's account,
// does not invite anyone and gives no credits: those stay separate actions.
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { ApiError, api } from "./admin-demos";
import { AdminNav } from "./admin-nav";
import { REASON_LABEL, type DuplicateMatch } from "@/lib/agency/duplicates";

export function NewAgencyForm() {
  const uid = useId();
  const [form, setForm] = useState({ name: "", contactName: "", contactEmail: "", website: "" });
  const [hints, setHints] = useState<DuplicateMatch[]>([]);
  const [blocked, setBlocked] = useState<DuplicateMatch[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string; replay: boolean } | null>(null);
  // One key per form: a double click, a retry or another tab create one agency.
  const key = useRef("");
  useEffect(() => {
    key.current = crypto.randomUUID();
  }, []);
  const nameRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (created) doneRef.current?.focus();
  }, [created]);

  // Possible duplicates while typing (read only, debounced).
  useEffect(() => {
    if (form.name.trim().length < 3 && !form.website.trim() && !form.contactEmail.trim()) {
      setHints([]);
      return;
    }
    const timer = setTimeout(() => {
      const q = new URLSearchParams({ nombre: form.name, web: form.website, email: form.contactEmail });
      api<{ items: DuplicateMatch[] }>(`/api/admin/inmobiliarias/coincidencias?${q}`)
        .then((r) => setHints(r.items))
        .catch(() => setHints([]));
    }, 400);
    return () => clearTimeout(timer);
  }, [form.name, form.website, form.contactEmail]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value });
    setBlocked(null);
  };

  async function submit(confirmDuplicates = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string; name: string; replay: boolean }>("/api/admin/inmobiliarias", {
        method: "POST",
        body: JSON.stringify({ key: key.current, ...form, confirmDuplicates }),
      });
      setCreated(r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && Array.isArray(e.body.duplicates)) setBlocked(e.body.duplicates as DuplicateMatch[]);
      else {
        setError(e instanceof Error ? e.message : "No pudimos crear la inmobiliaria.");
        nameRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  }

  if (created)
    return (
      <div className="account-page container dm-page na-page">
        <section className="account-panel na-done" aria-labelledby={`${uid}-done`}>
          <h1 id={`${uid}-done`} ref={doneRef} tabIndex={-1}>
            {created.name}
            <span className="accent">.</span>
          </h1>
          <p role="status">{created.replay ? "Ya estaba creada con este formulario: no se repitió." : "Ficha administrativa creada."}</p>
          <p className="dm-help">
            No se creó ninguna cuenta ni se envió ninguna invitación, y no tiene créditos. Podés hacerlo cuando quieras desde su ficha.
          </p>
          <div className="na-next">
            <Link href={`/admin/inmobiliarias/${created.id}/propiedades/nueva?${new URLSearchParams({ volver: `/admin/inmobiliarias/${created.id}/editar` })}`} className="button button-primary">
              <Plus size={16} /> Agregar primera propiedad
            </Link>
            <Link href={`/admin/inmobiliarias?abierta=${created.id}`} className="button button-outline">
              Continuar más tarde
            </Link>
          </div>
          <ul className="na-separate">
            <li>
              <strong>Crear la cuenta del cliente:</strong> la crea la inmobiliaria al aceptar una invitación.
            </li>
            <li>
              <strong>Invitar al cliente:</strong> desde su ficha, «Invitaciones».
            </li>
            <li>
              <strong>Regalar créditos:</strong> desde la lista o su ficha, con motivo.
            </li>
          </ul>
        </section>
      </div>
    );

  return (
    <div className="account-page container dm-page na-page">
      <AdminNav current="nueva" />
      <div className="dm-heading">
        <div>
          <span className="eyebrow">Administración / Nueva inmobiliaria</span>
          <h1>
            Creala primero. Completala después<span className="accent">.</span>
          </h1>
          <p>Separar la inmobiliaria de su primera propiedad simplifica el alta.</p>
        </div>
        <Link href="/admin/inmobiliarias" className="button button-outline">
          Cancelar
        </Link>
      </div>
      <div className="np-layout">
        <form
          className="account-panel na-form"
          aria-labelledby={`${uid}-title`}
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          <h2 id={`${uid}-title`}>Datos iniciales</h2>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="dm-fields">
            <label className="dm-wide">
              Nombre comercial *
              <input ref={nameRef} required maxLength={120} value={form.name} placeholder="Nueva inmobiliaria" onChange={set("name")} autoComplete="organization" />
            </label>
            <label>
              Nombre del contacto <small>(opcional, interno)</small>
              <input maxLength={120} value={form.contactName} onChange={set("contactName")} autoComplete="off" />
            </label>
            <label>
              Email de contacto <small>(opcional, interno)</small>
              <input type="email" maxLength={200} value={form.contactEmail} onChange={set("contactEmail")} autoComplete="off" />
            </label>
            <label className="dm-wide">
              Sitio web <small>(opcional)</small>
              <input maxLength={300} inputMode="url" value={form.website} placeholder="inmobiliaria.com.ar" onChange={set("website")} />
            </label>
          </div>
          {hints.length > 0 && !blocked && (
            <div className="na-hints" role="status">
              <p>Puede que ya exista:</p>
              <Matches items={hints} />
            </div>
          )}
          {blocked && (
            <div className="na-hints is-blocking" role="alert">
              <p>
                <strong>Antes de crearla:</strong> estas inmobiliarias se parecen. Si es una de ellas, abrila; nada se fusiona solo.
              </p>
              <Matches items={blocked} />
              <button type="button" className="button button-small button-outline" disabled={busy} onClick={() => void submit(true)}>
                Es otra: crearla igual
              </button>
            </div>
          )}
          <p className="dm-help">Crear la ficha administrativa no crea una cuenta del cliente, no envía invitaciones y no regala créditos.</p>
          <button className="button button-primary" disabled={busy || !form.name.trim()}>
            {busy ? <Loader2 size={16} className="spin" /> : null} Crear inmobiliaria →
          </button>
        </form>
        <aside className="account-panel np-side na-preview" aria-label="Vista de la ficha">
          <p className="pw-kicker">Vista de la ficha</p>
          <span className="na-mark" aria-hidden="true">
            {form.name.trim() ? form.name.trim()[0].toUpperCase() : <Plus size={34} />}
          </span>
          <h2>{form.name.trim() || "Nueva inmobiliaria"}</h2>
          <span className="dm-status">Sin cuenta todavía</span>
          <p>Después podés agregar su primera propiedad, preparar una demo e invitar al cliente.</p>
        </aside>
      </div>
    </div>
  );
}

function Matches({ items }: { items: DuplicateMatch[] }) {
  return (
    <ul>
      {items.map((m) => (
        <li key={m.id}>
          <Link href={`/admin/inmobiliarias/${m.id}`} target="_blank" rel="noreferrer">
            {m.name}
          </Link>{" "}
          <small>({m.reasons.map((r) => REASON_LABEL[r]).join(", ")})</small>
        </li>
      ))}
    </ul>
  );
}

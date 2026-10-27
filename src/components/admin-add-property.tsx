"use client";
// "Agregar propiedad" from an agency's context: the agency is already chosen
// (and checked on the server against this tab's edit context). One way in at
// a time, pasted link or typed by hand, then review, then a draft. Reading or
// importing never stages photos and never uses AI credits.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { api } from "./admin-demos";
import { AdminEditBanner, useAgencyEdit } from "./admin-edit-context";
import { ImportProperty } from "./agency-panel";
import { optimizePhoto } from "@/lib/images";
import { safeReturn } from "@/lib/agency/shared";

type Method = "enlace" | "manual";
const STEPS = ["Traer la propiedad", "Revisar datos y fotos", "Guardar borrador"] as const;

export function AgencyAddProperty({ agency }: { agency: { id: string; name: string; hasOwner: boolean } }) {
  const edit = useAgencyEdit(agency.id);
  const params = useSearchParams();
  const back = safeReturn(params.get("volver"), `/admin/inmobiliarias/${agency.id}/editar`);
  const [method, setMethod] = useState<Method>(params.get("modo") === "manual" ? "manual" : "enlace");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const openPath = useCallback(
    (id: string) => `/admin/inmobiliarias/${agency.id}/propiedades/${id}?${new URLSearchParams({ seccion: "fotos", volver: back })}`,
    [agency.id, back],
  );
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (m: Method) => {
    setMethod(m);
    setStep(1);
  };
  return (
    <div className="account-page container dm-page np-page">
      <AdminEditBanner agencyName={agency.name} edit={edit} backHref={back} backLabel="Cancelar y volver" exitHref={`/admin/inmobiliarias?abierta=${agency.id}`} />
      <div className="dm-heading">
        <div>
          <span className="eyebrow">{agency.name} / Nueva propiedad</span>
          <h1>
            Empezá con una publicación<span className="accent">.</span>
          </h1>
          <p>La inmobiliaria ya está elegida. No necesitás cargar todo para empezar.</p>
        </div>
      </div>
      <ol className="np-steps" aria-label="Pasos">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={step === i + 1 ? "step" : undefined} className={step > i + 1 ? "is-done" : ""}>
            {i + 1} · {s}
          </li>
        ))}
      </ol>
      <div className="np-layout">
        <section className="account-panel np-main">
          <div className="np-methods" role="tablist" aria-label="Cómo cargarla">
            {(["enlace", "manual"] as Method[]).map((m, i) => (
              <button
                key={m}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`np-tab-${m}`}
                aria-selected={method === m}
                aria-controls={`np-panel-${m}`}
                tabIndex={method === m ? 0 : -1}
                disabled={step === 3}
                onClick={() => pick(m)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  e.preventDefault();
                  const n = (i + 1) % 2;
                  pick(n === 0 ? "enlace" : "manual");
                  tabs.current[n]?.focus();
                }}
              >
                {m === "enlace" ? "Pegar enlace" : "Cargar a mano"}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`np-panel-${method}`} aria-labelledby={`np-tab-${method}`}>
            {!edit.ready ? (
              <p role="status">{edit.state.status === "expired" ? "La edición venció: renovala arriba para seguir." : "Abriendo la edición…"}</p>
            ) : method === "enlace" ? (
              <>
                <h2>¿Dónde está publicada?</h2>
                <p className="dm-help">Pegá el enlace de la ficha. Primero vas a revisar lo que encontramos.</p>
                <ImportProperty
                  endpoint={`/api/admin/inmobiliarias/${agency.id}/importar`}
                  openPath={openPath}
                  allowMany={false}
                  where="esta inmobiliaria"
                  onStep={setStep}
                />
              </>
            ) : (
              <ManualProperty agencyId={agency.id} openPath={openPath} onStep={setStep} />
            )}
          </div>
          <p className="np-foot">Leer o importar no crea ambientaciones ni consume créditos de IA.</p>
        </section>
        <aside className="account-panel np-side">
          <p className="pw-kicker">Se agrega a</p>
          <h2>{agency.name}</h2>
          <span className="dm-status">{agency.hasOwner ? "Cuenta existente" : "Sin cuenta todavía"}</span>
          <h3>{method === "enlace" ? "Después de leer el enlace" : "Después de guardar"}</h3>
          <p>
            {method === "enlace"
              ? "Revisás título, precio, ubicación y fotos. Lo que no se encontró queda señalado; nada se inventa."
              : "Se crea el borrador con lo que cargaste y seguís con las fotos en el editor."}
          </p>
          <p>La ficha empieza en borrador. Podés completarla más tarde.</p>
          <Link href={back} className="text-link">
            Cancelar y volver
          </Link>
        </aside>
      </div>
    </div>
  );
}

type Upload = { name: string; state: "waiting" | "uploading" | "done" | "error"; error?: string };

/**
 * A property typed by hand: only the title is required. Saved once per
 * request key (a double click or a retry creates one draft); the photos
 * chosen here are uploaded right after, each one saying how it went.
 */
function ManualProperty({ agencyId, openPath, onStep }: { agencyId: string; openPath: (id: string) => string; onStep: (s: 1 | 2 | 3) => void }) {
  const uid = useId();
  const router = useRouter();
  const [form, setForm] = useState({ title: "", location: "", operation: "", price: "", listing_url: "", description: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [made, setMade] = useState<string | null>(null);
  // One key per draft: kept until it is created, so a retry after a lost answer creates the same one.
  const key = useRef(crypto.randomUUID());
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value });
    onStep(2);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    onStep(3);
    try {
      const r =
        made ??
        (
          await api<{ id: string; settingsSaved?: boolean }>(`/api/admin/inmobiliarias/${agencyId}/propiedades`, {
            method: "POST",
            body: JSON.stringify({
              key: key.current,
              property: { title: form.title, location: form.location, listing_url: form.listing_url, description: form.description },
              settings: { operation: form.operation, price: form.price },
            }),
          })
        ).id;
      setMade(r);
      let failed = 0;
      const list = files;
      setUploads(list.map((f) => ({ name: f.name, state: "waiting" })));
      for (const [i, file] of list.entries()) {
        setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: "uploading" } : x)));
        try {
          const { file: optimized } = await optimizePhoto(file);
          const body = new FormData();
          body.set("image", optimized);
          await api(`/api/admin/demos/${r}/photos`, { method: "POST", body });
          setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: "done" } : x)));
        } catch (err) {
          failed++;
          setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: "error", error: err instanceof Error ? err.message : "No se pudo subir." } : x)));
        }
      }
      if (failed) {
        setError(`El borrador se guardó, pero ${failed} ${failed === 1 ? "foto no se pudo subir" : "fotos no se pudieron subir"}. Podés agregarlas desde el editor.`);
        setFiles([]);
        setSaving(false);
        return;
      }
      router.push(openPath(r));
    } catch (err) {
      // Nothing typed is lost; the same key is kept for the retry.
      setError(err instanceof Error ? err.message : "No pudimos guardar el borrador.");
      setSaving(false);
      onStep(2);
    }
  }

  return (
    <form className="np-manual" onSubmit={save} aria-describedby={`${uid}-help`}>
      <h2>Datos de la propiedad</h2>
      <p id={`${uid}-help`} className="dm-help">
        Solo el título es obligatorio. Lo demás podés completarlo después.
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="dm-fields">
        <label className="dm-wide">
          Título *
          <input required maxLength={160} value={form.title} placeholder="Departamento de 3 ambientes con balcón" onChange={set("title")} disabled={Boolean(made)} />
        </label>
        <label>
          Ubicación o barrio
          <input maxLength={160} value={form.location} placeholder="Güemes, Mar del Plata" onChange={set("location")} disabled={Boolean(made)} />
        </label>
        <label>
          Operación
          <input maxLength={40} value={form.operation} placeholder="Venta, Alquiler…" onChange={set("operation")} disabled={Boolean(made)} />
        </label>
        <label>
          Precio
          <input maxLength={40} value={form.price} placeholder="USD 120.000" onChange={set("price")} disabled={Boolean(made)} />
        </label>
        <label>
          Enlace de la publicación <small>(opcional)</small>
          <input maxLength={500} inputMode="url" value={form.listing_url} placeholder="https://…" onChange={set("listing_url")} disabled={Boolean(made)} />
        </label>
        <label className="dm-wide">
          Descripción breve
          <textarea rows={3} maxLength={1000} value={form.description} onChange={set("description")} disabled={Boolean(made)} />
        </label>
        <label className="dm-wide">
          Fotos <small>(opcional: JPG, PNG o WebP; también podés subirlas después)</small>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={saving}
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []));
              onStep(2);
            }}
          />
        </label>
      </div>
      {files.length > 0 && !uploads.length && (
        <p className="dm-help">
          {files.length} {files.length === 1 ? "foto elegida" : "fotos elegidas"}: se suben después de guardar el borrador.
        </p>
      )}
      {uploads.length > 0 && (
        <ul className="dm-uploads" aria-live="polite">
          {uploads.map((u, i) => (
            <li key={`${u.name}-${i}`} className={`is-${u.state}`}>
              {u.state === "uploading" && <Loader2 size={15} className="spin" />}
              {u.state === "done" && <Check size={15} />}
              {u.state === "error" && <X size={15} />}
              <span>{u.name}</span>
              {u.error && <em>{u.error}</em>}
            </li>
          ))}
        </ul>
      )}
      {made && !saving ? (
        <Link href={openPath(made)} className="button button-primary">
          Abrir el borrador →
        </Link>
      ) : (
        <button className="button button-primary" disabled={saving || !form.title.trim()}>
          {saving ? <Loader2 size={16} className="spin" /> : null} {saving ? "Guardando…" : "Guardar borrador y continuar →"}
        </button>
      )}
    </form>
  );
}

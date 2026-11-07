"use client";
// «Crear demostración interactiva» for an agency, by the team: the agency is
// created first (Nueva inmobiliaria), then this same flow of the agency's own
// panel opens inside the tab's signed edit context. The three ways in
// (existing property, listing URL, photos) and the three-tab editor are the
// panel's own: one infrastructure, tested by the team before the agencies use it.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "./admin-demos";
import { AdminEditBanner, useAgencyEdit } from "./admin-edit-context";
import { StartPicker } from "./start-picker";
import { safeReturn } from "@/lib/agency/shared";
import type { AgencyRow } from "@/lib/demos/shared";

export function AgencyStartDemo({ agency }: { agency: { id: string; name: string; hasOwner: boolean } }) {
  const edit = useAgencyEdit(agency.id);
  const params = useSearchParams();
  const back = safeReturn(params.get("volver"), `/admin/inmobiliarias/${agency.id}/editar`);
  const created = params.get("creada") === "1";
  // Closed without choosing: the picker can be opened again from here.
  const [open, setOpen] = useState(true);
  const ready = edit.state.status === "active" || edit.state.status === "expired";
  return (
    <div className="account-page container dm-page np-page">
      <AdminEditBanner agencyName={agency.name} edit={edit} backHref={back} backLabel="Cancelar y volver" exitHref={`/admin/inmobiliarias?abierta=${agency.id}`} />
      <div className="dm-heading">
        <div>
          <span className="eyebrow">{agency.name} / Nueva demostración</span>
          <h1>
            Crear demostración interactiva<span className="accent">.</span>
          </h1>
          <p>El mismo flujo que usa la inmobiliaria en su panel: elegí cómo empezar y seguí en el editor.</p>
        </div>
      </div>
      {created && (
        <p className="inline-notice" role="status">
          Inmobiliaria creada. No se creó ninguna cuenta ni se envió ninguna invitación, y no tiene créditos: eso se hace desde su ficha.
        </p>
      )}
      {edit.state.status === "starting" && <p role="status">Abriendo la edición…</p>}
      {ready && !open && (
        <div className="na-next">
          <button type="button" className="button button-primary" onClick={() => setOpen(true)}>
            Elegir cómo empezar
          </button>
          <Link href={`/admin/inmobiliarias/${agency.id}/propiedades/nueva?${new URLSearchParams({ modo: "manual", volver: back })}`} className="button button-outline">
            Cargar los datos a mano
          </Link>
          <Link href={back} className="button button-outline">
            Continuar más tarde
          </Link>
        </div>
      )}
      {/* Opened once the context is there: every request of the picker carries it. */}
      {ready && open && (
        <StartPicker
          tool="demo"
          existingCount={0}
          team={{ agencyId: agency.id, agencyName: agency.name, back }}
          onClose={() => setOpen(false)}
        />
      )}
      {ready && <PreloadListings agencyId={agency.id} />}
      <p className="dm-help">Importar o subir fotos no genera imágenes ni consume créditos.</p>
    </div>
  );
}

const PRELOADS = 2;
type Preload = { url: string; state: "idle" | "saving" | "done" | "error"; text?: string };

/**
 * Two more of the agency's listings left in its panel next to its demo: saved
 * with the listing's data and its photos still to import («Lista para
 * importar»), so the agency imports each one with one click. Each link is
 * saved once (its request key); the same listing twice is not a second one.
 */
export function PreloadListings({ agencyId }: { agencyId: string }) {
  const [rows, setRows] = useState<Preload[]>(() => Array.from({ length: PRELOADS }, () => ({ url: "", state: "idle" })));
  const keys = useRef<string[]>(Array.from({ length: PRELOADS }, () => crypto.randomUUID()));
  const update = (i: number, patch: Partial<Preload>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const busy = rows.some((r) => r.state === "saving");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    for (const [i, row] of rows.entries()) {
      if (!row.url.trim() || row.state === "done") continue;
      update(i, { state: "saving", text: "Leyendo la publicación…" });
      try {
        const made = await api<{ title?: string; photosTotal: number }>(`/api/admin/inmobiliarias/${agencyId}/importar`, {
          method: "POST",
          body: JSON.stringify({ url: row.url.trim(), key: keys.current[i] }),
        });
        update(i, {
          state: "done",
          text: `${made.title ?? "Propiedad"}: lista para importar (${made.photosTotal} ${made.photosTotal === 1 ? "foto" : "fotos"}).`,
        });
      } catch (err) {
        const body = err instanceof ApiError ? err.body : null;
        // Another attempt gets a new key: a failed one is not replayed.
        keys.current[i] = crypto.randomUUID();
        update(i, {
          state: body?.duplicateOf ? "done" : "error",
          text: body?.duplicateOf ? "Ya estaba en su panel." : err instanceof Error ? err.message : "No pudimos leer la publicación.",
        });
      }
    }
  }
  return (
    <section className="account-panel np-preload" aria-labelledby="np-preload-title">
      <h2 id="np-preload-title">Dejar 2 propiedades precargadas</h2>
      <p className="dm-help">
        Pegá dos publicaciones más de la inmobiliaria. Quedan en su panel, en «Mis propiedades», con sus datos cargados y las fotos sin importar: las importa con
        un clic. No se ambienta nada ni se usan créditos.
      </p>
      <form onSubmit={save} className="np-preload-form">
        {rows.map((row, i) => (
          <label key={i}>
            Publicación {i + 1}
            <input
              type="text"
              inputMode="url"
              maxLength={500}
              placeholder="https://www.zonaprop.com.ar/propiedades/…"
              value={row.url}
              disabled={row.state === "saving" || row.state === "done"}
              onChange={(e) => update(i, { url: e.target.value, state: "idle", text: undefined })}
            />
            {row.text && (
              <small className={row.state === "error" ? "ap-error-text" : ""} role={row.state === "error" ? "alert" : "status"}>
                {row.text}
              </small>
            )}
          </label>
        ))}
        <button className="button button-outline" disabled={busy || !rows.some((r) => r.url.trim() && r.state !== "done")}>
          {busy ? "Guardando…" : "Dejarlas precargadas"}
        </button>
      </form>
    </section>
  );
}

/**
 * «Nueva demo» from the team's list of demos: first the agency (one already
 * loaded, or a new one), then the panel's own flow for it.
 */
export function DemoAgencyChooser() {
  const [agencies, setAgencies] = useState<AgencyRow[] | null>(null);
  const [agencyId, setAgencyId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ agencies: AgencyRow[] }>("/api/admin/demos")
      .then((d) => setAgencies(d.agencies))
      .catch((e) => setError(e instanceof Error ? e.message : "No pudimos cargar las inmobiliarias."));
  }, []);
  const next = agencyId
    ? `/admin/inmobiliarias/${agencyId}/propiedades/nueva?${new URLSearchParams({ volver: `/admin/inmobiliarias/${agencyId}/editar` })}`
    : null;
  return (
    <div className="account-page container dm-page dm-narrow">
      <Link href="/admin/inmobiliarias" className="text-link">
        ← Inmobiliarias
      </Link>
      <h1>
        Nueva demo<span className="accent">.</span>
      </h1>
      <p>Primero la inmobiliaria; después, el mismo flujo de «Crear demostración interactiva» de su panel.</p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <section className="account-panel">
        <h2>Una inmobiliaria que ya cargamos</h2>
        {!agencies && !error && <p role="status">Cargando inmobiliarias…</p>}
        {agencies && agencies.length > 0 && (
          <form
            className="na-next"
            onSubmit={(e) => {
              e.preventDefault();
              if (next) window.location.assign(next);
            }}
          >
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
            <button className="button button-primary" disabled={!next}>
              Continuar
            </button>
          </form>
        )}
        {agencies && !agencies.length && <p className="dm-help">Todavía no hay inmobiliarias cargadas.</p>}
      </section>
      <section className="account-panel">
        <h2>Una inmobiliaria nueva</h2>
        <p className="dm-help">Se crea su ficha (sin cuenta, sin invitación, sin créditos) y enseguida seguís con su primera demo.</p>
        <Link href="/admin/inmobiliarias/nueva" className="button button-outline">
          Crear inmobiliaria
        </Link>
      </section>
    </div>
  );
}

"use client";
// «Dejar 2 propiedades precargadas»: en «Crear demostración» y en el editor de la demo del equipo.
import { useRef, useState } from "react";
import { ApiError, api } from "./admin-demos";

const PRELOADS = 2;
type Preload = { url: string; state: "idle" | "saving" | "done" | "error"; text?: string };

/**
 * Two more of the agency's listings left in its panel next to its demo: saved
 * with the listing's data and its photos still to import («Lista para
 * importar»), so the agency imports each one with one click. Each link is
 * saved once (its request key); the same listing twice is not a second one.
 */
export function PreloadListings({ agencyId, exclude = [] }: { agencyId: string; /** Publicaciones que no se eligen (la de la demo). */ exclude?: string[] }) {
  const [rows, setRows] = useState<Preload[]>(() => Array.from({ length: PRELOADS }, () => ({ url: "", state: "idle" })));
  const keys = useRef<string[]>(Array.from({ length: PRELOADS }, () => crypto.randomUUID()));
  const update = (i: number, patch: Partial<Preload>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const [finding, setFinding] = useState("");
  const [findError, setFindError] = useState("");
  const busy = rows.some((r) => r.state === "saving") || Boolean(finding);
  /** Two listings of its own site with interior photos, chosen on the server, then left preloaded like pasted ones. */
  async function findOnSite() {
    const free = rows.map((r, i) => (r.state === "done" ? -1 : i)).filter((i) => i >= 0);
    if (!free.length) return;
    setFinding("Buscando en su sitio publicaciones con fotos interiores…");
    try {
      const { candidates } = await api<{ candidates: { url: string; title: string | null; photos: number }[] }>(`/api/admin/inmobiliarias/${agencyId}/precargas`, {
        method: "POST",
        body: JSON.stringify({ exclude: [...exclude, ...rows.map((r) => r.url.trim()).filter(Boolean)] }),
      });
      if (!candidates.length) throw new Error("No encontramos publicaciones con fotos interiores en su sitio: pegalas a mano.");
      const next = rows.map((r) => ({ ...r }));
      candidates.slice(0, free.length).forEach((c, j) => (next[free[j]] = { url: c.url, state: "idle", text: `${c.title ?? "Publicación"} · ${c.photos} fotos` }));
      setRows(next);
      setFinding("");
      await save(undefined, next);
    } catch (e) {
      setFinding("");
      setFindError(e instanceof Error ? e.message : "No pudimos buscar en su sitio.");
    }
  }
  async function save(e?: React.FormEvent, current = rows) {
    e?.preventDefault();
    setFindError("");
    for (const [i, row] of current.entries()) {
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
        Dos publicaciones más de la inmobiliaria: elegilas solas en su sitio o pegalas. Quedan en su panel, en «Mis propiedades», con sus datos cargados y las
        fotos sin importar: las importa con un clic. No se ambienta nada ni se usan créditos.
      </p>
      <div className="np-preload-auto">
        <button type="button" className="button button-small button-primary" disabled={busy || rows.every((r) => r.state === "done")} onClick={() => void findOnSite()}>
          {finding ? "Buscando…" : "Elegir 2 en su sitio"}
        </button>
        {finding && <small role="status">{finding}</small>}
        {findError && (
          <small className="ap-error-text" role="alert">
            {findError}
          </small>
        )}
      </div>
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


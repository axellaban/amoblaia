"use client";
// What an import read from the listing, field by field, and the photo sync
// shared by "new demo from URL" and "complete from the listing".
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FieldStatus, ImportedDemo, ReportRow } from "@/lib/demos/import";
import type { EditorPhoto } from "@/lib/demos/shared";
import { api } from "./admin-demos";

const STATUS: Record<FieldStatus, string> = {
  found: "Encontrado",
  missing: "No publicado",
  error: "No se pudo leer",
  conflict: "Contradictorio",
};

/** Rows that need someone: required and not found, or contradictory. */
export const exceptions = (report: ReportRow[]) =>
  report.filter((r) => r.status === "conflict" || (r.required && r.status !== "found"));

export function ImportReport({ report }: { report: ReportRow[] }) {
  return (
    <table className="dm-report">
      <thead>
        <tr>
          <th scope="col">Dato</th>
          <th scope="col">Estado</th>
          <th scope="col">Valor</th>
        </tr>
      </thead>
      <tbody>
        {report.map((r) => (
          <tr key={r.field} className={`is-${r.status}`}>
            <th scope="row">
              {r.field}
              {r.required && <span className="dm-report-req"> · imprescindible</span>}
            </th>
            <td>
              <span className={`dm-status dm-status-${r.status}`}>{STATUS[r.status]}</span>
            </td>
            <td>
              {r.value ?? "—"}
              {r.note && <small>{r.note}</small>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A compact look at the demo the import would create. */
export function ImportPreview({ data }: { data: ImportedDemo }) {
  const agent = data.agent;
  return (
    <div className="dm-preview">
      {data.agency.logoUrl && (
        <img className="dm-preview-logo" src={data.agency.logoUrl} alt={data.agency.name ?? "Logo"} />
      )}
      <div className="dm-preview-head">
        {data.reference && (
          <small>
            {data.reference}
            {data.operation ? ` · ${data.operation}` : ""}
          </small>
        )}
        <strong>{data.title}</strong>
        {data.location && <span>{data.location}</span>}
        {data.features && <span>{data.features}</span>}
        <b>{data.priceConflict ? "Precio a confirmar" : (data.price ?? "Sin precio publicado")}</b>
      </div>
      {data.images.length > 0 && (
        <div className="dm-preview-photos" aria-label={`${data.images.length} fotos de la propiedad`}>
          {data.images.slice(0, 8).map((src) => (
            <img key={src} src={src} alt="" loading="lazy" />
          ))}
          {data.images.length > 8 && <span>+{data.images.length - 8}</span>}
        </div>
      )}
      {data.facts.length > 0 && (
        <p className="dm-help">{data.facts.map((f) => `${f.value} ${f.label}`).join(" · ")}</p>
      )}
      {agent && (
        <p className="dm-help">
          Agente: <strong>{agent.name}</strong>
          {[agent.email, agent.whatsapp && `WhatsApp ${agent.whatsapp}`, agent.phone && agent.phone !== agent.whatsapp && agent.phone]
            .filter(Boolean)
            .map((v) => ` · ${v}`)
            .join("")}
        </p>
      )}
      {data.description && <p className="dm-preview-text">{data.description.slice(0, 280)}{data.description.length > 280 ? "…" : ""}</p>}
    </div>
  );
}

/** The listing's own photos in a demo: added if missing (the ones already there keep their stagings), in the listing's order. */
export async function syncPhotos(base: string, images: string[], onStatus: (text: string) => void) {
  const ids: string[] = [];
  let failed = 0;
  for (const [i, url] of images.entries()) {
    onStatus(`Fotos de la publicación: ${i + 1} de ${images.length}…`);
    try {
      const { id } = await api<{ id: string }>(`${base}/photos`, {
        method: "POST",
        body: JSON.stringify({ url, reuse: true }),
      });
      if (!ids.includes(id)) ids.push(id);
    } catch {
      failed++;
    }
  }
  return { ids, failed };
}

/** Photos imported from another listing of the same site (their file starts with another property id). */
export function foreignPhotos(photos: EditorPhoto[], propertyId: string | null) {
  if (!propertyId) return [];
  return photos.filter((p) => {
    const id = p.source?.match(/^(\d{4,})_/)?.[1];
    return Boolean(id && id !== propertyId);
  });
}

type Preview = ImportedDemo & { listingUrl: string; existingAgency: string | null };

/**
 * Paste the URL → the page is read → a full preview with every field and its
 * state → only the real exceptions ask for a decision → the demo is created
 * with all of it, then the property's own photos are imported in order.
 */
export function ImportFromListing() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [price, setPrice] = useState("");
  const [contact, setContact] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const busy = Boolean(status);
  const missingContact = preview?.report.some((r) => r.field === "Contacto para consultas" && r.status !== "found");

  async function read(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPreview(null);
    setStatus("Leyendo la publicación…");
    try {
      const data = await api<Preview>("/api/admin/demos/importar", {
        method: "POST",
        body: JSON.stringify({ url, preview: true }),
      });
      setPreview(data);
      setPrice(data.priceOptions[0] ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos leer la publicación.");
    } finally {
      setStatus("");
    }
  }

  async function create() {
    if (!preview) return;
    setError("");
    setStatus("Creando la demo…");
    try {
      const made = await api<{ id: string; title: string; images: string[] }>("/api/admin/demos/importar", {
        method: "POST",
        body: JSON.stringify({
          url: preview.listingUrl,
          price: preview.priceConflict ? price || null : undefined,
          contact: missingContact && contact.trim() ? contact.trim() : undefined,
        }),
      });
      await syncPhotos(`/api/admin/demos/${made.id}`, made.images, (t) => setStatus(`${made.title}. ${t}`));
      router.push(`/admin/demos/${made.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear la demo.");
      setStatus("");
    }
  }

  const pending = preview ? exceptions(preview.report) : [];
  return (
    <div className="account-panel dm-import">
      <h2>Desde la publicación</h2>
      <p className="dm-help">
        Pegá la URL de la ficha en la web de la inmobiliaria. Leemos todos los datos, el agente, el logo y
        las fotos de esa propiedad, y te mostramos qué encontramos antes de crear la demo.
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <form className="dm-import-row" onSubmit={read}>
        <input
          required
          type="text"
          inputMode="url"
          maxLength={500}
          placeholder="https://inmobiliaria.com.ar/propiedad/…"
          aria-label="URL de la ficha de la propiedad"
          value={url}
          disabled={busy}
          onChange={(e) => {
            setUrl(e.target.value);
            setPreview(null);
          }}
        />
        <button className={`button ${preview ? "button-outline" : "button-primary"}`} disabled={busy || !url.trim()}>
          {status && !preview ? "Leyendo…" : preview ? "Volver a leer" : "Importar"}
        </button>
      </form>
      {status && (
        <p className="dm-help" role="status" aria-live="polite">
          {status}
        </p>
      )}
      {preview && (
        <div className="dm-import-result">
          <ImportPreview data={preview} />
          {preview.existingAgency && (
            <p className="dm-help">
              Se agrega a <strong>{preview.existingAgency}</strong> (ya cargada): solo completamos su logo y
              contacto si faltan.
            </p>
          )}
          {pending.length > 0 ? (
            <div className="dm-exceptions" role="group" aria-label="Para revisar antes de crear">
              <h3>Para revisar</h3>
              {pending.map((r) => (
                <div key={r.field} className="dm-exception">
                  <strong>{r.field}</strong>
                  <p>{r.note}</p>
                  {r.field === "Precio" && preview.priceOptions.length > 1 && (
                    <div className="dm-choice" role="radiogroup" aria-label="Precio a mostrar">
                      {preview.priceOptions.map((o) => (
                        <label key={o}>
                          <input type="radio" name="dm-price" checked={price === o} onChange={() => setPrice(o)} />
                          {o}
                        </label>
                      ))}
                      <label>
                        <input type="radio" name="dm-price" checked={price === ""} onChange={() => setPrice("")} />
                        Mostrar «Consultar precio»
                      </label>
                    </div>
                  )}
                  {r.field === "Contacto para consultas" && (
                    <input
                      type="text"
                      maxLength={120}
                      placeholder="WhatsApp de la inmobiliaria, con código de país"
                      aria-label="Contacto para consultas"
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="inline-notice">Encontramos todo lo imprescindible. No hace falta cargar nada a mano.</p>
          )}
          <details className="dm-report-wrap">
            <summary>Ver todos los datos importados ({preview.report.filter((r) => r.status === "found").length} encontrados)</summary>
            <ImportReport report={preview.report} />
          </details>
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void create()}>
            {busy ? "Creando…" : `Crear demo con ${preview.images.length} fotos`}
          </button>
        </div>
      )}
    </div>
  );
}

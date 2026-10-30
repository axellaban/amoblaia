"use client";
// What an import read from the listing, field by field, and the photo sync
// shared by "new demo from URL" and "complete from the listing".
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FieldStatus, ImportedDemo, ReportRow } from "@/lib/demos/import";
import type { EditorPhoto } from "@/lib/demos/shared";
import { AgencyWhatsappField, api } from "./admin-demos";

const STATUS: Record<FieldStatus, string> = {
  found: "Encontrado",
  missing: "No publicado",
  error: "No se pudo leer",
  conflict: "Contradictorio",
};

/** Rows that need someone: required and not found, or contradictory. */
export const exceptions = (report: ReportRow[]) =>
  // The map has its own review (MapReview).
  report.filter((r) => r.field !== "Mapa" && (r.status === "conflict" || (r.required && r.status !== "found")));

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

export type MapChoice = {
  mode: "detected" | "manual" | "none";
  /** Which of the suggested places, when the map needs a review. */
  place: number;
  precision: "zone" | "approx" | "exact";
  link: string;
  lat: string;
  lng: string;
};
/** Found: use it. Needs a review: nothing until a person picks a place. Not found: nothing. */
export const initialMapChoice = (data: ImportedDemo): MapChoice => ({
  mode: data.mapStatus === "found" && data.map ? "detected" : "none",
  place: 0,
  precision: data.map && data.map.precision !== "none" ? data.map.precision : "approx",
  link: "",
  lat: "",
  lng: "",
});
/** What the server receives: nothing for a map used as found, otherwise the person's choice. */
export function mapOverride(data: ImportedDemo, c: MapChoice): Record<string, unknown> | undefined {
  if (c.mode === "none") return { precision: "none" };
  if (c.mode === "manual") return c.link.trim() ? { precision: c.precision, link: c.link.trim() } : { precision: c.precision, lat: c.lat, lng: c.lng };
  const place = data.mapStatus === "review" ? data.mapPlaces[c.place] : data.map;
  if (!place) return { precision: "none" };
  if (data.mapStatus === "found" && data.map && c.precision === data.map.precision) return undefined;
  return { precision: c.precision, lat: place.lat, lng: place.lng };
}

const PRECISION_LABELS = {
  zone: "Zona (área amplia, sin punto)",
  approx: "Aproximada (área chica, sin punto)",
  exact: "Exacta (con marcador)",
} as const;
const osm = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

/**
 * The map of an import: detected, to review or not found, with its source
 * and a link to check it; a place can be picked, pasted as a map link or
 * typed, and the property can always be saved without a map.
 */
export function MapReview({ data, value, onChange }: { data: ImportedDemo; value: MapChoice; onChange: (v: MapChoice) => void }) {
  const row = data.report.find((r) => r.field === "Mapa");
  const status = data.mapStatus === "found" ? "Mapa detectado" : data.mapStatus === "review" ? "Requiere revisión" : "No encontrado";
  const set = (patch: Partial<MapChoice>) => onChange({ ...value, ...patch });
  const choices = data.mapStatus === "review" ? data.mapPlaces : data.map ? [data.map] : [];
  return (
    <fieldset className="dm-mapreview">
      <legend>
        Mapa <span className={`dm-status dm-status-${data.mapStatus === "found" ? "found" : data.mapStatus === "review" ? "conflict" : "missing"}`}>{status}</span>
      </legend>
      {row?.value && <p className="dm-help">{row.value}</p>}
      {data.mapNote && <p className="dm-help">{data.mapNote}</p>}
      <div className="dm-choice dm-choice-column" role="radiogroup" aria-label="Mapa de la propiedad">
        {choices.map((p, i) => (
          <label key={`${p.lat},${p.lng}`}>
            <input
              type="radio"
              name="dm-map-mode"
              checked={value.mode === "detected" && value.place === i}
              onChange={() => set({ mode: "detected", place: i })}
            />
            <span>
              {data.mapStatus === "review" ? `Usar la ubicación ${i + 1}` : "Usar la ubicación detectada"} ({Number(p.lat).toFixed(4)}, {Number(p.lng).toFixed(4)}) ·{" "}
              <a href={osm(Number(p.lat), Number(p.lng))} target="_blank" rel="noopener noreferrer">
                ver en el mapa
              </a>
            </span>
          </label>
        ))}
        <label>
          <input type="radio" name="dm-map-mode" checked={value.mode === "manual"} onChange={() => set({ mode: "manual" })} />
          <span>Cargar otra ubicación</span>
        </label>
        <label>
          <input type="radio" name="dm-map-mode" checked={value.mode === "none"} onChange={() => set({ mode: "none" })} />
          <span>Sin mapa por ahora (se muestra solo el texto de la ubicación)</span>
        </label>
      </div>
      {value.mode === "manual" && (
        <div className="dm-mapreview-manual">
          <label>
            Enlace del mapa (Google Maps, OpenStreetMap, Waze, Apple Maps)
            <input value={value.link} inputMode="url" placeholder="https://www.google.com/maps/place/…" onChange={(e) => set({ link: e.target.value })} />
          </label>
          <span className="dm-help">o las coordenadas:</span>
          <label>
            Latitud
            <input value={value.lat} inputMode="decimal" placeholder="-38.0055" onChange={(e) => set({ lat: e.target.value })} />
          </label>
          <label>
            Longitud
            <input value={value.lng} inputMode="decimal" placeholder="-57.5426" onChange={(e) => set({ lng: e.target.value })} />
          </label>
        </div>
      )}
      {value.mode !== "none" && (
        <label className="dm-mapreview-precision">
          Qué mostrar
          <select value={value.precision} onChange={(e) => set({ precision: e.target.value as MapChoice["precision"] })}>
            {(Object.keys(PRECISION_LABELS) as MapChoice["precision"][]).map((p) => (
              <option key={p} value={p}>
                {PRECISION_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      )}
    </fieldset>
  );
}

/** The listing's own photos in a demo: added if missing (the ones already there keep their stagings), in the listing's order. */
export async function syncPhotos(base: string, images: string[], onStatus: (text: string) => void) {
  const ids: string[] = [];
  const done: string[] = [];
  const failedUrls: string[] = [];
  for (const [i, url] of images.entries()) {
    onStatus(`Fotos de la publicación: ${i + 1} de ${images.length}…`);
    try {
      const { id } = await api<{ id: string }>(`${base}/photos`, {
        method: "POST",
        body: JSON.stringify({ url, reuse: true }),
      });
      if (!ids.includes(id)) ids.push(id);
      done.push(url);
    } catch {
      failedUrls.push(url);
    }
  }
  return { ids, failed: failedUrls.length, done, failedUrls };
}

/** Photos imported from another listing of the same site (their file starts with another property id). */
export function foreignPhotos(photos: EditorPhoto[], propertyId: string | null) {
  if (!propertyId) return [];
  return photos.filter((p) => {
    const id = p.source?.match(/^(\d{4,})_/)?.[1];
    return Boolean(id && id !== propertyId);
  });
}

type Preview = ImportedDemo & { listingUrl: string; existingAgency: string | null; agencyWhatsapp?: string | null };

/**
 * Paste the URL → the page is read → a full preview with every field and its
 * state → only the real exceptions ask for a decision → the demo is created
 * with all of it, then the property's own photos are imported in order.
 */
export function ImportFromListing({ agencyId }: { agencyId?: string | null } = {}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [price, setPrice] = useState("");
  const [mapChoice, setMapChoice] = useState<MapChoice | null>(null);
  const [contact, setContact] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
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
        body: JSON.stringify({ url, preview: true, agencyId: agencyId ?? undefined }),
      });
      setPreview(data);
      setPrice(data.priceOptions[0] ?? "");
      setMapChoice(initialMapChoice(data));
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
          map: mapChoice ? mapOverride(preview, mapChoice) : undefined,
          agencyId: agencyId ?? undefined,
          whatsapp: !preview.agencyWhatsapp && whatsapp.trim() ? whatsapp.trim() : undefined,
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
          {mapChoice && <MapReview data={preview} value={mapChoice} onChange={setMapChoice} />}
          {preview.existingAgency && (
            <p className="dm-help">
              Se agrega a <strong>{preview.existingAgency}</strong> (ya cargada): solo completamos su logo y
              contacto si faltan.
            </p>
          )}
          {preview.agencyWhatsapp ? (
            <p className="dm-help">WhatsApp para enviarle la demo: +{preview.agencyWhatsapp}. Se puede corregir en la demo.</p>
          ) : (
            <AgencyWhatsappField
              value={whatsapp}
              onChange={setWhatsapp}
              note="No lo encontramos en la publicación. Sin él, «Enviar por WhatsApp» queda deshabilitado; se puede cargar después en la demo."
            />
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

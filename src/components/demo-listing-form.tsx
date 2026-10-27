"use client";
import { sourceName } from "@/lib/demos/geo";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FACT_ICONS, type DemoSettings, type FactIcon } from "@/lib/demos/branding";

const FACT_NAMES: Record<FactIcon, string> = {
  area: "Superficie",
  rooms: "Ambientes",
  bedrooms: "Dormitorios",
  offices: "Privados / oficinas",
  bathrooms: "Baños",
  floor: "Piso / acceso",
  parking: "Cochera",
  age: "Antigüedad",
  other: "Otro",
};
const PRECISIONS = [
  ["none", "Sin mapa (solo el texto)"],
  ["zone", "Zona o barrio (área amplia, sin punto)"],
  ["approx", "Cuadra o ubicación aproximada (área chica, sin punto)"],
  ["exact", "Dirección exacta publicada (con marcador)"],
] as const;

type Form = {
  operation: string;
  reference: string;
  features: string;
  price: string;
  priceConflict: string;
  expenses: string;
  availability: string;
  requirements: string;
  description: string;
  facts: { icon: FactIcon; value: string; label: string }[];
  amenities: { title: string; items: string }[];
  precision: DemoSettings["map"]["precision"];
  lat: string;
  lng: string;
  /** A map link pasted instead of the coordinates. */
  mapLink: string;
  mapSource: DemoSettings["map"]["source"];
  agentName: string;
  agentRole: string;
  agentWhatsapp: string;
  agentPhone: string;
  agentEmail: string;
  agentPhoto: string;
  closingTitle: string;
  closingText: string;
  shareTitle: string;
  shareDescription: string;
};
const toForm = (s: DemoSettings): Form => ({
  operation: s.operation ?? "",
  reference: s.reference ?? "",
  features: s.features ?? "",
  price: s.price ?? "",
  priceConflict: s.priceConflict ?? "",
  expenses: s.expenses ?? "",
  availability: s.availability ?? "",
  requirements: s.requirements ?? "",
  description: s.description ?? "",
  facts: s.facts.map((f) => ({ ...f })),
  amenities: s.amenities.map((g) => ({ title: g.title, items: g.items.join("\n") })),
  precision: s.map.precision,
  lat: s.map.lat?.toString() ?? "",
  lng: s.map.lng?.toString() ?? "",
  mapLink: "",
  mapSource: s.map.source,
  agentName: s.agent?.name ?? "",
  agentRole: s.agent?.role ?? "",
  agentWhatsapp: s.agent?.whatsapp ?? "",
  agentPhone: s.agent?.phone ?? "",
  agentEmail: s.agent?.email ?? "",
  agentPhoto: s.agent?.photoUrl ?? "",
  closingTitle: s.closingTitle ?? "",
  closingText: s.closingText ?? "",
  shareTitle: s.shareTitle ?? "",
  shareDescription: s.shareDescription ?? "",
});
const toSettings = (f: Form) => ({
  operation: f.operation,
  reference: f.reference,
  features: f.features,
  price: f.price,
  priceConflict: f.priceConflict,
  expenses: f.expenses,
  availability: f.availability,
  requirements: f.requirements,
  description: f.description,
  facts: f.facts.filter((x) => x.value.trim()),
  amenities: f.amenities.map((g) => ({ title: g.title, items: g.items.split("\n") })),
  map: f.mapLink.trim()
    ? { precision: f.precision, link: f.mapLink.trim() }
    : { precision: f.precision, lat: f.lat.trim() || null, lng: f.lng.trim() || null },
  agent: {
    name: f.agentName,
    role: f.agentRole,
    whatsapp: f.agentWhatsapp,
    phone: f.agentPhone,
    email: f.agentEmail,
    photoUrl: f.agentPhoto,
  },
  closingTitle: f.closingTitle,
  closingText: f.closingText,
  shareTitle: f.shareTitle,
  shareDescription: f.shareDescription,
});

/**
 * Everything the buyer's page shows about the property beyond its photos.
 * Only what is entered is shown: empty fields never appear, and nothing is
 * filled in automatically except from the original listing.
 */
export function ListingForm({
  settings,
  disabled,
  onSave,
}: {
  settings: DemoSettings;
  disabled: boolean;
  onSave: (settings: ReturnType<typeof toSettings>) => Promise<void>;
}) {
  const [form, setForm] = useState(() => toForm(settings));
  useEffect(() => setForm(toForm(settings)), [settings]);
  const set = <K extends keyof Form>(k: K) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value as Form[K] });
  const ask = /alquiler/i.test(form.operation) ? "Consultar alquiler" : "Consultar precio";
  return (
    <form
      className="dm-listing"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(toSettings(form));
      }}
    >
      <fieldset>
        <legend>Identificación</legend>
        <div className="dm-fields">
          <label>
            Operación
            <input value={form.operation} maxLength={40} placeholder="Alquiler" onChange={set("operation")} />
          </label>
          <label>
            Código de referencia
            <input value={form.reference} maxLength={40} placeholder="RAP12025427" onChange={set("reference")} />
          </label>
          <label className="dm-wide">
            Características principales <small>(línea bajo el título)</small>
            <input value={form.features} maxLength={120} placeholder="27 m² · 2 privados · 1 baño" onChange={set("features")} />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Precio y condiciones</legend>
        <div className="dm-fields">
          <label>
            Precio con moneda <small>(tal como lo publica)</small>
            <input value={form.price} maxLength={40} placeholder="$ 950.000" onChange={set("price")} />
          </label>
          <label>
            Expensas
            <input value={form.expenses} maxLength={60} placeholder="$ 80.000" onChange={set("expenses")} />
          </label>
          <label className="dm-wide">
            Conflicto de precio <small>(privado: si la publicación muestra importes distintos)</small>
            <input
              value={form.priceConflict}
              maxLength={200}
              placeholder="Cabecera $ 1.100.000 / descripción $ 950.000 + expensas"
              onChange={set("priceConflict")}
            />
          </label>
          <label>
            Disponibilidad
            <input value={form.availability} maxLength={80} placeholder="Inmediata" onChange={set("availability")} />
          </label>
          <label>
            Requisitos
            <input value={form.requirements} maxLength={300} placeholder="Contrato 24 meses" onChange={set("requirements")} />
          </label>
        </div>
        <p className="dm-help">
          {form.priceConflict.trim()
            ? `Con un conflicto cargado, la ficha muestra «${ask}» y nunca un precio.`
            : form.price.trim()
              ? "La ficha muestra este precio."
              : `Sin precio confirmado, la ficha muestra «${ask}».`}
        </p>
      </fieldset>

      <fieldset>
        <legend>Datos con íconos</legend>
        {form.facts.map((f, i) => (
          <div className="dm-fact" key={i}>
            <select
              aria-label="Ícono"
              value={f.icon}
              onChange={(e) =>
                setForm({ ...form, facts: form.facts.map((x, j) => (j === i ? { ...x, icon: e.target.value as FactIcon } : x)) })
              }
            >
              {FACT_ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {FACT_NAMES[icon]}
                </option>
              ))}
            </select>
            <input
              aria-label="Valor"
              value={f.value}
              maxLength={30}
              placeholder="27 m²"
              onChange={(e) =>
                setForm({ ...form, facts: form.facts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })
              }
            />
            <input
              aria-label="Etiqueta"
              value={f.label}
              maxLength={40}
              placeholder="cubiertos"
              onChange={(e) =>
                setForm({ ...form, facts: form.facts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })
              }
            />
            <button
              type="button"
              className="icon-button dm-danger"
              aria-label="Quitar dato"
              onClick={() => setForm({ ...form, facts: form.facts.filter((_, j) => j !== i) })}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {form.facts.length < 8 && (
          <button
            type="button"
            className="button button-small button-outline"
            onClick={() => setForm({ ...form, facts: [...form.facts, { icon: "area", value: "", label: "" }] })}
          >
            <Plus size={15} /> Agregar dato
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend>Descripción completa</legend>
        <label className="dm-wide">
          Tal como figura en la publicación <small>(líneas con «-» se muestran como lista)</small>
          <textarea rows={8} maxLength={6000} value={form.description} onChange={set("description")} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Características y servicios</legend>
        {form.amenities.map((g, i) => (
          <div className="dm-amenity" key={i}>
            <input
              aria-label="Título del grupo"
              value={g.title}
              maxLength={40}
              placeholder="Características"
              onChange={(e) =>
                setForm({ ...form, amenities: form.amenities.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })
              }
            />
            <textarea
              aria-label="Ítems, uno por línea"
              rows={4}
              value={g.items}
              placeholder={"Baño con antebaño\nInstalación eléctrica nueva"}
              onChange={(e) =>
                setForm({ ...form, amenities: form.amenities.map((x, j) => (j === i ? { ...x, items: e.target.value } : x)) })
              }
            />
            <button
              type="button"
              className="icon-button dm-danger"
              aria-label="Quitar grupo"
              onClick={() => setForm({ ...form, amenities: form.amenities.filter((_, j) => j !== i) })}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {form.amenities.length < 4 && (
          <button
            type="button"
            className="button button-small button-outline"
            onClick={() => setForm({ ...form, amenities: [...form.amenities, { title: "", items: "" }] })}
          >
            <Plus size={15} /> Agregar grupo
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend>Mapa</legend>
        <div className="dm-fields">
          <label className="dm-wide">
            Precisión <small>(nunca más precisa que la publicación)</small>
            <select value={form.precision} onChange={set("precision")}>
              {PRECISIONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {form.precision !== "none" && (
            <>
              <label className="dm-wide">
                Enlace del mapa <small>(Google Maps, OpenStreetMap, Waze o Apple Maps, con el punto marcado)</small>
                <input
                  value={form.mapLink}
                  inputMode="url"
                  placeholder="https://www.google.com/maps/place/…"
                  onChange={set("mapLink")}
                />
              </label>
              <label>
                Latitud
                <input value={form.lat} inputMode="decimal" placeholder="-38.0055" onChange={set("lat")} />
              </label>
              <label>
                Longitud
                <input value={form.lng} inputMode="decimal" placeholder="-57.5426" onChange={set("lng")} />
              </label>
            </>
          )}
        </div>
        {form.precision !== "none" && form.mapSource && !form.mapLink && (
          <p className="dm-help">Origen del punto: {sourceName(form.mapSource)}.</p>
        )}
        <p className="dm-help">
          El texto de ubicación se edita en «Propiedad». Pegá el enlace del mapa o las coordenadas (en Google Maps:
          clic derecho sobre el punto). Zonas y ubicaciones aproximadas se muestran como un área, sin marcador, y se
          redondean antes de llegar al navegador.
        </p>
      </fieldset>

      <fieldset>
        <legend>Agente asignado</legend>
        <div className="dm-fields">
          <label>
            Nombre
            <input value={form.agentName} maxLength={80} placeholder="Como figura en la publicación" onChange={set("agentName")} />
          </label>
          <label>
            Cargo
            <input value={form.agentRole} maxLength={60} placeholder="Asesora inmobiliaria" onChange={set("agentRole")} />
          </label>
          <label>
            WhatsApp
            <input value={form.agentWhatsapp} maxLength={30} placeholder="+54 9 223 …" onChange={set("agentWhatsapp")} />
          </label>
          <label>
            Teléfono
            <input value={form.agentPhone} maxLength={30} onChange={set("agentPhone")} />
          </label>
          <label>
            Email
            <input value={form.agentEmail} maxLength={120} onChange={set("agentEmail")} />
          </label>
          <label>
            Foto <small>(enlace https de su publicación)</small>
            <input value={form.agentPhoto} maxLength={500} placeholder="Sin foto: se muestran las iniciales" onChange={set("agentPhoto")} />
          </label>
        </div>
        <p className="dm-help">
          Las consultas van al WhatsApp del agente; si no tiene, al canal de la inmobiliaria. Cargá solo datos
          publicados o confirmados por la inmobiliaria.
        </p>
      </fieldset>

      <fieldset>
        <legend>Cierre y vista previa al compartir</legend>
        <div className="dm-fields">
          <label>
            Título del cierre
            <input value={form.closingTitle} maxLength={80} placeholder="¿Te imaginás trabajando acá?" onChange={set("closingTitle")} />
          </label>
          <label>
            Texto del cierre
            <input value={form.closingText} maxLength={160} placeholder="Contactá a la inmobiliaria para conocerla." onChange={set("closingText")} />
          </label>
          <label>
            Título al compartir
            <input value={form.shareTitle} maxLength={90} placeholder="Vacío: título · inmobiliaria" onChange={set("shareTitle")} />
          </label>
          <label>
            Descripción al compartir
            <input value={form.shareDescription} maxLength={200} placeholder="Vacío: ubicación y características" onChange={set("shareDescription")} />
          </label>
        </div>
      </fieldset>

      <button className="button button-primary" disabled={disabled}>
        Guardar ficha
      </button>
    </form>
  );
}

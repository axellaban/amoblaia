"use client";
// An agency's public catalog on habita: its brand, its published
// properties with search and filters, and contact by WhatsApp.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MapPin, MessageCircle, Search, Sparkles } from "lucide-react";
import { track } from "@/lib/analytics";
import type { PublicSite } from "@/lib/agency/site";

export function AgencySite({ site }: { site: PublicSite }) {
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState("");
  useEffect(() => {
    track("agency_website_viewed", { agency_id: site.agencyId, properties: site.properties.length });
  }, [site.agencyId, site.properties.length]);
  const operations = useMemo(
    () => [...new Set(site.properties.map((p) => p.operation).filter((o): o is string => Boolean(o)))],
    [site.properties],
  );
  const shown = site.properties.filter(
    (p) =>
      (!operation || p.operation === operation) &&
      (!query.trim() || `${p.title} ${p.location ?? ""} ${p.features ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const wa = site.whatsapp
    ? `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(`Hola ${site.name}! Vi sus propiedades en su sitio y quiero hacer una consulta.`)}`
    : null;
  const style = { "--brand": site.primary, "--brand-ink": site.primaryInk } as React.CSSProperties;
  return (
    <div className="as-page" style={style}>
      <header className="as-header">
        <div className="container as-header-row">
          {site.logo ? (
            // The agency's own logo, served from its site's route.
            <img className="as-logo" src={site.logo} alt={site.name} />
          ) : (
            <strong className="as-name">{site.name}</strong>
          )}
          {wa && (
            <a className="as-cta" href={wa} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={18} aria-hidden="true" /> Consultar
            </a>
          )}
        </div>
      </header>
      <main className="container as-main">
        <h1>Propiedades</h1>
        <div className="as-filters" role="search">
          <label className="as-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              placeholder="Buscar por barrio, ambientes…"
              aria-label="Buscar propiedades"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {operations.length > 1 && (
            <div className="as-ops" role="group" aria-label="Operación">
              <button type="button" className={!operation ? "is-on" : ""} onClick={() => setOperation("")}>
                Todas
              </button>
              {operations.map((o) => (
                <button key={o} type="button" className={operation === o ? "is-on" : ""} onClick={() => setOperation(o)}>
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
        {shown.length ? (
          <ul className="as-grid">
            {shown.map((p) => (
              <li key={p.token}>
                <Link href={`/inmobiliaria/${site.slug}/${p.token}`} className="as-card">
                  <span className="as-photo">
                    {p.cover ? <img src={p.cover} alt="" loading="lazy" /> : null}
                    {p.staged && (
                      <span className="as-tag">
                        <Sparkles size={13} aria-hidden="true" /> Con ambientación IA
                      </span>
                    )}
                  </span>
                  <span className="as-body">
                    <span className="as-price">
                      {p.operation && <span className="as-op">{p.operation}</span>}
                      {p.price ?? "Consultar precio"}
                    </span>
                    <strong>{p.title}</strong>
                    {p.location && (
                      <span className="as-loc">
                        <MapPin size={14} aria-hidden="true" /> {p.location}
                      </span>
                    )}
                    {p.features && <span className="as-features">{p.features}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="as-empty">
            {site.properties.length ? "Ninguna propiedad coincide con la búsqueda." : "Pronto vas a ver acá nuestras propiedades."}
          </p>
        )}
        <p className="as-note">
          Las ambientaciones con IA son ilustrativas: muestran cómo podría verse cada espacio. La foto original siempre
          está disponible en cada propiedad.
        </p>
      </main>
      <footer className="as-footer">
        <div className="container as-footer-row">
          <span>{site.name}</span>
          {site.website && (
            <a href={site.website} target="_blank" rel="noopener noreferrer">
              Sitio de la inmobiliaria
            </a>
          )}
          <span className="as-made">
            Hecho con <Link href="/">habita</Link>
          </span>
        </div>
      </footer>
      {wa && (
        <a className="as-sticky" href={wa} target="_blank" rel="noopener noreferrer">
          <MessageCircle size={18} aria-hidden="true" /> Consultar por WhatsApp
        </a>
      )}
    </div>
  );
}

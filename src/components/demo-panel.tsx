"use client";
// The agency's presentation demo shown inside its panel, in "modo
// demostración": the property already loaded, its photos and versions to
// look at, compare and download. Everything that saves, publishes or creates
// (and every other section of the panel) goes through the private invitation
// this link carries: «Guardar mi panel». Only the demo's public data is used.
import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, CircleDollarSign, Download, Globe, Home, Image as ImageIcon, Menu, Plus, Sparkles, X } from "lucide-react";
import { Comparison } from "./comparison";
import { registerSuperProperties, track } from "@/lib/analytics";
import { DEMO_REF_KEY, publicImageUrl, type PhotoVersion, type PublicDemo } from "@/lib/demos/shared";

type Invite = { href: string; freeCredits: number };
type View = "original" | "version" | "compare";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

export function DemoPanel({ demo, token, invite, buyerHref }: { demo: PublicDemo; token: string; invite: Invite; buyerHref: string }) {
  const styleName = useMemo(() => Object.fromEntries(demo.styles.map((s) => [s.id, s.name])) as Record<string, string>, [demo.styles]);
  const photos = demo.photos;
  const first = Math.max(0, photos.findIndex((p) => p.versions.length));
  const [index, setIndex] = useState(first);
  const photo = photos[index] ?? null;
  const [style, setStyle] = useState<string | null>(photo?.versions[0]?.style ?? null);
  const [view, setView] = useState<View>(photo?.versions.length ? "compare" : "original");
  const [menu, setMenu] = useState(false);
  const version: PhotoVersion | null = photo?.versions.find((v) => v.style === style) ?? null;
  const shown: View = version ? view : "original";
  const analytics = useMemo(() => ({ demo_id: demo.id, inmobiliaria_id: demo.agencyId, version: "panel_demo" }), [demo.id, demo.agencyId]);
  const log = (event: string, extra: Record<string, string> = {}) => track(event, { ...analytics, ...extra });

  useEffect(() => {
    track("demo_vista", { ...analytics, fotos: demo.photos.length, ambientadas: demo.photos.filter((p) => p.versions.length).length });
    registerSuperProperties({ demo_id: demo.id, demo_inmobiliaria_id: demo.agencyId });
    try {
      localStorage.setItem(DEMO_REF_KEY, JSON.stringify({ demoId: demo.id, agencyId: demo.agencyId, at: Date.now() }));
    } catch {
      /* Private mode or blocked storage. */
    }
  }, [analytics, demo.id, demo.agencyId, demo.photos]);

  const pick = (i: number) => {
    const p = photos[i];
    setIndex(i);
    const keep = p.versions.find((v) => v.style === style) ?? p.versions[0] ?? null;
    setStyle(keep?.style ?? null);
    setView(keep ? (view === "original" ? "compare" : view) : "original");
  };
  const choose = (s: string | null) => {
    setStyle(s);
    setView(s ? (view === "original" ? "compare" : view) : "original");
    if (s) log("demo_estilo", { estilo: s });
  };

  // Every saving action, and every other part of the panel, asks for the access first.
  const save = (origin: string) => ({ href: invite.href, onClick: () => log("demo_agency_cta_clicked", { origen: `demo_panel_${origin}` }) });
  const credits = invite.freeCredits > 0 ? `${invite.freeCredits} de regalo` : "Para ambientar fotos";
  const downloadName = `${demo.title}-${photo?.label ?? "foto"}-${version ? (styleName[version.style] ?? version.style) : "original"}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return (
    <div className="dp">
      <nav className={`dp-side ${menu ? "is-open" : ""}`} aria-label="Panel de la inmobiliaria">
        <div className="dp-brand">
          {demo.agency.logo ? (
            <img src={demo.agency.logo} alt="" className="dp-logo" />
          ) : (
            <span className="dp-logo" aria-hidden="true">
              {initials(demo.agencyName)}
            </span>
          )}
          <span className="dp-brand-text">
            <strong>{demo.agencyName}</strong>
            <small>Modo demostración</small>
          </span>
          <button type="button" className="dp-menu-toggle" aria-expanded={menu} aria-label={menu ? "Cerrar el menú del panel" : "Abrir el menú del panel"} onClick={() => setMenu((m) => !m)}>
            {menu ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
        <div className="dp-links">
          <a className="dp-link" {...save("inicio")}>
            <Home size={18} aria-hidden="true" /> Inicio
          </a>
          <a className="dp-link is-group" {...save("mi_inmobiliaria")}>
            <Building2 size={18} aria-hidden="true" /> Mi inmobiliaria <ChevronDown size={16} aria-hidden="true" className="dp-chevron" />
          </a>
          <div className="dp-tree">
            <a className="dp-link is-sub" {...save("mis_propiedades")}>
              Mis propiedades <span className="dp-count">1</span> <ChevronDown size={14} aria-hidden="true" />
            </a>
            <div className="dp-tree">
              <a className="dp-link is-current" href="#propiedad" aria-current="page">
                <strong>{demo.title}</strong>
                <small>Estás viendo esta propiedad</small>
              </a>
            </div>
          </div>
        </div>
        <a className="dp-create" {...save("crear_propiedad")}>
          <Plus size={18} aria-hidden="true" /> Crear propiedad
        </a>
        <div className="dp-links dp-tools">
          <a className="dp-link is-tool" {...save("imagenes")}>
            <ImageIcon size={18} aria-hidden="true" />
            <span>
              <strong>Imágenes</strong>
              <small>Importar y ambientar fotos</small>
            </span>
          </a>
          <a className="dp-link is-tool" {...save("creditos")}>
            <CircleDollarSign size={18} aria-hidden="true" />
            <span>
              <strong>Créditos</strong>
              <small>{credits}</small>
            </span>
          </a>
          <a className="dp-link" {...save("sitio")}>
            <Globe size={18} aria-hidden="true" /> Mi sitio web
          </a>
        </div>
        <p className="dp-side-note">Guardá tu panel para usar estas secciones.</p>
      </nav>

      <main className="dp-main" id="propiedad">
        <section className="dp-banner" aria-label="Modo demostración">
          <p>
            <strong>Modo demostración.</strong> Preparamos esta propiedad para {demo.agencyName}. Mirá, compará y descargá sus versiones: nada se publica
            hasta que lo decidas.
          </p>
          <a className="dp-button is-primary" {...save("aviso")}>
            Guardar mi panel
          </a>
        </section>

        <header className="dp-head">
          <div>
            <span className="dp-crumb">
              Mis propiedades / <b>{demo.title}</b>
            </span>
            <h1>{demo.title}</h1>
            <p className="dp-meta">
              {demo.location && <span>{demo.location}</span>}
              <span className="dp-chip">Demostración</span>
              {(demo.operation || demo.price) && <span className="dp-chip is-sage">{[demo.operation, demo.price].filter(Boolean).join(" · ")}</span>}
            </p>
          </div>
          <div className="dp-actions">
            <a className="dp-button" href={buyerHref} onClick={() => log("demo_panel_buyer_view")}>
              Ver como comprador
            </a>
            <a className="dp-button is-primary" {...save("encabezado")}>
              Guardar mi panel
            </a>
          </div>
        </header>

        {!photo ? (
          <p className="dp-empty">Esta propiedad todavía no tiene fotos.</p>
        ) : (
          <div className="dp-work">
            <section className="dp-card dp-photos" aria-labelledby="dp-photos-title">
              <h2 id="dp-photos-title">Fotos</h2>
              <ul>
                {photos.map((p, i) => (
                  <li key={p.id}>
                    <button type="button" aria-pressed={i === index} aria-label={`${p.label}${p.versions.length ? `, ${p.versions.length} ${p.versions.length === 1 ? "versión" : "versiones"}` : ""}`} onClick={() => pick(i)}>
                      <img src={publicImageUrl(token, p.id, null, 320)} alt="" loading="lazy" />
                      {p.versions.length > 0 && <span className="dp-thumb-badge">IA</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="dp-card dp-stage" aria-labelledby="dp-stage-title">
              <div className="dp-stage-head">
                <h2 id="dp-stage-title">
                  {photo.label}
                  {version ? ` · ${styleName[version.style] ?? version.style}` : ""}
                </h2>
                <span>
                  Foto {index + 1} de {photos.length}
                </span>
              </div>
              {shown === "compare" && version ? (
                <Comparison
                  before={publicImageUrl(token, photo.id, null, 1600)}
                  after={publicImageUrl(token, photo.id, version, 1600)}
                  beforeLabel="Original"
                  afterLabel="Ambientado con IA"
                  alt={`${photo.label}, ambientado con IA`}
                  beforeAlt={`${photo.label}, foto original`}
                />
              ) : (
                <img
                  className="dp-photo"
                  src={publicImageUrl(token, photo.id, shown === "version" ? version : null, 1600)}
                  alt={`${photo.label}${shown === "version" ? ", ambientado con IA" : ", foto original"}`}
                />
              )}
              {version && (
                <div className="dp-views" role="group" aria-label="Cómo ver la foto">
                  {(
                    [
                      ["original", "Original"],
                      ["version", "Versión"],
                      ["compare", "Comparar"],
                    ] as const
                  ).map(([v, label]) => (
                    <button key={v} type="button" aria-pressed={shown === v} onClick={() => setView(v)}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <aside className="dp-card dp-versions" aria-labelledby="dp-versions-title">
              <h2 id="dp-versions-title">Versiones de esta foto</h2>
              <div className="dp-options" role="radiogroup" aria-labelledby="dp-versions-title">
                <button type="button" role="radio" aria-checked={!version} onClick={() => choose(null)}>
                  <img src={publicImageUrl(token, photo.id, null, 240)} alt="" />
                  <span>
                    <strong>Original</strong>
                    <small>La foto como se subió</small>
                  </span>
                </button>
                {photo.versions.map((v) => (
                  <button key={v.style} type="button" role="radio" aria-checked={version?.style === v.style} onClick={() => choose(v.style)}>
                    <img src={publicImageUrl(token, photo.id, v, 240)} alt="" loading="lazy" />
                    <span>
                      <strong>{styleName[v.style] ?? v.style}</strong>
                      <small>{version?.style === v.style ? "Versión seleccionada" : "Ambientada con IA"}</small>
                    </span>
                  </button>
                ))}
              </div>
              <a
                className="dp-button is-primary is-block"
                href={publicImageUrl(token, photo.id, version, 2048)}
                download={`${downloadName}.jpg`}
                onClick={() => log("demo_panel_download", { estilo: version?.style ?? "original" })}
              >
                <Download size={17} aria-hidden="true" /> {version ? "Descargar esta versión" : "Descargar el original"}
              </a>
              <a className="dp-button is-block" {...save("otra_version")}>
                <Sparkles size={17} aria-hidden="true" /> Crear otra ambientación
              </a>
              <p className="dp-note">Descargar no usa créditos. Una versión nueva muestra su costo antes de empezar.</p>
            </aside>
          </div>
        )}

        <section className="dp-card dp-next" aria-labelledby="dp-next-title">
          <div>
            <h2 id="dp-next-title">¿Probamos con otra propiedad?</h2>
            <p>Guardá tu panel y pegá el enlace de otra publicación: traemos sus datos y fotos. Importar no usa créditos.</p>
          </div>
          <a className="dp-button" {...save("otra_propiedad")}>
            <Plus size={16} aria-hidden="true" /> Agregar otra propiedad
          </a>
        </section>
      </main>

      <div className="dp-mobile-bar">
        <a className="dp-button is-primary is-block" {...save("barra_movil")}>
          Guardar mi panel
        </a>
        <small>Conservás esta propiedad con sus fotos y versiones.</small>
      </div>
    </div>
  );
}

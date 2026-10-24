"use client";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarCheck,
  Info,
  LayoutPanelLeft,
  MessageCircle,
  Sofa,
  SplitSquareHorizontal,
} from "lucide-react";
import {
  ORIGINAL_TITLE,
  PROPOSAL_TITLE,
  SCALE_NOTE,
  STAGING_LABEL,
} from "@/lib/disclosure";
import {
  imagePath,
  showcasePath,
  styleOptions,
  whatsappLink,
  type ContactIntent,
  type PublicShowcase,
  type ShowcaseOrigin,
} from "@/lib/showcase-shared";
import { track } from "@/lib/analytics";
import {
  ProposalCompare,
  ProposalViewer,
  type CompareView,
  type Side,
} from "./proposal-compare";

/**
 * What a buyer sees from a shared link or an agency's site: each room opens
 * on its real photo; staged proposals are an explicit, labelled option shown
 * next to it. Only proposals the agent reviewed exist here, and nothing on
 * this page generates images or spends the agent's photos.
 */
export function ShowcaseViewer({
  data,
  token,
  origin,
}: {
  data: PublicShowcase;
  token: string;
  origin: ShowcaseOrigin;
}) {
  const [roomId, setRoomId] = useState(data.rooms[0]?.id || "");
  const [explored, setExplored] = useState<Record<string, boolean>>({});
  const [styleOf, setStyleOf] = useState<Record<string, string>>({});
  const [optionOf, setOptionOf] = useState<Record<string, number>>({});
  const [view, setView] = useState<CompareView>("pair");
  const [zoom, setZoom] = useState<Side | null>(null);
  const [ratio, setRatio] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState(false);
  const [shareUrl, setShareUrl] = useState(showcasePath(token));
  useEffect(() => {
    setShareUrl(`${window.location.origin}${showcasePath(token)}`);
    track("ficha_abierta", {
      origen: origin,
      ficha: data.id,
      ambientes: data.rooms.length,
      ambientes_con_propuestas: data.rooms.filter((r) => r.proposals.length)
        .length,
    });
  }, [data, origin, token]);
  // Inside an agency's site the iframe grows with the content (see embedCode).
  useEffect(() => {
    if (origin !== "embed" || window.parent === window) return;
    const send = () =>
      window.parent.postMessage(
        {
          type: "amoblaia:height",
          height: document.documentElement.scrollHeight,
        },
        "*",
      );
    const observer = new ResizeObserver(send);
    observer.observe(document.body);
    send();
    return () => observer.disconnect();
  }, [origin]);

  const room = data.rooms.find((r) => r.id === roomId) || data.rooms[0];
  const options = useMemo(
    () => (room ? styleOptions(room.proposals) : []),
    [room],
  );
  const style = (room && styleOf[room.id]) || options[0]?.style;
  const group = options.find((o) => o.style === style) || options[0];
  const option = Math.min(
    (room && optionOf[room.id]) || 0,
    Math.max(0, (group?.ids.length || 1) - 1),
  );
  const proposalId = group?.ids[option];
  const original = room ? imagePath(token, { kind: "original", id: room.id }) : "";
  const proposal = proposalId
    ? imagePath(token, { kind: "proposal", id: proposalId })
    : "";
  const isExplored = Boolean(room && explored[room.id] && proposal);
  const roomIndex = room ? data.rooms.indexOf(room) : -1;

  function contact(intent: ContactIntent) {
    return whatsappLink({
      phone: data.whatsapp || "",
      title: data.title,
      url: shareUrl,
      intent,
      room: room && data.rooms.length > 1 ? room.label : undefined,
      style: isExplored ? group?.name : undefined,
    });
  }
  const contacts = (["consulta", "visita"] as ContactIntent[])
    .map((intent) => ({ intent, href: contact(intent) }))
    .filter((c): c is { intent: ContactIntent; href: string } =>
      Boolean(c.href),
    );

  return (
    <div className={`sc sc-${origin}`}>
      <header className="sc-header">
        {(data.hasLogo || data.agencyName) && (
          <div className="sc-agency">
            {data.hasLogo && (
              <img
                src={imagePath(token, { kind: "logo" })}
                alt={data.agencyName || "Logo de la inmobiliaria"}
              />
            )}
            {data.agencyName && <span>{data.agencyName}</span>}
          </div>
        )}
        <h1>{data.title}</h1>
        <p className="sc-intro">
          <Info size={16} aria-hidden="true" />
          <span>
            Siempre ves la <strong>foto real</strong> del estado actual. Las
            propuestas son <strong>ambientaciones virtuales</strong> para
            imaginar cómo vivir el espacio: el mobiliario se agregó
            digitalmente.
          </span>
        </p>
      </header>

      {!room ? (
        <p className="sc-empty">
          Esta ficha todavía no tiene ambientes para mostrar.
        </p>
      ) : (
        <section className="sc-room" aria-label={room.label}>
          {data.rooms.length > 1 && (
            <div className="sc-rooms" role="tablist" aria-label="Ambientes">
              {data.rooms.map((r) => (
                <button
                  key={r.id}
                  role="tab"
                  aria-selected={r.id === room.id}
                  className={r.id === room.id ? "selected" : ""}
                  onClick={() => {
                    setRoomId(r.id);
                    setZoom(null);
                    setFailed(false);
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
          {failed && (
            <p className="sc-error" role="alert">
              No pudimos cargar una imagen. Revisá tu conexión y actualizá la
              página.
            </p>
          )}
          {!isExplored ? (
            <>
              <figure className="sc-original">
                <figcaption>
                  <span className="pc-dot" aria-hidden="true" />
                  {ORIGINAL_TITLE} · {room.label}
                </figcaption>
                <div className="sc-original-frame">
                  <img
                    src={original}
                    alt={`${room.label}: foto real del estado actual`}
                    onLoad={(e) => {
                      const { naturalWidth: w, naturalHeight: h } =
                        e.currentTarget;
                      if (w && h)
                        setRatio((m) => ({ ...m, [room.id]: w / h }));
                    }}
                    onError={() => setFailed(true)}
                  />
                  {options.length ? (
                    <button
                      className="button button-primary sc-explore"
                      onClick={() => {
                        setExplored((m) => ({ ...m, [room.id]: true }));
                        track("ambientacion_explorada", {
                          origen: origin,
                          ficha: data.id,
                          ambiente: roomIndex + 1,
                          estilos: options.length,
                        });
                      }}
                    >
                      <Sofa size={18} /> Explorá este ambiente amoblado
                    </button>
                  ) : (
                    <span className="sc-badge">
                      Sin propuestas de ambientación por ahora
                    </span>
                  )}
                </div>
              </figure>
            </>
          ) : (
            <>
              <div className="sc-controls">
                <div
                  className="sc-styles"
                  role="radiogroup"
                  aria-label="Estilos de ambientación disponibles"
                >
                  {options.map((o) => (
                    <button
                      key={o.style}
                      role="radio"
                      aria-checked={o.style === group?.style}
                      className={o.style === group?.style ? "selected" : ""}
                      onClick={() => {
                        setStyleOf((m) => ({ ...m, [room.id]: o.style }));
                        setOptionOf((m) => ({ ...m, [room.id]: 0 }));
                        track("estilo_seleccionado", {
                          origen: origin,
                          ficha: data.id,
                          ambiente: roomIndex + 1,
                          estilo: o.style,
                        });
                      }}
                    >
                      {o.name}
                    </button>
                  ))}
                </div>
                {group && group.ids.length > 1 && (
                  <div className="sc-options" role="group" aria-label="Opciones">
                    {group.ids.map((id, i) => (
                      <button
                        key={id}
                        aria-pressed={i === option}
                        className={i === option ? "selected" : ""}
                        onClick={() =>
                          setOptionOf((m) => ({ ...m, [room.id]: i }))
                        }
                      >
                        Opción {i + 1}
                      </button>
                    ))}
                  </div>
                )}
                <div
                  className="view-toggle"
                  role="group"
                  aria-label="Cómo comparar"
                >
                  <button
                    className={view === "pair" ? "selected" : ""}
                    aria-pressed={view === "pair"}
                    onClick={() => setView("pair")}
                  >
                    <LayoutPanelLeft size={15} /> Lado a lado
                  </button>
                  <button
                    className={view === "slider" ? "selected" : ""}
                    aria-pressed={view === "slider"}
                    onClick={() => setView("slider")}
                  >
                    <SplitSquareHorizontal size={15} /> Deslizador
                  </button>
                </div>
              </div>
              <ProposalCompare
                original={original}
                proposal={proposal}
                disclosure={STAGING_LABEL}
                proposalTitle={`${PROPOSAL_TITLE} · ${group?.name}`}
                view={view}
                ratio={ratio[room.id]}
                onZoom={setZoom}
                onImageError={() => setFailed(true)}
                className="sc-compare"
              />
              <p className="sc-note">{SCALE_NOTE}</p>
            </>
          )}
        </section>
      )}

      {contacts.length > 0 && (
        <div className="sc-contact">
          {contacts.map(({ intent, href }) => (
            <a
              key={intent}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`button ${intent === "consulta" ? "button-primary" : "button-outline"}`}
              onClick={() =>
                track("contacto_clic", {
                  origen: origin,
                  ficha: data.id,
                  tipo: intent,
                  canal: "whatsapp",
                  exploro_propuesta: isExplored,
                })
              }
            >
              {intent === "consulta" ? (
                <>
                  <MessageCircle size={17} /> Consultar por esta propiedad
                </>
              ) : (
                <>
                  <CalendarCheck size={17} /> Coordinar una visita
                </>
              )}
            </a>
          ))}
        </div>
      )}

      <footer className="sc-footer">
        <p>
          Las fotos de «{ORIGINAL_TITLE}» muestran la propiedad como está hoy.
          Las propuestas son ilustrativas y no implican reformas.
        </p>
        <a
          href="/"
          target={origin === "embed" ? "_blank" : undefined}
          rel={origin === "embed" ? "noopener" : undefined}
        >
          Ambientación virtual con amoblaIA
        </a>
      </footer>

      {zoom && room && proposal && (
        <ProposalViewer
          original={original}
          proposal={proposal}
          disclosure={STAGING_LABEL}
          proposalTitle={`${PROPOSAL_TITLE} · ${group?.name}`}
          initial={zoom}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}

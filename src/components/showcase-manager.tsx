"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Code2,
  Copy,
  ExternalLink,
  ImagePlus,
  Images,
  Link2,
  LoaderCircle,
  MessageCircle,
  Plus,
  Power,
  Trash2,
  X,
} from "lucide-react";
import {
  embedCode,
  normalizeWhatsapp,
  showcasePath,
} from "@/lib/showcase-shared";

type Room = { projectId: string; label: string };
type Ficha = {
  id: string;
  token: string;
  title: string;
  agencyName: string | null;
  logo: string | null;
  whatsapp: string | null;
  active: boolean;
  createdAt: string;
  rooms: Room[];
};
type Candidate = {
  projectId: string;
  name: string;
  roomName: string;
  original: string;
  proposals: number;
  reviewed: number;
};
type Draft = { title: string; agencyName: string; whatsapp: string };

async function call(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.assign("/acceso?next=%2Ffichas");
    throw new Error("Ingresá a tu cuenta para seguir.");
  }
  if (!response.ok)
    throw new Error(payload.error || "No pudimos completar la operación.");
  return payload;
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Showcases: one link per property with the real photo of each room and the
 * proposals the agent reviewed. The same showcase can be embedded in the
 * agency's site.
 */
export function ShowcaseManager() {
  const [fichas, setFichas] = useState<Ficha[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    title: "",
    agencyName: "",
    whatsapp: "",
  });
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsDirty, setRoomsDirty] = useState(false);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    try {
      const session = await call("/api/session");
      if (!session.authenticated || session.anonymous) {
        window.location.assign("/acceso?next=%2Ffichas");
        return;
      }
      const data = await call("/api/fichas");
      setFichas(data.fichas);
      setCandidates(data.candidates);
      return data.fichas as Ficha[];
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cargar tus fichas.");
      setFichas((f) => f || []);
    }
  }, []);
  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const ficha = fichas?.find((f) => f.id === selected) || null;
  function open(f: Ficha) {
    setSelected(f.id);
    setCreating(false);
    setDraft({
      title: f.title,
      agencyName: f.agencyName || "",
      whatsapp: f.whatsapp || "",
    });
    setRooms(f.rooms);
    setRoomsDirty(false);
    setError("");
  }
  function startNew() {
    const last = fichas?.[0];
    setSelected(null);
    setCreating(true);
    // The agency and its WhatsApp usually repeat from one property to the next.
    setDraft({
      title: "",
      agencyName: last?.agencyName || "",
      whatsapp: last?.whatsapp || "",
    });
    setError("");
  }
  async function run(task: () => Promise<void>, done?: string) {
    setBusy(true);
    setError("");
    try {
      await task();
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar el cambio.");
    } finally {
      setBusy(false);
    }
  }
  const phoneOk = Boolean(normalizeWhatsapp(draft.whatsapp));
  async function create(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      const made = await call("/api/fichas", json("POST", draft));
      const list = await load();
      const f = list?.find((x) => x.id === made.id);
      if (f) open(f);
    }, "Ficha creada. Ahora sumale los ambientes.");
  }
  async function saveData(e: React.FormEvent) {
    e.preventDefault();
    if (!ficha) return;
    await run(async () => {
      await call(`/api/fichas/${ficha.id}`, json("PATCH", draft));
      await load();
    }, "Datos guardados.");
  }
  async function saveRooms() {
    if (!ficha) return;
    await run(async () => {
      await call(`/api/fichas/${ficha.id}`, json("PATCH", { rooms }));
      await load();
      setRoomsDirty(false);
    }, "Ambientes guardados.");
  }
  async function toggle(f: Ficha) {
    await run(
      async () => {
        await call(`/api/fichas/${f.id}`, json("PATCH", { active: !f.active }));
        await load();
      },
      f.active
        ? "Enlace desactivado: la ficha y su versión para tu web dejaron de verse."
        : "Enlace activado.",
    );
  }
  async function remove(f: Ficha) {
    if (
      !window.confirm(
        `¿Borrar la ficha «${f.title}»? El enlace y el código para tu web dejan de funcionar. Las fotos siguen en tu biblioteca.`,
      )
    )
      return;
    await run(async () => {
      await call(`/api/fichas/${f.id}`, { method: "DELETE" });
      setSelected(null);
      await load();
    }, "Ficha borrada.");
  }
  async function uploadLogo(file?: File) {
    if (!ficha || !file) return;
    const body = new FormData();
    body.set("logo", file);
    await run(async () => {
      await call(`/api/fichas/${ficha.id}/logo`, { method: "POST", body });
      await load();
    }, "Logo guardado.");
  }
  async function removeLogo() {
    if (!ficha) return;
    await run(async () => {
      await call(`/api/fichas/${ficha.id}/logo`, { method: "DELETE" });
      await load();
    }, "Quitamos el logo.");
  }
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 2500);
    } catch {
      setError("No pudimos copiar. Seleccioná el texto y copialo a mano.");
    }
  }
  function changeRooms(next: Room[]) {
    setRooms(next);
    setRoomsDirty(true);
  }
  const link = ficha ? `${origin}${showcasePath(ficha.token)}` : "";
  const code = ficha ? embedCode(origin, ficha.token, ficha.title) : "";
  const available = candidates.filter(
    (c) => !rooms.some((r) => r.projectId === c.projectId),
  );
  const candidate = (id: string) => candidates.find((c) => c.projectId === id);

  const dataForm = (
    <>
      <label className="fm-field">
        <span>Título de la propiedad</span>
        <input
          required
          maxLength={120}
          value={draft.title}
          placeholder="Ej.: 3 ambientes con balcón en Güemes"
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </label>
      <label className="fm-field">
        <span>
          Inmobiliaria <em>opcional</em>
        </span>
        <input
          maxLength={80}
          value={draft.agencyName}
          placeholder="Nombre que ven los compradores"
          onChange={(e) => setDraft({ ...draft, agencyName: e.target.value })}
        />
      </label>
      <label className="fm-field">
        <span>WhatsApp para consultas</span>
        <input
          required
          inputMode="tel"
          autoComplete="tel"
          value={draft.whatsapp}
          placeholder="5492235551234"
          aria-describedby="fm-phone-hint"
          onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })}
        />
        <small id="fm-phone-hint">
          Con código de país y área, sin 0 ni 15. En Argentina: 549 + área +
          número.
        </small>
      </label>
    </>
  );

  return (
    <div className="container fm-page">
      <div className="fm-heading">
        <div>
          <h1>Fichas de propiedades</h1>
          <p>
            Un enlace por propiedad con la foto real de cada ambiente y las
            propuestas que revisaste. Los compradores la abren sin cuenta y te
            consultan por WhatsApp.
          </p>
        </div>
        <button className="button button-primary" onClick={startNew}>
          <Plus size={17} /> Nueva ficha
        </button>
      </div>

      {(error || notice) && (
        <div
          className={`feedback ${error ? "error" : "notice"}`}
          role={error ? "alert" : "status"}
        >
          <p>{error || notice}</p>
          <button
            className="icon-button"
            aria-label="Cerrar aviso"
            onClick={() => (error ? setError("") : setNotice(""))}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div className="fm-layout">
        <aside className="fm-list" aria-label="Tus fichas">
          {fichas === null ? (
            <p className="fm-loading">
              <LoaderCircle className="spin" size={16} /> Cargando tus fichas…
            </p>
          ) : fichas.length === 0 ? (
            <div className="fm-empty">
              <p>Todavía no creaste fichas.</p>
              <p>
                Primero generá y <strong>revisá</strong> propuestas en el{" "}
                <Link href="/estudio">estudio</Link>; después armá la ficha
                con los ambientes de la propiedad.
              </p>
            </div>
          ) : (
            fichas.map((f) => (
              <button
                key={f.id}
                className={`fm-item ${f.id === selected ? "selected" : ""}`}
                onClick={() => open(f)}
              >
                <strong>{f.title}</strong>
                <span>
                  <i className={f.active ? "fm-on" : "fm-off"} />
                  {f.active ? "Enlace activo" : "Enlace desactivado"} ·{" "}
                  {f.rooms.length}{" "}
                  {f.rooms.length === 1 ? "ambiente" : "ambientes"}
                </span>
              </button>
            ))
          )}
        </aside>

        <section className="fm-main">
          {creating ? (
            <form className="fm-card" onSubmit={create}>
              <h2>Nueva ficha</h2>
              {dataForm}
              <div className="fm-actions">
                <button
                  className="button button-primary"
                  disabled={busy || !draft.title.trim() || !phoneOk}
                >
                  {busy && <LoaderCircle className="spin" size={16} />} Crear
                  ficha
                </button>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setCreating(false)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : !ficha ? (
            <div className="fm-card fm-uses">
              <h2>Una misma ambientación, tres formas de usarla</h2>
              <ul>
                <li>
                  <Images size={18} />
                  <span>
                    <strong>Descargá una comparativa</strong> desde el estudio,
                    con el estado actual y la propuesta rotulada, para
                    publicaciones, WhatsApp o visitas.
                  </span>
                </li>
                <li>
                  <Link2 size={18} />
                  <span>
                    <strong>Compartí una propiedad interactiva</strong>: el
                    comprador abre la foto real, explora los estilos
                    disponibles y te consulta.
                  </span>
                </li>
                <li>
                  <Code2 size={18} />
                  <span>
                    <strong>Integrala en tu web</strong> con un código para
                    copiar y pegar, si tu sitio permite insertar iframes.
                  </span>
                </li>
              </ul>
              {fichas?.length ? (
                <p className="fm-hint">Elegí una ficha para editarla.</p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="fm-card">
                <div className="fm-card-title">
                  <h2>{ficha.title}</h2>
                  <button
                    className={`fm-switch ${ficha.active ? "is-on" : ""}`}
                    role="switch"
                    aria-checked={ficha.active}
                    disabled={busy}
                    onClick={() => toggle(ficha)}
                  >
                    <Power size={15} />
                    {ficha.active ? "Enlace activo" : "Enlace desactivado"}
                  </button>
                </div>
                {!ficha.active && (
                  <p className="fm-warning">
                    Mientras esté desactivado, el enlace y la versión para tu
                    web muestran «Esta ficha no está disponible».
                  </p>
                )}
                <div className="fm-share">
                  <input readOnly value={link} aria-label="Enlace de la ficha" />
                  <button
                    className="button button-dark"
                    onClick={() => copy(link, "link")}
                  >
                    {copied === "link" ? <Check size={16} /> : <Copy size={16} />}{" "}
                    {copied === "link" ? "Copiado" : "Copiar enlace"}
                  </button>
                  <a
                    className="button button-outline"
                    href={showcasePath(ficha.token)}
                    target="_blank"
                    rel="noopener"
                  >
                    <ExternalLink size={16} /> Ver ficha
                  </a>
                  <a
                    className="button button-outline"
                    href={`https://wa.me/?text=${encodeURIComponent(`${ficha.title}\n${link}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle size={16} /> Enviar por WhatsApp
                  </a>
                </div>
              </div>

              <div className="fm-card">
                <h3>Ambientes</h3>
                <p className="fm-hint">
                  Cada ambiente muestra primero su foto real. Solo aparecen las
                  propuestas que marcaste como revisadas en el estudio; los
                  estilos sin propuesta no se ofrecen.
                </p>
                {rooms.length === 0 && (
                  <p className="fm-empty-rooms">Todavía no sumaste ambientes.</p>
                )}
                <ol className="fm-rooms">
                  {rooms.map((r, i) => {
                    const c = candidate(r.projectId);
                    return (
                      <li key={r.projectId}>
                        {c?.original ? (
                          <img src={c.original} alt="" />
                        ) : (
                          <span className="fm-thumb" />
                        )}
                        <div>
                          <input
                            value={r.label}
                            maxLength={60}
                            aria-label="Nombre del ambiente"
                            onChange={(e) =>
                              changeRooms(
                                rooms.map((x, j) =>
                                  j === i ? { ...x, label: e.target.value } : x,
                                ),
                              )
                            }
                          />
                          <small>
                            {!c
                              ? "La foto ya no está disponible en tu biblioteca."
                              : c.reviewed
                                ? `${c.reviewed} ${c.reviewed === 1 ? "propuesta revisada" : "propuestas revisadas"}`
                                : "Sin propuestas revisadas: se verá solo el estado actual."}{" "}
                            {c && c.reviewed < c.proposals && (
                              <Link href={`/estudio?project=${c.projectId}`}>
                                Revisar en el estudio
                              </Link>
                            )}
                          </small>
                        </div>
                        <div className="fm-room-actions">
                          <button
                            className="icon-button"
                            aria-label="Subir"
                            disabled={i === 0}
                            onClick={() => {
                              const next = [...rooms];
                              [next[i - 1], next[i]] = [next[i], next[i - 1]];
                              changeRooms(next);
                            }}
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label="Bajar"
                            disabled={i === rooms.length - 1}
                            onClick={() => {
                              const next = [...rooms];
                              [next[i + 1], next[i]] = [next[i], next[i + 1]];
                              changeRooms(next);
                            }}
                          >
                            <ArrowDown size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Quitar ${r.label}`}
                            onClick={() =>
                              changeRooms(rooms.filter((_, j) => j !== i))
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {available.length > 0 && rooms.length < 20 && (
                  <details className="fm-add">
                    <summary>
                      <Plus size={16} /> Agregar un ambiente
                    </summary>
                    <ul>
                      {available.map((c) => (
                        <li key={c.projectId}>
                          <button
                            onClick={() =>
                              changeRooms([
                                ...rooms,
                                { projectId: c.projectId, label: c.roomName },
                              ])
                            }
                          >
                            {c.original ? (
                              <img src={c.original} alt="" />
                            ) : (
                              <span className="fm-thumb" />
                            )}
                            <span>
                              <strong>{c.name}</strong>
                              <small>
                                {c.roomName} · {c.reviewed} de {c.proposals}{" "}
                                revisadas
                              </small>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {candidates.length === 0 && (
                  <p className="fm-hint">
                    No hay fotos con propuestas de Amoblar o Rediseñar todavía.{" "}
                    <Link href="/estudio">Crear una en el estudio</Link>.
                  </p>
                )}
                <div className="fm-actions">
                  <button
                    className="button button-primary"
                    disabled={busy || !roomsDirty}
                    onClick={saveRooms}
                  >
                    {busy && <LoaderCircle className="spin" size={16} />} Guardar
                    ambientes
                  </button>
                  {roomsDirty && (
                    <span className="fm-hint">Tenés cambios sin guardar.</span>
                  )}
                </div>
              </div>

              <form className="fm-card" onSubmit={saveData}>
                <h3>Datos de la ficha</h3>
                {dataForm}
                <div className="fm-logo">
                  <span>
                    Logo <em>opcional</em>
                  </span>
                  {ficha.logo ? (
                    <img src={ficha.logo} alt="Logo actual" />
                  ) : (
                    <span className="fm-hint">Sin logo.</span>
                  )}
                  <label className="button button-outline button-small">
                    <ImagePlus size={15} /> {ficha.logo ? "Cambiar" : "Subir"}
                    <input
                      type="file"
                      className="visually-hidden"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        void uploadLogo(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {ficha.logo && (
                    <button
                      type="button"
                      className="button button-outline button-small"
                      onClick={removeLogo}
                    >
                      Quitar
                    </button>
                  )}
                </div>
                <div className="fm-actions">
                  <button
                    className="button button-primary"
                    disabled={busy || !draft.title.trim() || !phoneOk}
                  >
                    Guardar datos
                  </button>
                </div>
              </form>

              <div className="fm-card" id="insertar">
                <h3>
                  <Code2 size={18} /> Insertar en mi web
                </h3>
                <p className="fm-hint">
                  Muestra esta misma ficha dentro de tu sitio, con tu identidad,
                  la foto real, las propuestas rotuladas y el botón de contacto.
                </p>
                <textarea
                  readOnly
                  rows={5}
                  value={code}
                  aria-label="Código para insertar"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div className="fm-actions">
                  <button
                    className="button button-dark"
                    onClick={() => copy(code, "code")}
                  >
                    {copied === "code" ? <Check size={16} /> : <Copy size={16} />}{" "}
                    {copied === "code" ? "Copiado" : "Copiar código"}
                  </button>
                </div>
                <ol className="fm-steps">
                  <li>Copiá el código.</li>
                  <li>
                    En el editor de tu web, agregá un bloque de «HTML
                    personalizado», «Insertar código» o «Embed» y pegalo.
                  </li>
                  <li>Publicá la página y revisala desde el celular.</li>
                </ol>
                <p className="fm-warning">
                  Requiere una web o proveedor que permita insertar iframes.
                  Muchos portales inmobiliarios no lo permiten: en ese caso,
                  compartí el enlace de la ficha. Si tu editor no acepta
                  scripts, pegá solo la primera línea (el iframe); funciona
                  igual con una altura fija.
                </p>
              </div>

              <button
                className="fm-delete"
                disabled={busy}
                onClick={() => remove(ficha)}
              >
                <Trash2 size={15} /> Borrar ficha
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

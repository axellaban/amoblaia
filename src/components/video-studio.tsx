"use client";
// "Video" in the agency's panel (Fase 5B): a property, its photos (suggested
// and reorderable), the mode and the format, the cost before generating, and
// the render. The "Clásico" montage is made in this browser and uploaded to
// Habita's storage; the AI modes show what they are and stay off until their
// provider is enabled. Steps, not a timeline: it has to work on a phone.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Download, Film, Loader2, Play, Share2, Sparkles, X } from "lucide-react";
import { ApiError, api } from "./admin-demos";
import { track } from "@/lib/analytics";
import { adminPhotoUrl, type PublicDemo } from "@/lib/demos/shared";
import type { PanelProperty } from "@/lib/agency/shared";
import { browserClient } from "@/lib/supabase/client";
import { MAX_VIDEO_PHOTOS, MODE_INFO, planVideo, suggestPhotos, type VideoFormat, type VideoMode } from "@/lib/video/plan";
import type { PublicVideo } from "@/lib/video/server";

const deviceType = () => (typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches ? "mobile" : "desktop");
const seconds = (ms: number) => Math.round(ms / 1000);

/** The agency's properties to choose from, with their cover. */
function PropertyPicker() {
  const [items, setItems] = useState<PanelProperty[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ items: PanelProperty[] }>("/api/panel/propiedades?por=48")
      .then((d) => setItems(d.items))
      .catch((e) => setError(e instanceof Error ? e.message : "No pudimos cargar tus propiedades."));
  }, []);
  return (
    <section className="vs-step" aria-labelledby="vs-pick">
      <h2 id="vs-pick">Elegí la propiedad</h2>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!items && !error && <p role="status">Cargando propiedades…</p>}
      {items && !items.length && (
        <p className="ap-empty">
          Todavía no tenés propiedades. <Link href="/panel#crear">Creá una pegando su enlace</Link> y volvé acá.
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="vs-props">
          {items.map((p) => (
            <li key={p.id}>
              <Link
                href={`/panel/video?propiedad=${p.id}`}
                onClick={() => track("video_property_selected", { photos: p.photos, staged: p.staged, device_type: deviceType() })}
              >
                {p.coverPhotoId ? <img src={adminPhotoUrl(p.coverPhotoId, null, 480)} alt="" loading="lazy" /> : <span className="vs-noimg">Sin fotos</span>}
                <strong>{p.title}</strong>
                <small>
                  {p.photos} {p.photos === 1 ? "foto" : "fotos"}
                  {p.staged ? ` · ${p.staged} con IA` : ""}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Choice = { id: string; label: string; staged: boolean; version: PublicDemo["photos"][number]["versions"][number] | null };

export function VideoStudio({ demoId, demo, canEdit }: { demoId: string | null; demo: PublicDemo | null; canEdit: boolean }) {
  useEffect(() => {
    track("video_section_viewed", { has_property: Boolean(demo), device_type: deviceType() });
  }, [demo]);
  if (!demo || !demoId) {
    return (
      <div className="vs">
        <header className="vs-head">
          <h1>Video</h1>
          <p>Armá un video de tu propiedad con sus fotos y sus datos reales, listo para Reels, WhatsApp y portales.</p>
        </header>
        <PropertyPicker />
      </div>
    );
  }
  return <Studio demoId={demoId} demo={demo} canEdit={canEdit} />;
}

function Studio({ demoId, demo, canEdit }: { demoId: string; demo: PublicDemo; canEdit: boolean }) {
  const [useStaged, setUseStaged] = useState(true);
  const all: Choice[] = useMemo(
    () =>
      demo.photos.map((p, i) => {
        const version = useStaged ? (p.versions[0] ?? null) : null;
        return { id: p.id, label: p.label || `Foto ${i + 1}`, staged: Boolean(version), version };
      }),
    [demo.photos, useStaged],
  );
  const [picked, setPicked] = useState<string[]>(() => suggestPhotos(demo.photos.map((p) => ({ id: p.id, staged: p.versions.length > 0 }))).map((p) => p.id));
  const [mode, setMode] = useState<VideoMode>("classic");
  const [format, setFormat] = useState<VideoFormat>("9:16");
  const [videos, setVideos] = useState<PublicVideo[] | null>(null);
  const [listError, setListError] = useState("");
  const [busy, setBusy] = useState<null | { stage: string; progress: number }>(null);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const chosen = picked.map((id) => all.find((c) => c.id === id)).filter((c): c is Choice => Boolean(c));
  const plan = chosen.length ? planVideo(chosen.length, format) : null;

  const load = useCallback(async () => {
    try {
      setVideos((await api<{ videos: PublicVideo[] }>(`/api/panel/videos?demo=${demoId}`)).videos);
      setListError("");
    } catch (e) {
      setListError(e instanceof Error ? e.message : "No pudimos cargar los videos.");
    }
  }, [demoId]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_VIDEO_PHOTOS ? p : [...p, id]));
  };
  const move = (id: string, step: number) =>
    setPicked((p) => {
      const i = p.indexOf(id);
      const j = i + step;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  // Reported once the person stops changing them.
  const reported = useRef("");
  useEffect(() => {
    const key = `${picked.join(",")}|${useStaged}`;
    if (key === reported.current) return;
    const t = setTimeout(() => {
      reported.current = key;
      track("video_photos_selected", { photo_count: chosen.length, staged_count: chosen.filter((c) => c.staged).length });
    }, 1500);
    return () => clearTimeout(t);
  }, [picked, useStaged, chosen]);

  async function generate() {
    if (!plan || busy) return;
    setError("");
    setFresh(null);
    const started = Date.now();
    const props = { mode, format, photo_count: chosen.length, animated_photo_count: 0, credits_quoted: 0, provider: "browser", device_type: deviceType() };
    track("video_generate_clicked", props);
    const { canRender, loadAsset, renderMp4 } = await import("@/lib/video/render");
    if (!(await canRender(plan))) {
      track("video_generation_failed", { ...props, error_code: "unsupported_browser" });
      setError("Este navegador no puede crear el video. Probá con Chrome, Edge o Safari actualizados (en iPhone, iOS 17 o posterior), o desde una computadora.");
      return;
    }
    let videoId: string | null = null;
    const controller = new AbortController();
    abort.current = controller;
    try {
      setBusy({ stage: "Preparando…", progress: 0 });
      const created = await api<{ id: string; status: string; upload: { path: string; token: string; bucket: string } | null }>("/api/panel/videos", {
        method: "POST",
        body: JSON.stringify({ demoId, key: crypto.randomUUID(), mode, format, photoCount: chosen.length }),
      });
      videoId = created.id;
      if (!created.upload) throw new Error("No pudimos preparar la subida del video.");
      track("video_generation_started", props);
      setBusy({ stage: "Cargando fotos…", progress: 0.02 });
      const assets = await Promise.all(chosen.map((c) => loadAsset(adminPhotoUrl(c.id, c.version, 2048), c.staged)));
      const logo = demo.agency.logo ? await loadAsset(demo.agency.logo, false).then((a) => a.image).catch(() => null) : null;
      const info = {
        title: demo.title,
        location: demo.location,
        price: demo.price ?? `Consultar ${/alquiler/i.test(demo.operation ?? "") ? "alquiler" : "precio"}`,
        operation: demo.operation,
        facts: demo.facts.map((f) => `${f.value} ${f.label}`.trim()),
        agencyName: demo.agencyName,
        contact: demo.contact.whatsapp ?? demo.contact.phone ?? demo.contact.email ?? null,
      };
      const blob = await renderMp4(plan, info, assets, logo, (p) => setBusy({ stage: "Creando el video…", progress: 0.05 + p * 0.8 }), controller.signal);
      setBusy({ stage: "Guardando…", progress: 0.9 });
      const client = browserClient();
      if (!client) throw new Error("No pudimos guardar el video.");
      const up = await client.storage.from(created.upload.bucket).uploadToSignedUrl(created.upload.path, created.upload.token, blob, { contentType: "video/mp4", upsert: true });
      if (up.error) throw new Error("No pudimos subir el video. Revisá tu conexión e intentá de nuevo.");
      await api("/api/panel/videos", { method: "PATCH", body: JSON.stringify({ demoId, id: videoId, ok: true, durationMs: plan.durationMs }) });
      track("video_generation_completed", { ...props, credits_charged: 0, duration_ms: Date.now() - started, video_ms: plan.durationMs, size_kb: Math.round(blob.size / 1024) });
      setFresh(videoId);
      await load();
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === "AbortError";
      const message = cancelled ? "Cancelaste el video." : e instanceof ApiError || e instanceof Error ? e.message : "No pudimos crear el video.";
      if (!cancelled) setError(message);
      track("video_generation_failed", { ...props, error_code: cancelled ? "cancelled" : e instanceof ApiError ? `api_${e.status}` : "render", duration_ms: Date.now() - started });
      if (videoId) await api("/api/panel/videos", { method: "PATCH", body: JSON.stringify({ demoId, id: videoId, ok: false, error: message }) }).catch(() => null);
      await load();
    } finally {
      abort.current = null;
      setBusy(null);
    }
  }

  async function share(v: PublicVideo) {
    if (!v.url) return;
    track("video_shared", { mode: v.mode, format: v.format });
    try {
      const file = typeof navigator.canShare === "function" ? await fetch(v.url).then((r) => r.blob()).then((b) => new File([b], `${demo.title}.mp4`, { type: "video/mp4" })) : null;
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: demo.title });
      else if (v.downloadUrl) window.location.assign(v.downloadUrl);
    } catch {
      // Cancelled by the person.
    }
  }

  const done = (videos ?? []).filter((v) => v.status === "completed");
  return (
    <div className="vs">
      <p>
        <Link href="/panel/video" className="text-link">
          <ArrowLeft size={15} aria-hidden="true" /> Elegir otra propiedad
        </Link>
      </p>
      <header className="vs-head">
        <h1>Video de {demo.title}</h1>
        {demo.location && <p>{demo.location}</p>}
      </header>

      {canEdit && (
        <>
          <section className="vs-step" aria-labelledby="vs-photos">
            <h2 id="vs-photos">
              <span className="vs-n">1</span> Fotos
            </h2>
            <p className="vs-hint">Te sugerimos las fotos ambientadas primero. Tocá para sumar o sacar; ordená con las flechas. Hasta {MAX_VIDEO_PHOTOS}.</p>
            <label className="vs-check">
              <input type="checkbox" checked={useStaged} onChange={(e) => setUseStaged(e.target.checked)} /> Usar las ambientaciones con IA cuando la foto tenga una
            </label>
            <ul className="vs-grid">
              {all.map((c) => {
                const n = picked.indexOf(c.id);
                return (
                  <li key={c.id}>
                    <button type="button" className={`vs-photo ${n >= 0 ? "is-on" : ""}`} aria-pressed={n >= 0} onClick={() => toggle(c.id)}>
                      <img src={adminPhotoUrl(c.id, c.version, 480)} alt={c.label} loading="lazy" />
                      {n >= 0 && <span className="vs-order">{n + 1}</span>}
                      {c.staged && <span className="vs-ai">IA</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            {chosen.length > 0 && (
              <ol className="vs-order-list" aria-label="Orden del video">
                {chosen.map((c, i) => (
                  <li key={c.id}>
                    <img src={adminPhotoUrl(c.id, c.version, 480)} alt="" />
                    <span>{c.label}</span>
                    <button type="button" aria-label={`Subir ${c.label}`} disabled={i === 0} onClick={() => move(c.id, -1)}>
                      <ArrowUp size={16} />
                    </button>
                    <button type="button" aria-label={`Bajar ${c.label}`} disabled={i === chosen.length - 1} onClick={() => move(c.id, 1)}>
                      <ArrowDown size={16} />
                    </button>
                    <button type="button" aria-label={`Sacar ${c.label}`} onClick={() => toggle(c.id)}>
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="vs-step" aria-labelledby="vs-mode">
            <h2 id="vs-mode">
              <span className="vs-n">2</span> Estilo de video
            </h2>
            <div className="vs-options" role="radiogroup" aria-labelledby="vs-mode">
              {(["classic", "balanced", "cinematic"] as VideoMode[]).map((m) => {
                const live = m === "classic";
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    aria-disabled={!live}
                    className={`vs-option ${mode === m ? "is-on" : ""} ${live ? "" : "is-later"}`}
                    onClick={() => {
                      if (!live) return;
                      setMode(m);
                      track("video_mode_selected", { mode: m });
                    }}
                  >
                    <strong>
                      {m === "classic" ? <Film size={17} aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />} {MODE_INFO[m].name}
                    </strong>
                    <span>{MODE_INFO[m].text}</span>
                    <small>{live ? "Sin créditos" : "Próximamente: se habilita con la animación con IA"}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="vs-step" aria-labelledby="vs-format">
            <h2 id="vs-format">
              <span className="vs-n">3</span> Formato
            </h2>
            <div className="vs-options is-two" role="radiogroup" aria-labelledby="vs-format">
              {(["9:16", "16:9"] as VideoFormat[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={format === f}
                  className={`vs-option ${format === f ? "is-on" : ""}`}
                  onClick={() => {
                    setFormat(f);
                    track("video_format_selected", { format: f });
                  }}
                >
                  <span className={`vs-frame is-${f === "9:16" ? "v" : "h"}`} aria-hidden="true" />
                  <strong>{f === "9:16" ? "Vertical 9:16" : "Horizontal 16:9"}</strong>
                  <span>{f === "9:16" ? "Reels, historias y WhatsApp" : "Portales, YouTube y tu sitio"}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="vs-step vs-summary" aria-labelledby="vs-summary">
            <h2 id="vs-summary">
              <span className="vs-n">4</span> Generar
            </h2>
            {plan ? (
              <p>
                {chosen.length} {chosen.length === 1 ? "foto" : "fotos"} · {seconds(plan.durationMs)} segundos · {format === "9:16" ? "vertical" : "horizontal"} · <strong>Sin créditos</strong>
              </p>
            ) : (
              <p>Elegí al menos una foto.</p>
            )}
            <p className="vs-hint">Usa solo las fotos y los datos de la ficha: título, ubicación, {demo.price ? "precio" : "«Consultar precio»"}, ambientes y el contacto de {demo.agencyName}. Se crea en este navegador: no cierres la pestaña hasta que termine.</p>
            {busy ? (
              <div className="vs-progress" role="status" aria-live="polite">
                <Loader2 size={18} className="spin" aria-hidden="true" /> {busy.stage}
                <progress max={1} value={busy.progress} aria-label="Avance del video" />
                <button type="button" className="text-link" onClick={() => abort.current?.abort()}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button type="button" className="button button-primary button-large" disabled={!plan} onClick={() => void generate()}>
                <Play size={18} aria-hidden="true" /> Generar video
              </button>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </section>
        </>
      )}

      <section className="vs-step" aria-labelledby="vs-history">
        <h2 id="vs-history">Videos de esta propiedad</h2>
        {listError && (
          <p className="inline-error" role="alert">
            {listError}
          </p>
        )}
        {videos && !videos.length && <p className="ap-empty">Todavía no hay videos.</p>}
        <ul className="vs-videos">
          {(videos ?? []).map((v) => (
            <li key={v.id} className={v.id === fresh ? "is-fresh" : ""}>
              {v.status === "completed" && v.url ? (
                <video
                  src={v.url}
                  controls
                  playsInline
                  preload="metadata"
                  className={`vs-video is-${v.format === "9:16" ? "v" : "h"}`}
                  onPlay={() => track("video_preview_played", { mode: v.mode, format: v.format })}
                />
              ) : (
                <div className={`vs-video is-${v.format === "9:16" ? "v" : "h"} vs-video-empty`}>{v.status === "failed" ? "No se pudo crear" : "Creando…"}</div>
              )}
              <div className="vs-video-meta">
                <strong>
                  {MODE_INFO[v.mode].name} · {v.format === "9:16" ? "Vertical" : "Horizontal"}
                </strong>
                <small>
                  {new Date(v.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })} · {v.photoCount} fotos
                  {v.durationMs ? ` · ${seconds(v.durationMs)} s` : ""}
                </small>
                {v.status === "failed" && v.error && <small className="ap-error-text">{v.error}</small>}
                {v.status === "completed" && (
                  <span className="vs-video-actions">
                    {v.downloadUrl && (
                      <a className="button button-small" href={v.downloadUrl} onClick={() => track("video_downloaded", { mode: v.mode, format: v.format })}>
                        <Download size={15} aria-hidden="true" /> Descargar MP4
                      </a>
                    )}
                    <button type="button" className="button button-small button-outline" onClick={() => void share(v)}>
                      <Share2 size={15} aria-hidden="true" /> Compartir
                    </button>
                    {v.id === fresh && (
                      <span className="vs-done">
                        <Check size={15} aria-hidden="true" /> Listo
                      </span>
                    )}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
        {done.length > 0 && <p className="vs-hint">Los enlaces de los videos se renuevan cada vez que abrís esta página.</p>}
      </section>
    </div>
  );
}

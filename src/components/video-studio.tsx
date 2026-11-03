"use client";
// «Crear video» in the agency's panel. The three ways in (an existing
// property, an imported listing, uploaded photos without a ficha) end here:
// the photos (chosen and ordered), a live preview drawn by the same code
// that renders the MP4, the optional information, the style, one of four
// export formats and, for a ficha, where its demo shows the video. The
// "Clásico" montage is made in this browser (WebCodecs H.264 → MP4) and
// uploaded to Habita's storage, without credits. The AI modes are shown
// as not available until their provider is enabled. Guided steps, not a
// timeline: it has to work on a phone.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  Film,
  Home,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Share2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { ApiError, api } from "./admin-demos";
import { StartPicker } from "./start-picker";
import { track as trackEvent, type EventProperties } from "@/lib/analytics";
import { adminPhotoUrl, type PublicDemo } from "@/lib/demos/shared";
import type { VideoPlacement } from "@/lib/demos/branding";
import { browserClient } from "@/lib/supabase/client";
import {
  DEFAULT_FORMAT,
  FORMAT_INFO,
  formatRatio,
  INFO_FIELDS,
  INFO_LABEL,
  infoAvailable,
  isVideoFormat,
  MAX_VIDEO_PHOTOS,
  MODE_INFO,
  photoStarts,
  planVideo,
  resolutionOf,
  suggestPhotos,
  VIDEO_FORMATS,
  videoCards,
  type InfoChoice,
  type InfoField,
  type InfoSource,
  type VideoFormat,
  type VideoMode,
  type VideoPlan,
} from "@/lib/video/plan";
import { drawFrame, type VideoAsset, type VideoInfo } from "@/lib/video/render";
import type { PublicVideo, VideoOptions } from "@/lib/video/server";

/** Where the property's video goes in its demo (spec: three positions; «No mostrar» kept). */
const PLACEMENTS: { id: VideoPlacement; name: string; text: string }[] = [
  { id: "first", name: "Primero en la galería", text: "La primera miniatura del carrusel." },
  { id: "second", name: "Segundo en la galería", text: "Después de la primera foto." },
  { id: "below", name: "Debajo de las fotos", text: "Una tarjeta con portada y «Ver video»." },
  { id: "hidden", name: "No mostrar", text: "La demostración no muestra el video." },
];

const deviceType = () => (typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches ? "mobile" : "desktop");
const seconds = (ms: number) => Math.round(ms / 1000);
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const message = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message || fallback : fallback);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** /panel/video without a property: the same three ways in as the home's «Crear video». */
function StartScreen() {
  const [open, setOpen] = useState<null | "elegir" | "importar" | "subir">(null);
  const options = [
    { id: "elegir" as const, icon: Home, title: "Elegir una propiedad existente", text: "Usá las fotos y los datos que ya están en tu panel." },
    { id: "importar" as const, icon: Link2, title: "Importar nueva propiedad desde URL", text: "Traé sus fotos desde una publicación." },
    { id: "subir" as const, icon: Upload, title: "Subir fotos", text: "Sin crear una ficha: el video se puede generar y descargar igual." },
  ];
  return (
    <div className="vs">
      <header className="vs-head">
        <h1>Crear video</h1>
        <p>Generá videos de tus propiedades listos para publicar y compartir.</p>
      </header>
      <section className="vs-card vs-start" aria-labelledby="vs-start">
        <h2 id="vs-start">Elegí cómo empezar</h2>
        <ul className="sp-options">
          {options.map(({ id, icon: Icon, title, text }) => (
            <li key={id}>
              <button type="button" className="sp-option" aria-haspopup="dialog" onClick={() => setOpen(id)}>
                <span className="sp-option-icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span className="sp-option-text">
                  <strong>{title}</strong>
                  <small>{text}</small>
                </span>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>
      {open && <StartPicker tool="video" existingCount={1} initialSource={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

type Choice = { id: string; label: string; staged: boolean; version: PublicDemo["photos"][number]["versions"][number] | null };

export function VideoStudio({
  demoId,
  demo,
  kind = "ficha",
  info = null,
  published = false,
  canEdit,
  placement = "below",
  backTo = null,
  team = false,
  previewHref = null,
}: {
  demoId: string | null;
  demo: PublicDemo | null;
  /** "fotos": photos uploaded or imported without a ficha. The video is made and downloaded all the same. */
  kind?: "ficha" | "fotos";
  /** The information the video may carry: real data only, already without what the ficha hides. */
  info?: InfoSource | null;
  published?: boolean;
  canEdit: boolean;
  /** Where this property's demo shows its video. */
  placement?: VideoPlacement;
  /** Opened from the demo's editor («Generar video»): the way back to it, with its tab. */
  backTo?: string | null;
  /** The team, from the administrative edit: nothing is reported as the agency's own activity. */
  team?: boolean;
  /** Where «Ver vista previa de la ficha» goes (the team's own preview from administration). */
  previewHref?: string | null;
}) {
  useEffect(() => {
    if (!team) trackEvent("video_section_viewed", { has_property: Boolean(demo), is_group: kind === "fotos", device_type: deviceType() });
  }, [demo, kind, team]);
  if (!demo || !demoId) return <StartScreen />;
  return (
    <Studio
      demoId={demoId}
      demo={demo}
      kind={kind}
      info={info ?? { title: null, location: null, price: null, priceFallback: "Consultar precio", operation: null, facts: [], agencyName: demo.agencyName, logo: false, contact: null }}
      published={published}
      canEdit={canEdit}
      initialPlacement={placement}
      backTo={backTo}
      team={team}
      previewHref={previewHref ?? `/panel/propiedades/${demoId}/vista-previa`}
    />
  );
}

/** The editor's choices, kept per property in this browser while the person works (not the property's data). */
type Draft = { photos: string[]; staged: boolean; format: VideoFormat; info: boolean; fields: InfoField[] };
const draftKey = (id: string) => `habita.video.${id}`;
function readDraft(id: string): Draft | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(draftKey(id)) ?? "null") as Partial<Draft> | null;
    if (!raw || !Array.isArray(raw.photos)) return null;
    return {
      photos: raw.photos.filter((p): p is string => typeof p === "string"),
      staged: raw.staged !== false,
      format: isVideoFormat(raw.format) ? raw.format : DEFAULT_FORMAT,
      info: raw.info === true,
      fields: Array.isArray(raw.fields) ? raw.fields.filter((f): f is InfoField => INFO_FIELDS.includes(f as InfoField)) : [],
    };
  } catch {
    return null;
  }
}
function saveDraft(id: string, d: Draft) {
  try {
    window.localStorage.setItem(draftKey(id), JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

/** Decoded photos for the preview, shared between renders (each URL once). */
const bitmapCache = new Map<string, Promise<ImageBitmap>>();
function bitmap(url: string) {
  let p = bitmapCache.get(url);
  if (!p) {
    p = fetch(url, { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error("PHOTO_LOAD_FAILED");
        return r.blob();
      })
      .then((b) => createImageBitmap(b));
    p.catch(() => bitmapCache.delete(url));
    bitmapCache.set(url, p);
  }
  return p;
}

type Command = { kind: "play" | "seek"; ms: number; n: number };

/**
 * The big viewer: the real frames of the video (the same drawFrame the MP4
 * uses), at half size, in the chosen format's proportion. Silent: the
 * montage has no music.
 */
function Preview({
  plan,
  cards,
  sources,
  logoUrl,
  command,
  onPlay,
}: {
  plan: VideoPlan | null;
  cards: VideoInfo;
  sources: { url: string; staged: boolean }[];
  logoUrl: string | null;
  command: Command | null;
  onPlay: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [assets, setAssets] = useState<VideoAsset[] | null>(null);
  const [logo, setLogo] = useState<ImageBitmap | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const time = useRef(0);
  const key = sources.map((s) => `${s.url}|${s.staged}`).join(",");

  useEffect(() => {
    let live = true;
    setLoadError(false);
    Promise.all(sources.map((s) => bitmap(s.url).then((image) => ({ image, staged: s.staged }))))
      .then((a) => live && setAssets(a))
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
    // The sources are compared by their key, not their identity.
    // (sources is read through the key)
  }, [key]);
  useEffect(() => {
    if (!logoUrl) return;
    bitmap(logoUrl)
      .then(setLogo)
      .catch(() => setLogo(null));
  }, [logoUrl]);

  const small = useMemo(() => (plan ? { ...plan, width: Math.round(plan.width / 2), height: Math.round(plan.height / 2) } : null), [plan]);
  const ready = Boolean(small && assets && assets.length === sources.length && sources.length > 0);

  const draw = useCallback(
    (ms: number) => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx || !small || !assets || assets.length !== sources.length) return;
      drawFrame(ctx, small, cards, assets, logo, ms);
    },
    [small, assets, sources.length, cards, logo],
  );

  // A new plan (format, photos, information): back to a still frame that shows it.
  useEffect(() => {
    if (!plan) return;
    if (time.current > plan.durationMs) time.current = 0;
    setT(time.current);
    draw(time.current);
  }, [plan, draw]);

  useEffect(() => {
    if (!playing || !plan) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      time.current += now - last;
      last = now;
      if (time.current >= plan.durationMs) {
        time.current = 0;
        setPlaying(false);
        draw(0);
        setT(0);
        return;
      }
      draw(time.current);
      setT(time.current);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, plan, draw]);

  useEffect(() => {
    if (!command || !plan) return;
    time.current = Math.min(command.ms, plan.durationMs - 1);
    setT(time.current);
    draw(time.current);
    if (command.kind === "play") setPlaying(true);
  }, [command, plan, draw]);

  const ratio = plan ? plan.width / plan.height : 9 / 16;
  return (
    <div className="vs-viewer" ref={stage}>
      <div className="vs-screen" style={{ ["--ratio" as string]: String(ratio) }}>
        {small ? (
          <canvas ref={canvas} width={small.width} height={small.height} className="vs-canvas" aria-label={`Vista previa del video, ${plan!.width} × ${plan!.height}`} role="img" />
        ) : (
          <div className="vs-canvas vs-canvas-empty">Elegí al menos una foto</div>
        )}
        {small && !ready && <span className="vs-screen-note">{loadError ? "No pudimos cargar alguna foto para la vista previa." : "Preparando la vista previa…"}</span>}
      </div>
      <div className="vs-controls">
        <button
          type="button"
          className="vs-play"
          aria-label={playing ? "Pausar la vista previa" : "Reproducir la vista previa"}
          disabled={!ready}
          onClick={() => {
            if (!playing) onPlay();
            setPlaying((p) => !p);
          }}
        >
          {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>
        <span className="vs-time">
          {clock(t)} / {clock(plan?.durationMs ?? 0)}
        </span>
        <input
          type="range"
          className="vs-seek"
          min={0}
          max={plan?.durationMs ?? 0}
          step={100}
          value={Math.round(t)}
          aria-label="Posición de la vista previa"
          disabled={!ready}
          onChange={(e) => {
            time.current = Number(e.target.value);
            setT(time.current);
            draw(time.current);
          }}
        />
        <button
          type="button"
          className="vs-play"
          aria-label="Ver en pantalla completa"
          disabled={!ready}
          onClick={() => void stage.current?.requestFullscreen?.().catch(() => null)}
        >
          <Maximize size={17} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** The four export formats, each with its proportion drawn to scale. */
function FormatIcon({ format }: { format: VideoFormat }) {
  const { width, height } = { "9:16": { width: 18, height: 32 }, "16:9": { width: 36, height: 20 }, "4:5": { width: 24, height: 30 }, "1:1": { width: 28, height: 28 } }[format];
  return (
    <span className="vs-ratio" aria-hidden="true">
      <span style={{ width, height }} />
    </span>
  );
}

function Studio({
  demoId,
  demo,
  kind,
  info,
  published,
  canEdit,
  initialPlacement,
  backTo,
  team,
  previewHref,
}: {
  demoId: string;
  demo: PublicDemo;
  kind: "ficha" | "fotos";
  info: InfoSource;
  published: boolean;
  canEdit: boolean;
  initialPlacement: VideoPlacement;
  backTo: string | null;
  team: boolean;
  previewHref: string;
}) {
  const router = useRouter();
  // The team's work on an agency is not the agency's funnel: nothing is reported then.
  const track: typeof trackEvent = team ? () => undefined : trackEvent;
  const group = kind === "fotos";
  const known = useMemo(() => new Set(demo.photos.map((p) => p.id)), [demo.photos]);
  const [useStaged, setUseStaged] = useState(true);
  const all: Choice[] = useMemo(
    () =>
      demo.photos.map((p, i) => {
        // An AI staging that already exists: chosen here, never made (no credits for picking it).
        const version = useStaged ? (p.versions[0] ?? null) : null;
        return { id: p.id, label: p.label || `Foto ${i + 1}`, staged: Boolean(version), version };
      }),
    [demo.photos, useStaged],
  );
  const suggested = useMemo(() => suggestPhotos(demo.photos.map((p) => ({ id: p.id, staged: p.versions.length > 0 }))).map((p) => p.id), [demo.photos]);
  const [picked, setPicked] = useState<string[]>(suggested);
  const [mode, setMode] = useState<VideoMode>("classic");
  const [format, setFormat] = useState<VideoFormat>(DEFAULT_FORMAT);
  // Without a ficha the video is only the photos by default; a property may add its data.
  const [includeInfo, setIncludeInfo] = useState(!group);
  const [fields, setFields] = useState<InfoChoice>(() => Object.fromEntries(INFO_FIELDS.map((f) => [f, true])) as InfoChoice);
  const [placement, setPlacement] = useState<VideoPlacement>(initialPlacement);
  const [videos, setVideos] = useState<PublicVideo[] | null>(null);
  const [listError, setListError] = useState("");
  const [busy, setBusy] = useState<null | { stage: string; progress: number }>(null);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [command, setCommand] = useState<Command | null>(null);
  const abort = useRef<AbortController | null>(null);
  const restored = useRef(false);
  const touched = useRef(false);
  const resultRef = useRef<HTMLElement>(null);
  const photosRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  const base: EventProperties = useMemo(
    () => ({ agency_id: demo.agencyId, property_id: demoId, is_group: group, device_type: deviceType() }),
    [demo.agencyId, demoId, group],
  );

  const applyConfig = useCallback(
    (c: { photos: string[]; staged: boolean; info: boolean; fields: InfoField[]; format?: VideoFormat }) => {
      const photos = c.photos.filter((id) => known.has(id)).slice(0, MAX_VIDEO_PHOTOS);
      if (!photos.length) return false;
      setPicked(photos);
      setUseStaged(c.staged);
      setIncludeInfo(c.info);
      if (c.fields.length) setFields(Object.fromEntries(INFO_FIELDS.map((f) => [f, c.fields.includes(f)])) as InfoChoice);
      if (c.format) setFormat(c.format);
      return true;
    },
    [known],
  );

  // The choices made here before (this browser) come back first.
  useEffect(() => {
    const d = readDraft(demoId);
    if (d && applyConfig(d)) restored.current = true;
  }, [demoId, applyConfig]);

  const load = useCallback(async () => {
    try {
      const list = (await api<{ videos: PublicVideo[] }>(`/api/panel/videos?demo=${demoId}`)).videos;
      setVideos(list);
      setListError("");
      // Otherwise, the property's last video: its photos and information, ready to export another format.
      if (!restored.current && !touched.current) {
        const last = list.find((v) => v.options)?.options as VideoOptions | undefined;
        if (last) applyConfig(last);
        restored.current = true;
      }
    } catch (e) {
      setListError(message(e, "No pudimos cargar los videos."));
    }
  }, [demoId, applyConfig]);
  useEffect(() => {
    void load();
  }, [load]);

  const chosenFields = INFO_FIELDS.filter((f) => fields[f] && infoAvailable(info, f));
  // Kept for this property in this browser: the selection survives a reload and the way back from the demo.
  useEffect(() => {
    if (!touched.current) return;
    const ok = saveDraft(demoId, { photos: picked, staged: useStaged, format, info: includeInfo, fields: INFO_FIELDS.filter((f) => fields[f]) });
    setSaved(ok);
  }, [demoId, picked, useStaged, format, includeInfo, fields]);
  const touch = () => {
    touched.current = true;
    restored.current = true;
  };

  const chosen = picked.map((id) => all.find((c) => c.id === id)).filter((c): c is Choice => Boolean(c));
  const cards = useMemo(() => videoCards(info, includeInfo, fields), [info, includeInfo, fields]);
  const plan = useMemo(
    () => (chosen.length ? planVideo(chosen.length, format, { intro: Boolean(cards.intro), outro: Boolean(cards.outro) }) : null),
    [chosen.length, format, cards],
  );
  const sources = useMemo(() => chosen.map((c) => ({ url: adminPhotoUrl(c.id, c.version, 960), staged: c.staged })), [chosen]);

  const toggle = (id: string) => {
    touch();
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_VIDEO_PHOTOS ? p : [...p, id]));
  };
  const move = (id: string, step: number) => {
    touch();
    setPicked((p) => {
      const i = p.indexOf(id);
      const j = i + step;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    track("video_photos_reordered", { ...base, method: "buttons" });
  };
  const drop = (from: string, to: string) => {
    if (from === to) return;
    touch();
    setPicked((p) => {
      const next = p.filter((x) => x !== from);
      next.splice(next.indexOf(to), 0, from);
      return next;
    });
    track("video_photos_reordered", { ...base, method: "drag" });
  };
  const dragging = useRef<string | null>(null);

  // Reported once the person stops changing them.
  const reported = useRef("");
  useEffect(() => {
    const key = `${picked.join(",")}|${useStaged}`;
    if (key === reported.current) return;
    const t = setTimeout(() => {
      reported.current = key;
      track("video_photos_selected", { ...base, photo_count: chosen.length, staged_count: chosen.filter((c) => c.staged).length });
    }, 1500);
    return () => clearTimeout(t);
  }, [picked, useStaged, chosen, base]);

  const props = (): EventProperties => ({
    ...base,
    mode,
    format,
    video_mode: mode,
    video_format: format,
    photo_count: chosen.length,
    staged_count: chosen.filter((c) => c.staged).length,
    info_included: Boolean(cards.intro || cards.outro),
    animated_photo_count: 0,
    credits_quoted: 0,
    provider: "browser",
  });

  // Leaving while the browser renders loses the video: the browser asks first.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function generate() {
    if (!plan || busy || !canEdit) return;
    setError("");
    setFresh(null);
    const started = Date.now();
    const p = props();
    track("video_generate_clicked", p);
    // 1-3: the data, the photos and this browser, before anything is created.
    if (!chosen.length) return setError("Elegí al menos una foto.");
    const { canRender, loadAsset, renderMp4 } = await import("@/lib/video/render");
    if (!(await canRender(plan))) {
      track("video_generation_failed", { ...p, error_code: "unsupported_browser" });
      setError("Este navegador no puede crear el video. Probá con Chrome, Edge o Safari actualizados (en iPhone, iOS 17 o posterior), o desde una computadora.");
      return;
    }
    let videoId: string | null = null;
    let step = "create";
    const controller = new AbortController();
    abort.current = controller;
    try {
      setBusy({ stage: "Preparando…", progress: 0 });
      const options: VideoOptions = { photos: chosen.map((c) => c.id), staged: useStaged, info: includeInfo, fields: chosenFields };
      const created = await api<{ id: string; status: string; upload: { path: string; token: string; bucket: string } | null }>("/api/panel/videos", {
        method: "POST",
        body: JSON.stringify({ demoId, key: crypto.randomUUID(), mode, format, photoCount: chosen.length, options }),
      });
      videoId = created.id;
      if (!created.upload) throw new Error("No pudimos preparar la subida del video.");
      track("video_generation_started", { ...p, video_id: videoId });
      step = "photos";
      setBusy({ stage: "Cargando fotos…", progress: 0.02 });
      const assets = await Promise.all(chosen.map((c) => loadAsset(adminPhotoUrl(c.id, c.version, 2048), c.staged)));
      const logo = cards.outro?.logo && demo.agency.logo ? await loadAsset(demo.agency.logo, false).then((a) => a.image).catch(() => null) : null;
      step = "render";
      const blob = await renderMp4(plan, cards, assets, logo, (x) => setBusy({ stage: `Creando el video… ${Math.round(x * 100)}%`, progress: 0.05 + x * 0.8 }), controller.signal);
      step = "upload";
      setBusy({ stage: "Guardando…", progress: 0.9 });
      const client = browserClient();
      if (!client) throw new Error("No pudimos guardar el video.");
      const up = await client.storage.from(created.upload.bucket).uploadToSignedUrl(created.upload.path, created.upload.token, blob, { contentType: "video/mp4", upsert: true });
      if (up.error) throw new Error("No pudimos subir el video. Revisá tu conexión e intentá de nuevo.");
      // 8-9: «listo» only once the server finds the file in storage (a few tries while it settles).
      step = "storage";
      setBusy({ stage: "Confirmando…", progress: 0.97 });
      for (let attempt = 0; ; attempt++) {
        try {
          await api("/api/panel/videos", { method: "PATCH", body: JSON.stringify({ demoId, id: videoId, ok: true, durationMs: plan.durationMs }) });
          break;
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409) || attempt >= 3) throw e;
          await wait(1500 * (attempt + 1));
        }
      }
      track("video_generation_completed", {
        ...p,
        video_id: videoId,
        credits_charged: 0,
        duration_ms: plan.durationMs,
        render_ms: Date.now() - started,
        video_ms: plan.durationMs,
        size_kb: Math.round(blob.size / 1024),
      });
      setFresh(videoId);
      await load();
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === "AbortError";
      const text = cancelled
        ? "Cancelaste el video."
        : step === "photos"
          ? "No pudimos cargar una de las fotos. Revisá tu conexión y reintentá."
          : step === "render"
            ? "Falló la creación del video en este navegador. Reintentá; si se repite, probá desde una computadora."
            : step === "storage"
              ? `No pudimos confirmar el video guardado: ${message(e, "probá de nuevo")}`
              : message(e, "No pudimos crear el video.");
      setError(text);
      track("video_generation_failed", { ...p, ...(videoId ? { video_id: videoId } : {}), error_code: cancelled ? "cancelled" : e instanceof ApiError ? `api_${e.status}` : step, duration_ms: Date.now() - started });
      if (videoId) await api("/api/panel/videos", { method: "PATCH", body: JSON.stringify({ demoId, id: videoId, ok: false, error: text }) }).catch(() => null);
      await load();
    } finally {
      abort.current = null;
      setBusy(null);
    }
  }

  async function share(v: PublicVideo) {
    if (!v.url) return;
    track("video_shared", { ...base, video_id: v.id, mode: v.mode, format: v.format, video_mode: v.mode, video_format: v.format });
    try {
      const name = `${demo.title}.mp4`;
      const canFiles = typeof navigator.canShare === "function";
      const file = canFiles ? await fetch(v.url).then((r) => r.blob()).then((b) => new File([b], name, { type: "video/mp4" })) : null;
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: demo.title });
      else if (v.downloadUrl) {
        // No file sharing in this browser: the MP4 is downloaded to send it from the device.
        window.location.assign(v.downloadUrl);
        setError("Este navegador no permite compartir archivos: descargamos el MP4 para que lo envíes desde tu dispositivo.");
      }
    } catch {
      // Cancelled by the person.
    }
  }

  async function makeDemo() {
    try {
      setError("");
      await api(`/api/panel/imagenes/${demoId}/ficha`, { method: "POST" });
      track("video_used_in_demo", { ...base, action: "create_demo" });
      router.push(`/panel/propiedades/${demoId}?${new URLSearchParams({ seccion: "fotos", volver: "/panel/video?propiedad=" + demoId })}`);
    } catch (e) {
      setError(message(e, "No pudimos crear la demostración."));
    }
  }

  async function choosePlacement(next: VideoPlacement) {
    if (!canEdit || next === placement) return;
    const before = placement;
    setPlacement(next);
    try {
      await api("/api/panel/videos/ficha", { method: "POST", body: JSON.stringify({ demoId, placement: next }) });
      track("video_placement_selected", { ...base, placement: next });
    } catch (e) {
      setPlacement(before);
      setError(message(e, "No pudimos guardar dónde se muestra el video."));
    }
  }

  const done = (videos ?? []).filter((v) => v.status === "completed");
  const result = fresh ? done.find((v) => v.id === fresh) : null;
  const editorHref = `/panel/propiedades/${demoId}?seccion=fotos`;
  const title = group ? demo.title || "Fotos subidas" : demo.title;
  const infoText = cards.intro || cards.outro ? chosenFields.map((f) => INFO_LABEL[f]).join(", ") : "No: solo fotos";

  const generateButton = (cls = "") => (
    <button type="button" className={`button button-primary vs-generate ${cls}`} disabled={!plan || Boolean(busy) || !canEdit} onClick={() => void generate()}>
      {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Film size={18} aria-hidden="true" />} Generar video
      <small>Sin créditos</small>
    </button>
  );

  return (
    <div className="vs vs-editor-page">
      <header className="vs-bar">
        <Link href={backTo ?? "/panel/video"} className="icon-button vs-back" aria-label={backTo ? "Volver a la propiedad" : "Elegir otra propiedad"}>
          <ArrowLeft size={20} />
        </Link>
        <div className="vs-bar-title">
          <h1>{group ? `Video de ${title}` : `Video de ${title}`}</h1>
          <p>
            {team && `${demo.agencyName} · `}
            {group ? "Fotos sin ficha · no hace falta publicar nada" : (demo.location ?? "Propiedad")}
            {backTo && (
              <>
                {" · "}
                <Link href={backTo} className="text-link">
                  Volver a la demostración
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="vs-bar-actions">
          {saved && (
            <span className="vs-saved" role="status">
              <Check size={15} aria-hidden="true" /> Guardado
            </span>
          )}
          <button
            type="button"
            className="button button-outline vs-preview-go"
            disabled={!plan}
            onClick={() => {
              setCommand({ kind: "play", ms: 0, n: Date.now() });
              document.getElementById("vs-viewer")?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            <Eye size={17} aria-hidden="true" /> Vista previa
          </button>
          {canEdit && generateButton("vs-bar-generate")}
        </div>
      </header>

      {canEdit ? (
        <div className="vs-editor">
          <div className="vs-col vs-col-left">
            <section className="vs-card vs-photos" ref={photosRef} aria-labelledby="vs-photos" id="vs-fotos">
              <h2 id="vs-photos">Fotos y orden</h2>
              <p className="vs-hint">
                Tocá para sumar o sacar. {chosen.length} de {Math.min(MAX_VIDEO_PHOTOS, all.length)} elegidas (hasta {MAX_VIDEO_PHOTOS}).
              </p>
              <label className="vs-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={useStaged}
                  onChange={(e) => {
                    touch();
                    setUseStaged(e.target.checked);
                    track("video_staged_toggled", { ...base, enabled: e.target.checked });
                  }}
                />
                <span>
                  <strong>Usar ambientaciones con IA cuando estén disponibles</strong>
                  <small>Solo las que ya existen: no se crea ninguna nueva ni se usan créditos.</small>
                </span>
              </label>
              {all.length ? (
                <ul className="vs-grid">
                  {all.map((c) => {
                    const n = picked.indexOf(c.id);
                    const full = n < 0 && picked.length >= MAX_VIDEO_PHOTOS;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={`vs-photo ${n >= 0 ? "is-on" : ""}`}
                          aria-pressed={n >= 0}
                          aria-label={`${c.label}${n >= 0 ? `, foto ${n + 1} del video` : ""}`}
                          disabled={full}
                          title={full ? `Hasta ${MAX_VIDEO_PHOTOS} fotos` : undefined}
                          onClick={() => toggle(c.id)}
                        >
                          <img src={adminPhotoUrl(c.id, c.version, 480)} alt="" loading="lazy" />
                          {n >= 0 ? <span className="vs-order">{n + 1}</span> : <span className="vs-order is-off" aria-hidden="true" />}
                          {c.staged && <span className="vs-ai">IA</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="ap-empty">Esta propiedad todavía no tiene fotos.</p>
              )}
            </section>

            <section className="vs-card vs-style" aria-labelledby="vs-mode">
              <h2 id="vs-mode">Estilo del video</h2>
              <div className="vs-modes" role="radiogroup" aria-labelledby="vs-mode">
                {(["classic", "balanced", "cinematic"] as VideoMode[]).map((m) => {
                  const live = m === "classic";
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={mode === m}
                      aria-disabled={!live}
                      className={`vs-mode ${mode === m ? "is-on" : ""} ${live ? "" : "is-later"}`}
                      onClick={() => {
                        if (!live) return;
                        setMode(m);
                        track("video_mode_selected", { ...base, mode: m, video_mode: m });
                      }}
                    >
                      <span className="vs-mode-icon" aria-hidden="true">
                        {live ? <Film size={18} /> : <Sparkles size={18} />}
                      </span>
                      <span className="vs-mode-text">
                        <strong>{MODE_INFO[m].name}</strong>
                        <small>{live ? "Tus fotos con movimiento suave de cámara y transiciones." : MODE_INFO[m].text}</small>
                      </span>
                      <span className={`vs-tag ${live ? "is-free" : ""}`}>{live ? "Sin créditos" : "No disponible"}</span>
                      {mode === m && (
                        <span className="vs-tick" aria-hidden="true">
                          <Check size={13} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="vs-hint vs-duration">
                <Clock size={15} aria-hidden="true" /> Duración estimada: <strong>{plan ? `${seconds(plan.durationMs)} segundos` : "—"}</strong>
                <span>Se calcula según las fotos elegidas.</span>
              </p>
            </section>
          </div>

          <div className="vs-col vs-col-center">
            <section className="vs-card vs-stage" aria-label="Vista previa" id="vs-viewer">
              <Preview
                plan={plan}
                cards={cards}
                sources={sources}
                logoUrl={cards.outro?.logo ? demo.agency.logo : null}
                command={command}
                onPlay={() => track("video_draft_previewed", { ...props() })}
              />
              <ol className="vs-strip" aria-label="Orden del video">
                {chosen.map((c, i) => (
                  <li
                    key={c.id}
                    draggable
                    onDragStart={() => (dragging.current = c.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragging.current) drop(dragging.current, c.id);
                      dragging.current = null;
                    }}
                  >
                    <button
                      type="button"
                      className="vs-strip-thumb"
                      aria-label={`Ver ${c.label} en la vista previa`}
                      onClick={() => plan && setCommand({ kind: "seek", ms: photoStarts(plan)[i] + plan.fade + 300, n: Date.now() })}
                    >
                      <img src={adminPhotoUrl(c.id, c.version, 480)} alt="" />
                      <span className="vs-strip-n">{i + 1}</span>
                      {c.staged && <span className="vs-ai">IA</span>}
                    </button>
                    <span className="vs-strip-tools">
                      <button type="button" aria-label={`Mover ${c.label} antes`} disabled={i === 0} onClick={() => move(c.id, -1)}>
                        <ChevronLeft size={16} />
                      </button>
                      <button type="button" aria-label={`Sacar ${c.label}`} onClick={() => toggle(c.id)}>
                        <X size={15} />
                      </button>
                      <button type="button" aria-label={`Mover ${c.label} después`} disabled={i === chosen.length - 1} onClick={() => move(c.id, 1)}>
                        <ChevronRight size={16} />
                      </button>
                    </span>
                  </li>
                ))}
                {chosen.length < Math.min(MAX_VIDEO_PHOTOS, all.length) && (
                  <li className="vs-strip-add">
                    <button
                      type="button"
                      onClick={() => {
                        photosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                        (photosRef.current?.querySelector(".vs-photo:not(.is-on)") as HTMLButtonElement | null)?.focus({ preventScroll: true });
                      }}
                    >
                      <Plus size={18} aria-hidden="true" /> Agregar
                    </button>
                  </li>
                )}
              </ol>
            </section>

            <section className="vs-card vs-summary" ref={summaryRef} aria-labelledby="vs-summary">
              <h2 id="vs-summary">Generar video</h2>
              {plan ? (
                <dl className="vs-facts">
                  <div>
                    <dt>Fotos</dt>
                    <dd>{chosen.length}</dd>
                  </div>
                  <div>
                    <dt>Estilo</dt>
                    <dd>{MODE_INFO[mode].name}</dd>
                  </div>
                  <div>
                    <dt>Formato</dt>
                    <dd>{FORMAT_INFO[format].short}</dd>
                  </div>
                  <div>
                    <dt>Resolución</dt>
                    <dd>{resolutionOf(format)}</dd>
                  </div>
                  <div>
                    <dt>Duración estimada</dt>
                    <dd>{seconds(plan.durationMs)} s</dd>
                  </div>
                  <div className="is-wide">
                    <dt>Información</dt>
                    <dd>{infoText}</dd>
                  </div>
                  <div>
                    <dt>Créditos</dt>
                    <dd>
                      <strong>Sin créditos</strong>
                    </dd>
                  </div>
                </dl>
              ) : (
                <p>Elegí al menos una foto.</p>
              )}
              {busy ? (
                <div className="vs-progress" role="status" aria-live="polite">
                  <Loader2 size={18} className="spin" aria-hidden="true" /> {busy.stage}
                  <progress max={1} value={busy.progress} aria-label="Avance del video" />
                  <button type="button" className="text-link" onClick={() => abort.current?.abort()}>
                    Cancelar
                  </button>
                  <small className="vs-hint">Se crea en este navegador: no cierres la pestaña hasta que termine.</small>
                </div>
              ) : (
                generateButton()
              )}
              {error && (
                <div className="vs-error" role="alert">
                  <p className="inline-error">{error}</p>
                  {!busy && plan && (
                    <button type="button" className="button button-small button-outline" onClick={() => void generate()}>
                      <RotateCcw size={15} aria-hidden="true" /> Reintentar
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>

          <div className="vs-col vs-col-right">
            <section className="vs-card vs-formats" aria-labelledby="vs-format">
              <h2 id="vs-format">Formato de exportación</h2>
              <p className="vs-hint">Elegí el formato ideal según dónde vas a publicar el video.</p>
              <div className="vs-format-list" role="radiogroup" aria-labelledby="vs-format">
                {VIDEO_FORMATS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={format === f}
                    className={`vs-format ${format === f ? "is-on" : ""}`}
                    onClick={() => {
                      touch();
                      setFormat(f);
                      track("video_format_selected", { ...base, format: f, video_format: f });
                    }}
                  >
                    <FormatIcon format={f} />
                    <span className="vs-format-text">
                      <strong>{FORMAT_INFO[f].name}</strong>
                      <small className="vs-res">{resolutionOf(f)}</small>
                      <small>{FORMAT_INFO[f].uses}</small>
                    </span>
                    <span className={`vs-radio ${format === f ? "is-on" : ""}`} aria-hidden="true">
                      {format === f && <Check size={13} strokeWidth={3} />}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="vs-card vs-info" aria-labelledby="vs-info">
              <h2 id="vs-info">Texto del video</h2>
              <label className="vs-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={includeInfo}
                  onChange={(e) => {
                    touch();
                    setIncludeInfo(e.target.checked);
                    track("video_info_toggled", { ...base, enabled: e.target.checked });
                  }}
                />
                <span>
                  <strong>Incluir información de la propiedad en el video</strong>
                  <small>{includeInfo ? "Placas al inicio y al final con los datos elegidos." : "El video tendrá solo tus fotos, con movimiento y transiciones."}</small>
                </span>
              </label>
              {group && (
                <p className="vs-hint">Estas fotos no tienen ficha: solo se pueden sumar los datos de tu inmobiliaria.</p>
              )}
              {includeInfo && (
                <ul className="vs-fields">
                  {INFO_FIELDS.map((f) => {
                    const available = infoAvailable(info, f);
                    const value =
                      f === "title"
                        ? info.title
                        : f === "location"
                          ? info.location
                          : f === "price"
                            ? (info.price ?? info.priceFallback)
                            : f === "facts"
                              ? info.facts.slice(0, 4).join(" · ")
                              : f === "agencyName"
                                ? info.agencyName
                                : f === "logo"
                                  ? "El logo cargado en tu perfil"
                                  : info.contact;
                    return (
                      <li key={f} className={available ? "" : "is-off"}>
                        <label>
                          <input
                            type="checkbox"
                            checked={available && fields[f]}
                            disabled={!available}
                            onChange={(e) => {
                              touch();
                              setFields((x) => ({ ...x, [f]: e.target.checked }));
                            }}
                          />
                          <strong>{INFO_LABEL[f]}</strong>
                        </label>
                        <span className="vs-field-value">{available ? value : group && ["title", "location", "price", "facts"].includes(f) ? "Sin ficha" : "Sin dato visible en la ficha"}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {includeInfo && <p className="vs-hint">Solo datos guardados y visibles en la ficha. No se modifican ni se inventan.</p>}
            </section>

            {group ? (
              <section className="vs-card vs-place" aria-labelledby="vs-place">
                <h2 id="vs-place">Usar en una demostración</h2>
                <p className="vs-hint">Para generar y descargar el video no hace falta una ficha. Si querés, creá una demostración con estas fotos: queda como borrador, nada se publica.</p>
                <button type="button" className="button button-outline" disabled={Boolean(busy)} onClick={() => void makeDemo()}>
                  <ImageIcon size={16} aria-hidden="true" /> Crear demostración con estas fotos
                </button>
              </section>
            ) : (
              <section className="vs-card vs-place" aria-labelledby="vs-place">
                <h2 id="vs-place">Ubicación en la demostración</h2>
                <p className="vs-hint">{done.length ? "Se muestra el último video terminado, sin registro y sin sonido automático." : "Se aplica cuando tengas un video terminado."}</p>
                <div className="vs-places" role="radiogroup" aria-labelledby="vs-place">
                  {PLACEMENTS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={placement === o.id}
                      className={`vs-place-option ${placement === o.id ? "is-on" : ""} ${o.id === "hidden" ? "is-none" : ""}`}
                      onClick={() => void choosePlacement(o.id)}
                    >
                      <span className={`vs-place-art is-${o.id}`} aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>
                        <strong>{o.name}</strong>
                        <small>{o.text}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      ) : (
        <p className="inline-notice">Tu rol puede ver los videos de esta propiedad; para crear uno, pedíselo a quien administra la cuenta.</p>
      )}

      {result && result.url && (
        <section className="vs-card vs-result" ref={resultRef} aria-labelledby="vs-ready">
          <div className="vs-result-main">
            <div className="vs-ready">
              <span className="vs-ready-icon" aria-hidden="true">
                <Check size={26} strokeWidth={3} />
              </span>
              <div>
                <h2 id="vs-ready">¡Video listo!</h2>
                <p>Tu video ya está disponible.</p>
              </div>
            </div>
            <dl className="vs-facts is-compact">
              <div>
                <dt>Duración</dt>
                <dd>{result.durationMs ? clock(result.durationMs) : "—"}</dd>
              </div>
              <div>
                <dt>Formato</dt>
                <dd>{FORMAT_INFO[result.format].short}</dd>
              </div>
              <div>
                <dt>Resolución</dt>
                <dd>
                  {result.width} × {result.height}
                </dd>
              </div>
              <div>
                <dt>Creado</dt>
                <dd>{new Date(result.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</dd>
              </div>
            </dl>
            <div className="vs-result-actions">
              {result.downloadUrl && (
                <a
                  className="button button-primary"
                  href={result.downloadUrl}
                  onClick={() => track("video_downloaded", { ...base, video_id: result.id, mode: result.mode, format: result.format, video_mode: result.mode, video_format: result.format, place: "result" })}
                >
                  <Download size={17} aria-hidden="true" /> Descargar video (MP4)
                </a>
              )}
              <button type="button" className="button button-outline" onClick={() => void share(result)}>
                <Share2 size={17} aria-hidden="true" /> Compartir video
              </button>
              {group ? (
                <button type="button" className="button button-outline" onClick={() => void makeDemo()}>
                  <ImageIcon size={17} aria-hidden="true" /> Crear demostración con estas fotos
                </button>
              ) : (
                <Link
                  className="button button-outline"
                  href={backTo ?? editorHref}
                  onClick={() => track("video_used_in_demo", { ...base, video_id: result.id, placement, action: "open_editor" })}
                >
                  <Link2 size={17} aria-hidden="true" /> Usar en una demostración
                </Link>
              )}
            </div>
            {!group && (
              <p className="vs-hint">
                {placement === "hidden"
                  ? "La demostración no muestra el video (elegiste «No mostrar»)."
                  : `La demostración lo muestra: ${PLACEMENTS.find((o) => o.id === placement)?.name.toLowerCase()}.`}{" "}
                {published ? "Ya está en la ficha publicada." : "Se verá cuando publiques la ficha."}{" "}
                <Link href={previewHref} className="text-link">
                  Ver vista previa de la ficha
                </Link>
              </p>
            )}
            {canEdit && (
              <div className="vs-again">
                <span>Exportar en otro formato, con las mismas fotos:</span>
                {VIDEO_FORMATS.filter((f) => f !== result.format).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="button button-small button-outline"
                    onClick={() => {
                      touch();
                      setFormat(f);
                      setFresh(null);
                      track("video_format_selected", { ...base, format: f, video_format: f, from: "result" });
                      requestAnimationFrame(() => summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
                    }}
                  >
                    {FORMAT_INFO[f].short}
                  </button>
                ))}
              </div>
            )}
          </div>
          <video
            src={result.url}
            controls
            playsInline
            preload="metadata"
            className="vs-result-video"
            style={{ aspectRatio: formatRatio(result.format) }}
            onPlay={() => track("video_preview_played", { ...base, video_id: result.id, mode: result.mode, format: result.format, video_format: result.format, place: "result" })}
          />
        </section>
      )}

      <section className="vs-card" aria-labelledby="vs-history">
        <h2 id="vs-history">{group ? "Videos de estas fotos" : "Videos de esta propiedad"}</h2>
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
                  className={`vs-video ${v.format === "16:9" ? "is-h" : "is-v"}`}
                  style={{ aspectRatio: formatRatio(v.format) }}
                  onPlay={() => track("video_preview_played", { ...base, video_id: v.id, mode: v.mode, format: v.format, video_format: v.format, place: "history" })}
                />
              ) : (
                <div className={`vs-video ${v.format === "16:9" ? "is-h" : "is-v"} vs-video-empty`} style={{ aspectRatio: formatRatio(v.format) }}>
                  {v.status === "failed" ? "No se pudo crear" : v.status === "cancelled" ? "Cancelado" : "Creando…"}
                </div>
              )}
              <div className="vs-video-meta">
                <strong>
                  {MODE_INFO[v.mode].name} · {FORMAT_INFO[v.format].short}
                </strong>
                <small>
                  {new Date(v.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })} · {v.photoCount} fotos · {v.width} × {v.height}
                  {v.durationMs ? ` · ${seconds(v.durationMs)} s` : ""}
                </small>
                {v.status === "completed" && !group && done[0]?.id === v.id && placement !== "hidden" && <small className="vs-tag is-free">El que muestra la demostración</small>}
                {v.status === "failed" && v.error && <small className="ap-error-text">{v.error}</small>}
                {v.status === "completed" && (
                  <span className="vs-video-actions">
                    {v.downloadUrl && (
                      <a
                        className="button button-small"
                        href={v.downloadUrl}
                        onClick={() => track("video_downloaded", { ...base, video_id: v.id, mode: v.mode, format: v.format, video_mode: v.mode, video_format: v.format, place: "history" })}
                      >
                        <Download size={15} aria-hidden="true" /> Descargar MP4
                      </a>
                    )}
                    <button type="button" className="button button-small button-outline" onClick={() => void share(v)}>
                      <Share2 size={15} aria-hidden="true" /> Compartir
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
        {done.length > 0 && <p className="vs-hint">Cada formato es un MP4 propio. Los enlaces de descarga se renuevan cada vez que abrís esta página.</p>}
      </section>
    </div>
  );
}

"use client";
// «Crear video» in the agency's panel. The three ways in (an existing
// property, an imported listing, uploaded photos without a ficha) end here:
// the photos (chosen and ordered), a live preview drawn by the same code
// that renders the MP4, the optional information, the style, one of four
// export formats and, for a ficha, where its demo shows the video. The
// "Clásico" montage is made in this browser (WebCodecs H.264 → MP4) and
// uploaded to Habita's storage, without credits. The AI modes («Foto en
// movimiento», «Recorrido cinematográfico») charge credits: the provider
// animates each photo and this browser joins the clips into the same kind of
// MP4. Guided steps, not a timeline: it has to work on a phone.
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
import {
  DEFAULT_MUSIC,
  DEFAULT_WATERMARK,
  mediaLink,
  musicChoiceOf,
  musicOption,
  MusicCard,
  watermarkChoiceOf,
  watermarkOption,
  WatermarkCard,
  type MusicChoice,
  type WatermarkChoice,
} from "./video-media";
import { track as trackEvent, type EventProperties } from "@/lib/analytics";
import { adminPhotoUrl, type PublicDemo } from "@/lib/demos/shared";
import type { VideoPlacement } from "@/lib/demos/branding";
import { browserClient } from "@/lib/supabase/client";
import {
  AI_PHOTOS,
  AI_TIMING,
  DEFAULT_FORMAT,
  FORMAT_INFO,
  formatRatio,
  INFO_FIELDS,
  INFO_LABEL,
  infoAvailable,
  isAiMode,
  isVideoFormat,
  MAX_VIDEO_PHOTOS,
  MODE_INFO,
  photoCountProblem,
  photoStarts,
  planVideo,
  resolutionOf,
  suggestPhotos,
  timingOf,
  VIDEO_CREDITS,
  VIDEO_FORMATS,
  videoCards,
  type InfoChoice,
  type InfoField,
  type InfoSource,
  type VideoFormat,
  type VideoMode,
  type VideoPlan,
} from "@/lib/video/plan";
import { CORNER_LABEL, GENRE_LABEL, readMusic, readWatermark, trackOf, type LibraryTrack, type VideoMusic, type VideoWatermark, type WatermarkCorner } from "@/lib/video/media";
import { drawFrame, type RenderExtras, type VideoAsset, type VideoInfo } from "@/lib/video/render";
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
  ai = false,
  credits = null,
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
  /** Whether the AI modes can be used here (HABITA_VIDEO_AI=1 and their provider configured); otherwise «Próximamente». */
  ai?: boolean;
  /** The agency's credits balance, shown when confirming an AI video (null: unknown). */
  credits?: number | null;
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
      ai={ai}
      balance={credits}
    />
  );
}

/** The editor's choices, kept per property in this browser while the person works (not the property's data). */
type Draft = { photos: string[]; staged: boolean; format: VideoFormat; info: boolean; fields: InfoField[]; music?: VideoMusic | null; watermark?: VideoWatermark | null };
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
      ...("music" in raw ? { music: readMusic(raw.music) } : {}),
      ...("watermark" in raw ? { watermark: readWatermark(raw.watermark) } : {}),
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
 * uses), at half size, in the chosen format's proportion, with the
 * watermark and, while it plays, the chosen music.
 */
function Preview({
  plan,
  cards,
  sources,
  logoUrl,
  watermark,
  music,
  command,
  onPlay,
}: {
  plan: VideoPlan | null;
  cards: VideoInfo;
  sources: { url: string; staged: boolean }[];
  logoUrl: string | null;
  watermark: { url: string; corner: WatermarkCorner } | null;
  music: { url: string; volume: number } | null;
  command: Command | null;
  onPlay: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [assets, setAssets] = useState<VideoAsset[] | null>(null);
  const [logo, setLogo] = useState<ImageBitmap | null>(null);
  const [mark, setMark] = useState<ImageBitmap | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
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
  const markUrl = watermark?.url ?? null;
  useEffect(() => {
    if (!markUrl) return setMark(null);
    let live = true;
    bitmap(markUrl)
      .then((b) => live && setMark(b))
      .catch(() => live && setMark(null));
    return () => {
      live = false;
    };
  }, [markUrl]);
  const corner = watermark?.corner ?? "br";
  const wm = useMemo(() => (mark ? { image: mark, corner } : null), [mark, corner]);

  const small = useMemo(() => (plan ? { ...plan, width: Math.round(plan.width / 2), height: Math.round(plan.height / 2) } : null), [plan]);
  const ready = Boolean(small && assets && assets.length === sources.length && sources.length > 0);

  const draw = useCallback(
    (ms: number) => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx || !small || !assets || assets.length !== sources.length) return;
      drawFrame(ctx, small, cards, assets, logo, ms, wm);
    },
    [small, assets, sources.length, cards, logo, wm],
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

  // The music follows the preview: from the same second, looped like in the MP4.
  const musicUrl = music?.url ?? null;
  const musicVolume = music?.volume ?? 70;
  useEffect(() => {
    if (!musicUrl) {
      audio.current?.pause();
      return;
    }
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.loop = true;
    }
    if (audio.current.src !== musicUrl) audio.current.src = musicUrl;
  }, [musicUrl]);
  useEffect(() => {
    if (audio.current) audio.current.volume = Math.min(1, musicVolume / 100);
  }, [musicVolume, musicUrl]);
  useEffect(() => {
    const a = audio.current;
    if (!a || !musicUrl) return;
    if (playing) {
      const d = a.duration;
      a.currentTime = Number.isFinite(d) && d > 0 ? (time.current / 1000) % d : time.current / 1000;
      void a.play().catch(() => null);
    } else a.pause();
  }, [playing, musicUrl]);
  useEffect(() => () => audio.current?.pause(), []);

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

/**
 * Before an AI video: what it costs, the agency's balance and what is left,
 * and what the AI does. Nothing is charged until «Generar» here.
 */
function ConfirmAi({
  mode,
  credits,
  balance,
  photo,
  count,
  format,
  seconds: secs,
  onCancel,
  onConfirm,
}: {
  mode: VideoMode;
  credits: number;
  balance: number | null;
  photo: string | null;
  count: number;
  format: VideoFormat;
  seconds: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const short = typeof balance === "number" && balance < credits;
  return (
    <dialog ref={ref} className="sp-dialog vs-confirm" aria-labelledby="vs-confirm-title" onClose={onCancel} onCancel={onCancel}>
      <div className="sp-head">
        <span className="sp-kicker">Crear video</span>
        <button type="button" className="icon-button" aria-label="Cerrar" onClick={() => ref.current?.close()}>
          <X size={18} />
        </button>
      </div>
      <h2 id="vs-confirm-title">¿Generar «{MODE_INFO[mode].name}»?</h2>
      <div className="vs-confirm-what">
        {photo && <img src={photo} alt="" />}
        <p>
          {count === 1 ? "Se anima la primera foto del orden." : `Se animan ${count} fotos, en el orden elegido.`}
          <br />
          {FORMAT_INFO[format].short} · ≈ {secs} s
        </p>
      </div>
      <dl className="vs-facts">
        <div>
          <dt>Usa</dt>
          <dd>
            <strong>{credits} créditos</strong>
          </dd>
        </div>
        {typeof balance === "number" && (
          <>
            <div>
              <dt>Tenés</dt>
              <dd>{balance} créditos</dd>
            </div>
            <div>
              <dt>Te van a quedar</dt>
              <dd>{short ? "—" : `${balance - credits} créditos`}</dd>
            </div>
          </>
        )}
      </dl>
      <ul className="vs-confirm-list">
        <li>
          <Check size={17} aria-hidden="true" /> La IA solo mueve la cámara: no agrega ni cambia nada.
        </li>
        <li>
          <Check size={17} aria-hidden="true" /> Tarda uno o dos minutos; podés cerrar la página.
        </li>
        <li>
          <Check size={17} aria-hidden="true" /> Si la animación falla, te devolvemos los créditos.
        </li>
      </ul>
      {short && <p className="inline-error">No te alcanzan los créditos para este video.</p>}
      <div className="vs-confirm-actions">
        <button type="button" className="button button-outline" onClick={() => ref.current?.close()}>
          Cancelar
        </button>
        {short ? (
          <Link className="button button-primary" href="/panel/creditos">
            Ver planes
          </Link>
        ) : (
          <button type="button" className="button button-primary" onClick={onConfirm}>
            <Sparkles size={17} aria-hidden="true" /> Generar · {credits} créditos
          </button>
        )}
      </div>
    </dialog>
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
  ai,
  balance,
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
  ai: boolean;
  balance: number | null;
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
  const [music, setMusic] = useState<MusicChoice>(DEFAULT_MUSIC);
  const [watermark, setWatermark] = useState<WatermarkChoice>(DEFAULT_WATERMARK);
  const [library, setLibrary] = useState<LibraryTrack[] | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const profileLogo = demo.agency.logo ?? null;
  const [placement, setPlacement] = useState<VideoPlacement>(initialPlacement);
  const [videos, setVideos] = useState<PublicVideo[] | null>(null);
  const [listError, setListError] = useState("");
  const [busy, setBusy] = useState<null | { stage: string; progress: number; kind?: "send" | "join" }>(null);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [command, setCommand] = useState<Command | null>(null);
  // The AI modes' confirmation: what it costs, the balance and what is left, before anything is charged.
  const [confirming, setConfirming] = useState(false);
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
    (c: { photos: string[]; staged: boolean; info: boolean; fields: InfoField[]; format?: VideoFormat; music?: VideoMusic | null; watermark?: VideoWatermark | null }) => {
      const photos = c.photos.filter((id) => known.has(id)).slice(0, MAX_VIDEO_PHOTOS);
      if (!photos.length) return false;
      setPicked(photos);
      setUseStaged(c.staged);
      setIncludeInfo(c.info);
      if (c.fields.length) setFields(Object.fromEntries(INFO_FIELDS.map((f) => [f, c.fields.includes(f)])) as InfoChoice);
      if (c.format) setFormat(c.format);
      setMusic((m) => musicChoiceOf(c.music, m));
      setWatermark((w) => watermarkChoiceOf(c.watermark, w));
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

  // The music library: the tracks already generated, each with a short link to hear it.
  const fetchLibrary = useCallback(async () => (await api<{ library: LibraryTrack[] }>(`/api/panel/videos/medios?demo=${demoId}`)).library, [demoId]);
  useEffect(() => {
    let live = true;
    fetchLibrary()
      .then((l) => live && (setLibrary(l), setLibraryError(false)))
      .catch(() => live && setLibraryError(true));
    return () => {
      live = false;
    };
  }, [fetchLibrary]);
  // A browser that cannot write audio (some Safari versions) starts without music instead of failing at «Generar».
  useEffect(() => {
    let live = true;
    void import("@/lib/video/render")
      .then((r) => r.audioCodec())
      .then((codec) => {
        if (live && !codec && !touched.current) setMusic((m) => ({ ...m, on: false }));
      });
    return () => {
      live = false;
    };
  }, []);
  // A library track by default (the chosen style's first), once the library is known.
  useEffect(() => {
    if (!library?.length) return;
    setMusic((m) => {
      if (m.source !== "library" || (m.track && library.some((t) => t.id === m.track))) return m;
      const first = library.find((t) => t.genre === m.genre) ?? library[0];
      return { ...m, genre: first.genre, track: first.id };
    });
  }, [library]);
  // Uploaded files restored from a draft or a past video: their links are asked for again.
  const musicUpload = music.upload;
  useEffect(() => {
    if (!musicUpload || musicUpload.url) return;
    let live = true;
    mediaLink(demoId, musicUpload.path)
      .then((url) => live && setMusic((m) => (m.upload?.path === musicUpload.path ? { ...m, upload: { ...musicUpload, url } } : m)))
      .catch(() => live && setMusic((m) => (m.upload?.path === musicUpload.path ? { ...m, upload: null } : m)));
    return () => {
      live = false;
    };
  }, [demoId, musicUpload]);
  const markUpload = watermark.upload;
  useEffect(() => {
    if (!markUpload || markUpload.url) return;
    let live = true;
    mediaLink(demoId, markUpload.path)
      .then((url) => live && setWatermark((w) => (w.upload?.path === markUpload.path ? { ...w, upload: { ...markUpload, url } } : w)))
      .catch(() => live && setWatermark((w) => (w.upload?.path === markUpload.path ? { ...w, upload: null } : w)));
    return () => {
      live = false;
    };
  }, [demoId, markUpload]);

  // AI videos being animated: the history is asked again every few seconds (that also moves them forward).
  const joinWhenReady = useRef<string | null>(null);
  const animating = (videos ?? []).some((v) => v.ai?.stage === "animating");
  useEffect(() => {
    if (!animating) return;
    const t = setTimeout(() => void load(), 6000);
    return () => clearTimeout(t);
  }, [animating, videos, load]);

  const chosenFields = INFO_FIELDS.filter((f) => fields[f] && infoAvailable(info, f));
  // Kept for this property in this browser: the selection survives a reload and the way back from the demo.
  useEffect(() => {
    if (!touched.current) return;
    const ok = saveDraft(demoId, {
      photos: picked,
      staged: useStaged,
      format,
      info: includeInfo,
      fields: INFO_FIELDS.filter((f) => fields[f]),
      music: musicOption(music),
      watermark: watermarkOption(watermark, profileLogo),
    });
    setSaved(ok);
  }, [demoId, picked, useStaged, format, includeInfo, fields, music, watermark, profileLogo]);
  const touch = () => {
    touched.current = true;
    restored.current = true;
  };

  const picks = picked.map((id) => all.find((c) => c.id === id)).filter((c): c is Choice => Boolean(c));
  // «Foto en movimiento» animates one photo: the first of the order.
  const chosen = mode === "clip" ? picks.slice(0, 1) : picks;
  const aiMode = isAiMode(mode);
  const credits = VIDEO_CREDITS[mode];
  const countProblem = chosen.length ? photoCountProblem(mode, chosen.length) : null;
  const cards = useMemo(() => videoCards(info, includeInfo, fields), [info, includeInfo, fields]);
  const plan = useMemo(
    () =>
      chosen.length && !photoCountProblem(mode, chosen.length)
        ? planVideo(chosen.length, format, { intro: Boolean(cards.intro), outro: Boolean(cards.outro), timing: timingOf(mode) })
        : null,
    [chosen.length, format, cards, mode],
  );
  const sources = useMemo(() => chosen.map((c) => ({ url: adminPhotoUrl(c.id, c.version, 960), staged: c.staged })), [chosen]);
  const musicChoice = musicOption(music);
  const markChoice = watermarkOption(watermark, profileLogo);
  const previewMusic = useMemo(() => {
    const url = !musicChoice ? null : musicChoice.kind === "library" ? library?.find((t) => t.id === musicChoice.track)?.url : music.upload?.url;
    return musicChoice && url ? { url, volume: musicChoice.volume } : null;
  }, [musicChoice, library, music.upload]);
  const previewMark = useMemo(() => {
    const url = !markChoice ? null : markChoice.kind === "profile" ? profileLogo : watermark.upload?.url;
    return markChoice && url ? { url, corner: markChoice.corner } : null;
  }, [markChoice, profileLogo, watermark.upload]);
  const musicText = !musicChoice ? "Sin música" : musicChoice.kind === "library" ? `${trackOf(musicChoice.track)?.name ?? "Pista"} (${GENRE_LABEL[trackOf(musicChoice.track)?.genre ?? "chill"]})` : musicChoice.name;
  const markText = !markChoice ? "Sin marca de agua" : `${markChoice.kind === "profile" ? "Logo de tu perfil" : "Tu marca de agua"} · ${CORNER_LABEL[markChoice.corner].toLowerCase()}`;

  /** The music and watermark a video was asked with, loaded for the MP4 (fresh links: the old ones may have expired). */
  async function extrasFor(m: VideoMusic | null | undefined, w: VideoWatermark | null | undefined): Promise<RenderExtras> {
    const { audioCodec, loadAsset, loadMusic } = await import("@/lib/video/render");
    const out: RenderExtras = {};
    if (m) {
      const codec = await audioCodec();
      if (!codec) throw new Error("Este navegador no puede agregar música al video. Probá con Chrome o Edge actualizados, o sacá la música.");
      const url = m.kind === "library" ? ((await fetchLibrary()).find((t) => t.id === m.track)?.url ?? null) : await mediaLink(demoId, m.path);
      if (!url) throw new Error("No encontramos la pista elegida. Elegí otra en «Música de fondo».");
      out.music = { song: await loadMusic(url), volume: m.volume, codec };
    }
    if (w) {
      const url = w.kind === "profile" ? profileLogo : await mediaLink(demoId, w.path);
      const image = url ? (await loadAsset(url, false)).image : null;
      if (image) out.watermark = { image, corner: w.corner };
    }
    return out;
  }
  /** Music needs this browser to write audio: checked before anything is created or charged. */
  async function musicProblem() {
    if (!musicChoice) return null;
    const { audioCodec } = await import("@/lib/video/render");
    return (await audioCodec()) ? null : "Este navegador no puede agregar música al video. Probá con Chrome o Edge actualizados, o sacá la música.";
  }

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
    animated_photo_count: aiMode ? chosen.length : 0,
    credits_quoted: credits,
    provider: aiMode ? "fal" : "browser",
    has_music: Boolean(musicChoice),
    music_source: musicChoice?.kind ?? "none",
    has_watermark: Boolean(markChoice),
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
    if (aiMode) return startAi();
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
    const noAudio = await musicProblem();
    if (noAudio) {
      track("video_generation_failed", { ...p, error_code: "unsupported_audio" });
      return setError(noAudio);
    }
    let videoId: string | null = null;
    let step = "create";
    const controller = new AbortController();
    abort.current = controller;
    try {
      setBusy({ stage: "Preparando…", progress: 0 });
      const options: VideoOptions = { photos: chosen.map((c) => c.id), staged: useStaged, info: includeInfo, fields: chosenFields, music: musicChoice, watermark: markChoice };
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
      const logo = cards.outro?.logo && demo.agency.logo ? await loadAsset(demo.agency.logo, false).then((a) => a.image ?? null).catch(() => null) : null;
      step = "media";
      if (musicChoice) setBusy({ stage: "Preparando la música…", progress: 0.04 });
      const extras = await extrasFor(musicChoice, markChoice);
      step = "render";
      const blob = await renderMp4(plan, cards, assets, logo, (x) => setBusy({ stage: `Creando el video… ${Math.round(x * 100)}%`, progress: 0.05 + x * 0.8 }), controller.signal, extras);
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
          : step === "media"
            ? message(e, "No pudimos cargar la música o la marca de agua. Reintentá.")
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


  /**
   * An AI video: its credits are charged and the provider animates each photo
   * (a minute or two). The history follows it; once every clip is stored,
   * this browser joins them (join). The page may be closed meanwhile.
   */
  async function startAi() {
    if (!plan || busy || !canEdit || !aiMode) return;
    setError("");
    setFresh(null);
    const p = props();
    track("video_generate_clicked", p);
    // The browser that will join the clips must be able to: checked before any credit is spent.
    const { canRender } = await import("@/lib/video/render");
    if (!(await canRender(plan))) {
      track("video_generation_failed", { ...p, error_code: "unsupported_browser" });
      setError("Este navegador no puede armar el video. Probá con Chrome, Edge o Safari actualizados (en iPhone, iOS 17 o posterior), o desde una computadora. No se usaron créditos.");
      return;
    }
    const noAudio = await musicProblem();
    if (noAudio) {
      track("video_generation_failed", { ...p, error_code: "unsupported_audio" });
      return setError(`${noAudio} No se usaron créditos.`);
    }
    // Nothing is charged until the person confirms in the dialog (launchAi).
    setConfirming(true);
  }

  async function launchAi() {
    setConfirming(false);
    if (!plan || busy || !canEdit || !aiMode) return;
    const p = props();
    try {
      setBusy({ kind: "send", stage: "Enviando las fotos a la IA…", progress: 0.02 });
      const options: VideoOptions = { photos: chosen.map((c) => c.id), staged: useStaged, info: includeInfo, fields: chosenFields, music: musicChoice, watermark: markChoice };
      const started = await api<{ id: string; status: string; error: string | null }>("/api/panel/videos", {
        method: "POST",
        body: JSON.stringify({ demoId, key: crypto.randomUUID(), mode, format, photoCount: chosen.length, options }),
      });
      if (started.status === "failed") {
        setError(started.error || "No pudimos empezar la animación con IA. No se usaron créditos.");
        track("video_generation_failed", { ...p, video_id: started.id, error_code: "provider_submit" });
      } else {
        track("video_generation_started", { ...p, video_id: started.id, credits_charged: credits });
        joinWhenReady.current = started.id;
      }
      await load();
    } catch (e) {
      setError(message(e, "No pudimos empezar el video con IA."));
      track("video_generation_failed", { ...p, error_code: e instanceof ApiError ? `api_${e.status}` : "start" });
    } finally {
      setBusy(null);
    }
  }

  /** Joins an AI video's stored clips into its MP4, with its own cards and format (as it was asked). */
  async function join(v: PublicVideo) {
    if (busy || !canEdit || !v.ai?.clips?.length) return;
    joinWhenReady.current = null;
    setError("");
    const started = Date.now();
    const opts = v.options;
    const choice = Object.fromEntries(INFO_FIELDS.map((f) => [f, Boolean(opts?.fields.includes(f))])) as InfoChoice;
    const vCards = videoCards(info, Boolean(opts?.info), choice);
    const vPlan = planVideo(v.ai.clips.length, v.format, { intro: Boolean(vCards.intro), outro: Boolean(vCards.outro), timing: AI_TIMING });
    const p = { ...base, video_id: v.id, mode: v.mode, format: v.format, video_mode: v.mode, video_format: v.format, photo_count: v.ai.clips.length, provider: "fal" };
    const controller = new AbortController();
    abort.current = controller;
    let step = "clips";
    try {
      const { canRender, loadClip, loadAsset, renderMp4 } = await import("@/lib/video/render");
      if (!(await canRender(vPlan))) throw new Error("Este navegador no puede armar el video. Abrí esta página en Chrome, Edge o Safari actualizados, o desde una computadora: los clips te esperan.");
      setBusy({ kind: "join", stage: "Cargando los clips animados…", progress: 0.03 });
      const assets = await Promise.all(v.ai.clips.map((c) => loadClip(c.url, c.staged)));
      const logo = vCards.outro?.logo && demo.agency.logo ? await loadAsset(demo.agency.logo, false).then((a) => a.image ?? null).catch(() => null) : null;
      step = "media";
      const extras = await extrasFor(opts?.music, opts?.watermark);
      step = "render";
      const blob = await renderMp4(vPlan, vCards, assets, logo, (x) => setBusy({ kind: "join", stage: `Armando el video… ${Math.round(x * 100)}%`, progress: 0.05 + x * 0.8 }), controller.signal, extras);
      step = "upload";
      setBusy({ kind: "join", stage: "Guardando…", progress: 0.9 });
      const target = await api<{ upload: { path: string; token: string; bucket: string } }>("/api/panel/videos", { method: "PUT", body: JSON.stringify({ demoId, id: v.id }) });
      const client = browserClient();
      if (!client) throw new Error("No pudimos guardar el video.");
      const up = await client.storage.from(target.upload.bucket).uploadToSignedUrl(target.upload.path, target.upload.token, blob, { contentType: "video/mp4", upsert: true });
      if (up.error) throw new Error("No pudimos subir el video. Revisá tu conexión e intentá de nuevo.");
      step = "storage";
      setBusy({ kind: "join", stage: "Confirmando…", progress: 0.97 });
      for (let attempt = 0; ; attempt++) {
        try {
          await api("/api/panel/videos", { method: "PATCH", body: JSON.stringify({ demoId, id: v.id, ok: true, durationMs: vPlan.durationMs }) });
          break;
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409) || attempt >= 3) throw e;
          await wait(1500 * (attempt + 1));
        }
      }
      track("video_generation_completed", { ...p, credits_charged: v.credits, duration_ms: vPlan.durationMs, render_ms: Date.now() - started, video_ms: vPlan.durationMs, size_kb: Math.round(blob.size / 1024) });
      setFresh(v.id);
      await load();
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === "AbortError";
      const text = cancelled
        ? "Pausaste el armado. Los clips quedan guardados: tocá «Terminar video» cuando quieras."
        : step === "clips"
          ? message(e, "No pudimos cargar los clips. Revisá tu conexión y tocá «Terminar video».")
          : step === "media"
            ? `${message(e, "No pudimos cargar la música o la marca de agua.")} Tocá «Terminar video» para reintentar.`
            : step === "render"
            ? "Falló el armado del video en este navegador. Tocá «Terminar video» para reintentar; si se repite, probá desde una computadora."
            : message(e, "No pudimos guardar el video. Tocá «Terminar video» para reintentar.");
      setError(text);
      track("video_generation_failed", { ...p, error_code: cancelled ? "cancelled" : e instanceof ApiError ? `api_${e.status}` : `join_${step}`, duration_ms: Date.now() - started });
      await api("/api/panel/videos", { method: "PATCH", body: JSON.stringify({ demoId, id: v.id, ok: false, error: text }) }).catch(() => null);
      await load();
    } finally {
      abort.current = null;
      setBusy(null);
    }
  }

  // The video this tab started: joined here as soon as its clips are stored.
  useEffect(() => {
    if (busy || !joinWhenReady.current) return;
    const v = (videos ?? []).find((x) => x.id === joinWhenReady.current);
    if (!v) return;
    if (v.ai?.stage === "joining") void join(v);
    else if (v.status !== "processing") joinWhenReady.current = null;
    // join is this render's; it only runs once per video (joinWhenReady is cleared first).
  }, [videos, busy]);

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
  // The newest AI video still being made (animating, or waiting to be joined).
  const pendingAi = (videos ?? []).find((v) => v.status === "processing" && v.ai) ?? null;
  const result = fresh ? done.find((v) => v.id === fresh) : null;
  const editorHref = `/panel/propiedades/${demoId}?seccion=fotos`;
  const title = group ? demo.title || "Fotos subidas" : demo.title;
  const infoText = cards.intro || cards.outro ? chosenFields.map((f) => INFO_LABEL[f]).join(", ") : "No: solo fotos";

  const creditsText = credits ? `${credits} créditos` : "Sin créditos";
  const generateButton = (cls = "") => (
    <button type="button" className={`button button-primary vs-generate ${cls}`} disabled={!plan || Boolean(busy) || !canEdit} onClick={() => void generate()}>
      {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : aiMode ? <Sparkles size={18} aria-hidden="true" /> : <Film size={18} aria-hidden="true" />} Generar video
      <small>{creditsText}</small>
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
                Tocá para sumar o sacar. {picks.length} de {Math.min(MAX_VIDEO_PHOTOS, all.length)} elegidas (hasta {MAX_VIDEO_PHOTOS}).
                {mode === "clip" && picks.length > 1 && " «Foto en movimiento» anima solo la primera del orden."}
                {mode === "cinematic" && ` El recorrido anima entre ${AI_PHOTOS.cinematic.min} y ${AI_PHOTOS.cinematic.max}.`}
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
                {(["classic", "clip", "cinematic", "balanced"] as VideoMode[]).map((m) => {
                  const live = m === "classic" || (ai && isAiMode(m));
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
                        {m === "classic" ? <Film size={18} /> : <Sparkles size={18} />}
                      </span>
                      <span className="vs-mode-text">
                        <strong>{MODE_INFO[m].name}</strong>
                        <small>{m === "classic" ? "Tus fotos con movimiento suave de cámara y transiciones." : MODE_INFO[m].text}</small>
                      </span>
                      <span className={`vs-tag ${live && !VIDEO_CREDITS[m] ? "is-free" : ""}`}>
                        {!live ? "Próximamente" : VIDEO_CREDITS[m] ? `${VIDEO_CREDITS[m]} créditos` : "Sin créditos"}
                      </span>
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
                watermark={previewMark}
                music={previewMusic}
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
                  <div className="is-wide">
                    <dt>Música</dt>
                    <dd>{musicText}</dd>
                  </div>
                  <div className="is-wide">
                    <dt>Marca de agua</dt>
                    <dd>{markText}</dd>
                  </div>
                  <div>
                    <dt>Créditos</dt>
                    <dd>
                      <strong>{creditsText}</strong>
                    </dd>
                  </div>
                </dl>
              ) : (
                <p>{countProblem ?? "Elegí al menos una foto."}</p>
              )}
              {plan && aiMode && (
                <p className="vs-hint">
                  La IA anima {chosen.length === 1 ? "la foto" : `las ${chosen.length} fotos`} con un movimiento de cámara, sin agregar ni cambiar nada (tarda uno o dos minutos). Si la animación falla, te devolvemos los créditos.
                </p>
              )}
              {busy ? (
                <div className="vs-progress" role="status" aria-live="polite">
                  <Loader2 size={18} className="spin" aria-hidden="true" /> {busy.stage}
                  <progress max={1} value={busy.progress} aria-label="Avance del video" />
                  {busy.kind !== "send" && (
                    <button type="button" className="text-link" onClick={() => abort.current?.abort()}>
                      {busy.kind === "join" ? "Pausar" : "Cancelar"}
                    </button>
                  )}
                  <small className="vs-hint">
                    {busy.kind === "send"
                      ? "Enviando las fotos: no cierres la pestaña todavía."
                      : busy.kind === "join"
                        ? "Se arma en este navegador: no cierres la pestaña hasta que termine. Si se corta, los clips quedan guardados."
                        : "Se crea en este navegador: no cierres la pestaña hasta que termine."}
                  </small>
                </div>
              ) : (
                generateButton()
              )}
              {pendingAi && !busy && (
                <div className="vs-progress" role="status" aria-live="polite">
                  {pendingAi.ai?.stage === "joining" ? (
                    <>
                      <Check size={18} aria-hidden="true" /> Los clips con IA están listos.
                      <button type="button" className="button button-small button-primary" onClick={() => void join(pendingAi)}>
                        <Film size={15} aria-hidden="true" /> Terminar video
                      </button>
                      <small className="vs-hint">Falta unirlos en el video: se hace en este navegador, tarda menos de un minuto y no usa créditos.</small>
                    </>
                  ) : (
                    <>
                      <Loader2 size={18} className="spin" aria-hidden="true" /> La IA está animando las fotos: {pendingAi.ai?.done ?? 0} de {pendingAi.ai?.total ?? pendingAi.photoCount} listas.
                      <progress max={1} value={pendingAi.ai ? (pendingAi.ai.done + 0.3) / Math.max(1, pendingAi.ai.total) : 0.1} aria-label="Avance de la animación" />
                      {pendingAi.ai && pendingAi.ai.items.length > 1 && (
                        <ul className="vs-clips">
                          {pendingAi.ai.items.map((s, i) => {
                            const id = pendingAi.options?.photos[i];
                            const photo = id ? demo.photos.find((x) => x.id === id) : null;
                            const label = photo?.label || `Foto ${i + 1}`;
                            return (
                              <li key={i}>
                                {photo && <img src={adminPhotoUrl(photo.id, null, 160)} alt="" />}
                                <strong>
                                  {i + 1}. {label}
                                </strong>
                                <span className={`vs-tag ${s === "ready" ? "is-free" : ""}`}>{s === "ready" ? "Lista" : s === "pending" ? "En cola" : s === "failed" ? "Reintentando…" : "Animando…"}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <small className="vs-hint">Podés cerrar esta página: el video te espera en el historial para terminarlo.</small>
                    </>
                  )}
                </div>
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
              <p className="vs-hint">Elegí el formato ideal según dónde vas a publicar el video.{!group && " Para la ficha, Horizontal 16:9 ocupa toda la galería: la ficha muestra tu último video horizontal y, si no hay, el último en otro formato."}</p>
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

            <MusicCard
              demoId={demoId}
              canEdit={canEdit}
              choice={music}
              onChange={(c) => {
                touch();
                if (c.on !== music.on) track("video_music_toggled", { ...base, enabled: c.on });
                setMusic(c);
              }}
              library={library}
              libraryError={libraryError}
            />

            <WatermarkCard
              demoId={demoId}
              canEdit={canEdit}
              choice={watermark}
              onChange={(c) => {
                touch();
                if (c.on !== watermark.on) track("video_watermark_toggled", { ...base, enabled: c.on });
                setWatermark(c);
              }}
              profileLogo={profileLogo}
            />

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

      {confirming && aiMode && (
        <ConfirmAi
          mode={mode}
          credits={credits}
          balance={balance}
          photo={chosen[0] ? adminPhotoUrl(chosen[0].id, chosen[0].version, 240) : null}
          count={chosen.length}
          format={format}
          seconds={plan ? seconds(plan.durationMs) : 0}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void launchAi()}
        />
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
                  {v.status === "failed"
                    ? "No se pudo crear"
                    : v.status === "cancelled"
                      ? "Cancelado"
                      : v.ai?.stage === "animating"
                        ? `Animando con IA… ${v.ai.done} de ${v.ai.total}`
                        : v.ai?.stage === "joining"
                          ? "Clips listos"
                          : "Creando…"}
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
                {v.status === "processing" && v.ai?.stage === "joining" && canEdit && (
                  <span className="vs-video-actions">
                    <button type="button" className="button button-small" disabled={Boolean(busy)} onClick={() => void join(v)}>
                      <Film size={15} aria-hidden="true" /> Terminar video
                    </button>
                  </span>
                )}
                {v.credits > 0 && <small>{v.credits} créditos</small>}
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

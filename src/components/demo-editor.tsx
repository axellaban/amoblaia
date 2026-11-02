"use client";
import { formatOf, formatRatio } from "@/lib/video/plan";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  Home,
  Image as ImageIcon,
  Info,
  Link2,
  Loader2,
  MessageCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Share2,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Comparison } from "./comparison";
import { ActivityStatus, AgencyFields, AgencyWhatsappEditor, LinkPreview, PropertyFields, SendLog, SendWhatsapp, SentToggle, ShareCards, StatusChip, api, publicLink } from "./admin-demos";
import { PhotoWorkspace, type WorkspaceActions } from "./editor-photos";
import { useStagingQueue, type QueueReport } from "./use-staging-queue";
import { optimizePhoto } from "@/lib/images";
import { PROPERTY_TYPE_NAMES, styleFits, type PropertyType } from "@/lib/demos/styles";
import { ListingForm, type ListingPart, type Visibility } from "./demo-listing-form";
import { videoEnabled } from "@/lib/agency/flags";
import { type HideableField, type VideoPlacement } from "@/lib/demos/branding";
import { ImportPreview, ImportReport, exceptions, foreignPhotos, syncPhotos } from "./demo-import";
import type { ImportChange, ImportField, ImportedDemo } from "@/lib/demos/import";
import { track } from "@/lib/analytics";
import { safeReturn } from "@/lib/agency/shared";
import { payerNote } from "@/lib/agency/edit-scope";
import { shareLink, whatsappOpened } from "@/lib/agency/share";
import {
  MAP_SUMMARY,
  isLive,
  isSection,
  missingData,
  photoSummary,
  versionFileName,
  versionNumber,
  type Section,
} from "@/lib/demos/editor-logic";
import {
  MAX_DEMO_STYLES,
  adminGenerationUrl,
  adminPhotoUrl,
  downloadName,
  generationDownloadUrl,
  orderStyles,
  photoDownloadUrl,
  retouchDownloadUrl,
  photoLabel,
  styleName,
  whatsappShareUrl,
  type DemoDetail,
  type EditorPhoto,
  type GenerationRow,
  type PropertySpace,
} from "@/lib/demos/shared";

const CONTACT_LABELS = {
  whatsapp: ["WhatsApp", "+54 9 223 555-1234"],
  url: ["Formulario o página de contacto", "https://inmobiliaria.com/contacto"],
  phone: ["Teléfono", "+54 223 555-1234"],
  email: ["Email", "consultas@inmobiliaria.com"],
} as const;
/** Styles checked for the batch live only in this browser (they are not part of the property until a version exists). */
const pickedKey = (id: string) => `amoblaia_demo_estilos_${id}`;
function readPicked(id: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(pickedKey(id)) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function savePicked(id: string, list: string[]) {
  try {
    localStorage.setItem(pickedKey(id), JSON.stringify(list));
  } catch {
    /* Private mode: the choice lasts until the page reloads. */
  }
}
type Upload = { name: string; state: "waiting" | "uploading" | "done" | "error"; error?: string };
type SpaceState = { spaces: PropertySpace[]; assignments: Record<string, string> };
type Message = { tone: "error" | "notice"; text: string; section?: Section };

const formsOf = (d: DemoDetail) => ({
  title: d.demo.title === d.property.title ? "" : d.demo.title,
  agency: { name: d.agency.name, website: d.agency.website ?? "", contact_name: d.agency.contact_name ?? "", notes: d.agency.notes ?? "" },
  property: {
    title: d.property.title,
    listing_url: d.property.listing_url ?? "",
    location: d.property.location ?? "",
    description: d.property.description ?? "",
  },
  brand: {
    primary: d.branding.primary ?? "",
    accent: d.branding.accent ?? "",
    titleFont: d.branding.titleFont ?? ("sans" as const),
    contactKind: d.branding.contactKind ?? ("whatsapp" as const),
    contactValue: d.branding.contactValue ?? "",
    visitUrl: d.branding.visitUrl ?? "",
  },
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** The agency's demo editor: three tabs. The older sections (and their links) open in the tab that holds them. */
type DemoTab = "fotos" | "datos" | "publicacion";
const tabOf = (s: Section): DemoTab => (s === "fotos" ? "fotos" : s === "publicacion" ? "publicacion" : "datos");
/** Where the video goes, as Panel > Video stores it (settings.videoPlacement); "hidden" is «Mostrar video» off. */
const VIDEO_PLACES = ["first", "second", "below"] as const satisfies readonly VideoPlacement[];
const VIDEO_PLACE_LABEL: Record<(typeof VIDEO_PLACES)[number], [string, string]> = {
  first: ["Primero", "en la galería"],
  second: ["Segundo", "en la galería"],
  below: ["Debajo", "de las fotos"],
};

/** A fold of the editor: its header always says what is inside; folding saves, clears or stops nothing. */
function Fold({
  id,
  title,
  summary,
  open,
  onToggle,
  dirty,
  children,
}: {
  id: Section;
  title: string;
  summary: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  dirty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`account-panel ed-fold ${open ? "is-open" : ""}`} id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="ed-fold-title">
        <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle}>
          <ChevronDown size={18} aria-hidden="true" className="ed-chevron" />
          <span className="ed-fold-name">{title}</span>
          <span className="ed-fold-summary">
            {summary}
            {dirty && <span className="ed-dirty"> · Cambios sin guardar</span>}
          </span>
        </button>
      </h2>
      {/* Folded content stays mounted (hidden): drafts, selections and progress are kept. */}
      <div id={`${id}-body`} className="ed-fold-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/**
 * «Editar imagen» of the demo: this photo and version in Estudio de imágenes
 * («Editar con IA»), which comes back to the same property, tab and photo.
 */
function studioEditLink(demoId: string, photoId: string, versionId: string | null) {
  const back = new URL(typeof window === "undefined" ? `https://x.local/panel/propiedades/${demoId}` : window.location.href);
  back.searchParams.set("seccion", "fotos");
  back.searchParams.set("foto", photoId);
  if (versionId) back.searchParams.set("version", versionId);
  else back.searchParams.delete("version");
  const q = new URLSearchParams({ pestana: "fotos", fotos: demoId, foto: photoId, modo: "editar", volver: `${back.pathname}${back.search}` });
  if (versionId) q.set("version", versionId);
  return `/panel/imagenes?${q}`;
}

/**
 * The property page, shared by the team ("admin": commercial demos) and by
 * agencies ("agency": its own properties, staged with its credits). Photos
 * and spaces first; everything else in folds that keep their drafts.
 */
export function DemoEditor({
  id,
  mode = "admin",
  banner,
  agencyContext,
  studio = false,
  onUseInDemo,
  studioEditing = false,
}: {
  id: string;
  mode?: "admin" | "agency";
  /** Inside "Estudio de imágenes": only the photo workspace (every photo together), no ficha sections. */
  studio?: boolean;
  /** Estudio de imágenes: «Usar en una demostración» of the photo and version on screen. */
  onUseInDemo?: (photoId: string, versionId: string | null) => void;
  /** The demo's «Editar imagen» opens Estudio de imágenes (this user can use it); else it edits in the demo. */
  studioEditing?: boolean;
  /** The edit banner, when the team edits this agency (Editar inmobiliaria). */
  banner?: React.ReactNode;
  /** The agency the team is editing: the way back goes to its workspace. */
  agencyContext?: string;
}) {
  const agencyMode = mode === "agency";
  // The team inside an agency's edit context (Administración › Editar inmobiliaria) works in the agency's
  // own three-tab editor: one editor, one infrastructure. Only what lives in the agency's panel changes.
  const team = !agencyMode && Boolean(agencyContext);
  const tabbed = agencyMode || team;
  // The agency's funnel counts the agency's own steps, never the team's.
  const agencyTrack = (...args: Parameters<typeof track>) => {
    if (agencyMode) track(...args);
  };
  const [detail, setDetail] = useState<DemoDetail | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string[]>([]);
  const [review, setReview] = useState<{ photoId: string; generationId: string } | null>(null);
  const [open, setOpen] = useState<Set<Section>>(new Set(["fotos"]));
  const [downloading, setDownloading] = useState<string | null>(null);
  // Arrived from its invitation (?bienvenida=1): one concrete first task, not a setup checklist.
  const [welcome, setWelcome] = useState(false);
  // Drafts of the forms: set once, and again only when that same form is saved.
  const [forms, setForms] = useState<ReturnType<typeof formsOf> | null>(null);
  const [dirtyParts, setDirtyParts] = useState<Set<ListingPart>>(new Set());
  const [reread, setReread] = useState<Reread | null>(null);
  // The agency's demo editor: its three tabs (kept in ?seccion=), the moment it was published and the property's latest video.
  const [tab, setTab] = useState<DemoTab>("fotos");
  const [justPublished, setJustPublished] = useState(false);
  const [video, setVideo] = useState<{ url: string; format: string } | null>(null);
  const home = agencyMode ? "/panel/propiedades" : agencyContext ? `/admin/inmobiliarias/${agencyContext}/editar` : "/admin/inmobiliarias";
  const [backTo, setBackTo] = useState(home);
  const base = `/api/admin/demos/${id}`;
  const firstLoad = useRef(true);

  const say = useCallback((m: Message) => {
    setMessage(m);
    if (m.section) setOpen((o) => new Set(o).add(m.section!));
    // An error is shown where it happened.
    if (m.section && m.tone === "error") setTab(tabOf(m.section));
  }, []);
  const report = useCallback((r: QueueReport) => say({ ...r, section: r.tone === "error" ? "fotos" : undefined }), [say]);

  /** New server data. Form drafts are never replaced here (see `saved`). */
  const apply = useCallback((d: DemoDetail) => {
    setDetail((prev) => ({ ...d, staging: d.staging ?? prev?.staging, readOnly: d.readOnly ?? prev?.readOnly }));
    if (firstLoad.current) {
      firstLoad.current = false;
      setForms(formsOf(d));
      // Every visible photo goes in the batch unless unticked (bathrooms, façades, plans…).
      setIncluded(new Set(d.photos.filter((p) => p.visible).map((p) => p.id)));
      setPicked(readPicked(d.demo.id));
    }
  }, []);
  /** After a form was saved: only that form takes the server's values. */
  const saved = useCallback((d: DemoDetail, keys: (keyof ReturnType<typeof formsOf>)[]) => {
    apply(d);
    const fresh = formsOf(d);
    setForms((f) => (f ? { ...f, ...Object.fromEntries(keys.map((k) => [k, fresh[k]])) } : fresh));
  }, [apply]);
  const load = useCallback(async () => apply(await api<DemoDetail>(base)), [apply, base]);
  useEffect(() => {
    void load().catch((e) => setLoadError(e instanceof Error ? e.message : "No pudimos cargar la propiedad."));
  }, [load]);

  // Deep links: ?seccion=… or #section opens that fold and takes the focus there; ?volver= is the way back.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setBackTo(safeReturn(q.get("volver"), home));
    if (agencyMode && q.get("bienvenida") === "1") setWelcome(true);
    const target = q.get("seccion") ?? window.location.hash.slice(1);
    if (isSection(target)) {
      setOpen((o) => new Set(o).add(target));
      setTab(tabOf(target));
    }
    if (q.get("publicada") === "1") setJustPublished(true);
  }, [home]);
  // The tab on screen survives a reload (and the way back from video or the preview).
  const pickTab = (t: DemoTab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("seccion", t);
    url.searchParams.delete("publicada");
    window.history.replaceState(window.history.state, "", url);
  };
  // The property's latest finished video (Video Studio makes it): played here and placed on the public page.
  useEffect(() => {
    if (!tabbed || studio || !videoEnabled()) return;
    api<{ videos: { status: string; url: string | null; format: string }[] }>(`/api/panel/videos?demo=${id}`)
      .then(({ videos }) => {
        const v = videos.find((x) => x.status === "completed" && x.url);
        setVideo(v ? { url: v.url!, format: v.format } : null);
      })
      .catch(() => setVideo(null));
  }, [tabbed, studio, id]);
  const welcomeTracked = useRef(false);
  useEffect(() => {
    if (!welcome || !detail || welcomeTracked.current) return;
    welcomeTracked.current = true;
    track("invited_property_opened", { property_id: detail.demo.id, photos: detail.demo.photos, staged: detail.demo.staged });
  }, [welcome, detail]);
  const focusDone = useRef(false);
  useEffect(() => {
    if (!detail || focusDone.current) return;
    focusDone.current = true;
    const q = new URLSearchParams(window.location.search);
    const target = q.get("seccion") ?? window.location.hash.slice(1);
    if (isSection(target) && target !== "fotos")
      requestAnimationFrame(() => {
        const el = document.getElementById(`${target}-title`)?.querySelector("button");
        el?.focus();
        el?.scrollIntoView({ block: "start" });
      });
  }, [detail]);
  const toggle = (s: Section) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });

  // From an import that could not save the property's data: open the completion right away.
  const completeOpened = useRef(false);
  useEffect(() => {
    if ((!agencyMode && !agencyContext) || completeOpened.current || !detail?.property.listing_url) return;
    if (new URLSearchParams(window.location.search).get("completar") !== "1") return;
    completeOpened.current = true;
    setOpen((o) => new Set(o).add("publicacion"));
    api<Reread>(`${base}/publicacion`)
      .then(setReread)
      .catch((e) => say({ tone: "error", text: e instanceof Error ? e.message : "No pudimos leer la publicación.", section: "publicacion" }));
  }, [agencyMode, agencyContext, base, detail?.property.listing_url, say]);

  /** One photo's new state: only the photos change, never the forms. */
  const updatePhoto = useCallback((photo: EditorPhoto | null, photoId: string) => {
    setDetail((d) => {
      if (!d) return d;
      const photos = photo ? d.photos.map((p) => (p.id === photo.id ? photo : p)) : d.photos.filter((p) => p.id !== photoId);
      return { ...d, photos, demo: { ...d.demo, photos: photos.length, staged: photos.filter((p) => Object.keys(p.shown).length).length } };
    });
  }, []);
  const applySpaces = useCallback((s: SpaceState) => {
    setDetail((d) =>
      d ? { ...d, spaces: s.spaces, photos: d.photos.map((p) => ({ ...p, spaceId: s.assignments[p.id] ?? null })) } : d,
    );
  }, []);
  const poll = useCallback(
    async (photoId: string) => {
      const { photo } = await api<{ photo: EditorPhoto | null }>(`${base}/photos/${photoId}`);
      updatePhoto(photo, photoId);
      return photo;
    },
    [base, updatePhoto],
  );
  const staging = useStagingQueue({ base, detail, poll, report, trackAgency: agencyMode });

  // Versions already on the server (also after a reload) are followed until they finish; nothing is sent again.
  const livePhotos = useMemo(() => (detail?.photos || []).filter((p) => isLive(p)).map((p) => p.id), [detail]);
  const currentPhoto = staging.current?.photoId ?? null;
  useEffect(() => {
    if (!livePhotos.length) return;
    const timer = setInterval(() => {
      for (const photoId of livePhotos) if (photoId !== currentPhoto) void poll(photoId).catch(() => null);
    }, 5000);
    return () => clearInterval(timer);
  }, [livePhotos, poll, currentPhoto]);

  const formsDirty =
    Boolean(detail && forms) &&
    (() => {
      const now = formsOf(detail!);
      return {
        title: !same(forms!.title, now.title),
        property: !same(forms!.property, now.property),
        agency: !agencyMode && !same(forms!.agency, now.agency),
        brand: !agencyMode && !same(forms!.brand, now.brand),
      };
    })();
  const dirtyAny = dirtyParts.size > 0 || (formsDirty && Object.values(formsDirty).some(Boolean));
  // Warns before leaving with unsaved changes or versions still being created.
  useEffect(() => {
    if (!staging.busy && !livePhotos.length && !dirtyAny) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [staging.busy, livePhotos.length, dirtyAny]);
  const partDirty = useCallback(
    (part: ListingPart) => (dirty: boolean) =>
      setDirtyParts((s) => {
        if (s.has(part) === dirty) return s;
        const n = new Set(s);
        if (dirty) n.add(part);
        else n.delete(part);
        return n;
      }),
    [],
  );
  const partHandlers = useMemo(
    () => ({
      datos: partDirty("datos"),
      condiciones: partDirty("condiciones"),
      mapa: partDirty("mapa"),
      contacto: partDirty("contacto"),
      compartir: partDirty("compartir"),
    }),
    [partDirty],
  );

  async function run(task: () => Promise<void>, done?: string, section?: Section) {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      if (done) setMessage({ tone: "notice", text: done });
      return true;
    } catch (e) {
      say({ tone: "error", text: e instanceof Error ? e.message : "No pudimos guardar.", section });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const demoAction = (body: Record<string, unknown>, done?: string, section?: Section) =>
    run(async () => apply(await api<DemoDetail>(base, { method: "PATCH", body: JSON.stringify(body) })), done, section);
  /** Saves a listing part; fails loudly so the form keeps its draft. */
  const saveSettings = (section: Section) => async (settings: Record<string, unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      apply(await api<DemoDetail>(base, { method: "PATCH", body: JSON.stringify({ action: "settings", settings }) }));
      setMessage({ tone: "notice", text: "Guardado." });
    } catch (e) {
      say({ tone: "error", text: e instanceof Error ? e.message : "No pudimos guardar.", section });
      throw e;
    } finally {
      setBusy(false);
    }
  };
  async function patchPhoto(photoId: string, body: Record<string, unknown>) {
    try {
      const { photo } = await api<{ photo: EditorPhoto }>(`${base}/photos/${photoId}`, { method: "PATCH", body: JSON.stringify(body) });
      updatePhoto(photo, photoId);
      // Hiding or showing a photo can change the cover and the warnings, which the server works out.
      const changes = body.changes as { visible?: boolean } | undefined;
      if (changes?.visible !== undefined) await load().catch(() => undefined);
      return true;
    } catch (e) {
      say({ tone: "error", text: e instanceof Error ? e.message : "No pudimos guardar la foto.", section: "fotos" });
      return false;
    }
  }
  async function spaces(path: string, init: RequestInit, done?: string) {
    try {
      applySpaces(await api<SpaceState>(`${base}/espacios${path}`, init));
      if (done) setMessage({ tone: "notice", text: done });
      return true;
    } catch (e) {
      say({ tone: "error", text: e instanceof Error ? e.message : "No pudimos guardar el espacio.", section: "fotos" });
      return false;
    }
  }

  /**
   * Exactly the version (or original) asked for, by its id: a JPEG up to
   * 2048 px. It costs nothing, needs no balance and does not wait for other
   * versions being created; a failed download is said, never shown as done.
   */
  async function download(url: string, key: string, name: string) {
    setDownloading(key);
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      // Only a real image is saved: an error page is never offered as the file.
      if (!blob.type.startsWith("image/") || !blob.size) throw new Error();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      // property-space-style-version.jpg in plain letters: some browsers drop a name with accents and save "download".
      a.download = downloadName(name).ascii;
      document.body.appendChild(a);
      a.click();
      // Removed after the click is handled: some browsers drop the file name if the link goes at once.
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(href);
      }, 10000);
      setMessage({ tone: "notice", text: `Descarga lista: ${downloadName(name).ascii}.` });
      if (agencyMode) track("property_version_downloaded", { property_id: id, surface: studio ? "studio" : "property" });
    } catch {
      say({ tone: "error", text: "No pudimos descargar la imagen. Probá de nuevo.", section: "fotos" });
    } finally {
      setDownloading(null);
    }
  }

  async function upload(files: FileList | File[], spaceId: string | null = null) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setMessage(null);
    setUploads(list.map((f) => ({ name: f.name, state: "waiting" })));
    let ok = 0;
    const added: string[] = [];
    let spaceProblem = "";
    for (const [i, file] of list.entries()) {
      setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: "uploading" } : x)));
      try {
        const { file: optimized } = await optimizePhoto(file);
        const form = new FormData();
        form.set("image", optimized);
        if (spaceId) form.set("space", spaceId);
        const made = await api<{ id: string; spaceError?: string | null }>(`${base}/photos`, { method: "POST", body: form });
        if (made.spaceError) spaceProblem = made.spaceError;
        added.push(made.id);
        ok++;
        setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: "done" } : x)));
      } catch (e) {
        const text = e instanceof Error ? e.message : "No pudimos subir la foto.";
        setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: "error", error: text } : x)));
      }
    }
    // Only the photos are refreshed: drafts elsewhere are kept.
    try {
      const fresh = await api<DemoDetail>(base);
      setDetail((d) => (d ? { ...d, photos: fresh.photos, spaces: fresh.spaces, demo: fresh.demo } : fresh));
      setIncluded((s) => new Set([...s, ...added]));
    } catch {
      /* The next action reloads it. */
    }
    if (spaceProblem) say({ tone: "error", text: `Las fotos se guardaron, pero sin espacio: ${spaceProblem}`, section: "fotos" });
    else if (ok) setMessage({ tone: "notice", text: `${ok} ${ok === 1 ? "foto cargada" : "fotos cargadas"}.` });
    setTimeout(() => setUploads((u) => u.filter((x) => x.state === "error")), 2500);
  }

  async function move(photoId: string, step: number) {
    if (!detail) return;
    const ids = detail.photos.map((p) => p.id);
    const from = ids.indexOf(photoId),
      to = from + step;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setDetail({ ...detail, photos: ids.map((pid) => detail.photos.find((p) => p.id === pid)!) });
    await run(async () => {
      const d = await api<DemoDetail>(base, { method: "PATCH", body: JSON.stringify({ action: "order", ids }) });
      setDetail((cur) => (cur ? { ...cur, photos: d.photos } : d));
    }, undefined, "fotos");
  }

  if (!detail || !forms)
    return (
      <div className="account-page container dm-page">
        {banner}
        {loadError ? (
          <div className="account-panel" role="alert">
            <p className="inline-error">{loadError}</p>
            <button type="button" className="button button-small" onClick={() => (setLoadError(""), void load().catch((e) => setLoadError(e.message)))}>
              Reintentar
            </button>
          </div>
        ) : (
          <p role="status">Cargando la propiedad…</p>
        )}
      </div>
    );

  const { demo, photos } = detail;
  const live = demo.status === "published";
  const type: PropertyType = detail.settings.propertyType;
  // The property's styles: the ones with a version, plus the ones checked for the batch.
  const demoStyles = orderStyles([...detail.styles, ...picked], detail.mainStyle).filter((st) => styleFits(st, type));
  const main = demoStyles.includes(detail.mainStyle) ? detail.mainStyle : demoStyles[0];
  const canAddStyle = demoStyles.length < MAX_DEMO_STYLES;
  const summary = photoSummary(photos, detail.spaces);
  const blocked = detail.staging?.blocked ?? null;
  const payer = payerNote(detail.staging);
  const visiblePhotos = photos.filter((p) => p.visible);
  const openStyles = demoStyles.filter((st) => visiblePhotos.some((p) => p.shown[st]));
  const reviewPhoto = review && photos.find((p) => p.id === review.photoId);
  const reviewGen = reviewPhoto?.generations.find((g) => g.id === review!.generationId);
  const absent = missingData(detail.settings, { title: detail.property.title, location: detail.property.location });

  function addStyle(style: string) {
    if (demoStyles.includes(style)) return true;
    if (!canAddStyle) {
      say({ tone: "error", text: `Una propiedad admite hasta ${MAX_DEMO_STYLES} estilos.`, section: "fotos" });
      return false;
    }
    const next = [...picked.filter((s) => s !== style), style];
    setPicked(next);
    savePicked(demo.id, next);
    return true;
  }
  function toggleBatchStyle(style: string, on: boolean) {
    if (on) {
      addStyle(style);
      return;
    }
    // Unticking only leaves it out of the next batch: versions already created stay.
    const next = picked.filter((s) => s !== style);
    setPicked(next);
    savePicked(demo.id, next);
  }
  const spaceName = (p: EditorPhoto) => detail.spaces.find((s) => s.id === p.spaceId)?.name ?? photoLabel(p);

  /** Follows an AI tool until its jobs end, so the result shows up as a version without a reload. */
  async function watchTool(ids: string[], what: { photoId: string; tool: string }) {
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const d = await api<DemoDetail>(base);
        apply(d);
        const jobs = d.photos.flatMap((p) => p.generations).filter((g) => ids.includes(g.id));
        const settled = jobs.length > 0 && jobs.every((g) => g.status !== "queued" && g.status !== "running");
        if (settled) {
          const done = jobs.every((g) => g.status === "succeeded");
          if (agencyMode)
            track(done ? "photo_tool_completed" : "photo_tool_failed", { property_id: id, photo_id: what.photoId, tool: what.tool, surface: studio ? "studio" : "property" });
          say({
            tone: done ? "notice" : "error",
            text: done
              ? "Herramienta lista: el resultado está en Versiones de esta foto."
              : "La herramienta no pudo terminar. Si se cobró, el crédito se devuelve o el equipo lo revisa.",
            section: "fotos",
          });
          return;
        }
      } catch {
        // Keep following: a failed read is retried on the next turn.
      }
    }
  }

  const workspaceActions: WorkspaceActions = {
    patchPhoto,
    move: (photoId, step) => void move(photoId, step),
    spaces,
    cover: (photoId) => void demoAction({ action: "cover", photoId }, undefined, "fotos"),
    remove: (photoId) => {
      if (!window.confirm("¿Quitar esta foto de la propiedad? También se borran sus versiones.")) return;
      void run(async () => {
        await api(`${base}/photos/${photoId}`, { method: "DELETE" });
        updatePhoto(null, photoId);
      }, "Foto eliminada.", "fotos");
    },
    upload: (files, spaceId) => void upload(files, spaceId),
    download: (photoId, key, name, retouchId) =>
      void download(
        retouchId ? retouchDownloadUrl(retouchId, name) : photoId ? photoDownloadUrl(photoId, name) : generationDownloadUrl(key, name),
        key,
        name,
      ),
    tool: async (photoId, tool, source, mask) => {
      try {
        const { ids } = await api<{ ids: string[] }>(`${base}/photos/${photoId}`, {
          method: "POST",
          body: JSON.stringify({ tool, source, mask, key: crypto.randomUUID() }),
        });
        say({ tone: "notice", text: "Herramienta en marcha: el resultado aparece en Versiones de esta foto cuando esté listo.", section: "fotos" });
        if (agencyMode) track("photo_tool_started", { property_id: id, photo_id: photoId, tool, surface: studio ? "studio" : "property" });
        void watchTool(ids, { photoId, tool });
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "No pudimos empezar la herramienta.";
      }
    },
    quote: async (photoId) => {
      try {
        const q = await api<{ payer: "team" | "agency"; credits: number | null; newPhotos: number; blocked: string | null }>(`${base}/costo`, {
          method: "POST",
          body: JSON.stringify({ photoIds: [photoId] }),
        });
        if (q.payer === "team") return "Paga: equipo habita (demo). No usa créditos de la inmobiliaria.";
        if (q.blocked) return q.blocked;
        return q.newPhotos
          ? `Usa ${q.newPhotos} ${q.newPhotos === 1 ? "crédito" : "créditos"}; quedarían ${(q.credits ?? 0) - q.newPhotos}.`
          : "No usa créditos: la foto ya está paga y su cobertura sigue vigente.";
      } catch {
        return "";
      }
    },
    retouch: async (photoId, source, adjust) => {
      try {
        const { photo, retouch } = await api<{ photo: EditorPhoto | null; retouch: string }>(`${base}/photos/${photoId}/retoque`, {
          method: "POST",
          body: JSON.stringify({ source, adjust }),
        });
        if (photo) updatePhoto(photo, photoId);
        return retouch;
      } catch (e) {
        say({ tone: "error", text: e instanceof Error ? e.message : "No pudimos guardar la versión.", section: "fotos" });
        return null;
      }
    },
    review: (photoId, generationId) => setReview({ photoId, generationId }),
    addStyles: (list) => {
      const fresh = list.filter((st) => !demoStyles.includes(st));
      if (demoStyles.length + fresh.length > MAX_DEMO_STYLES) {
        say({ tone: "error", text: `Una propiedad admite hasta ${MAX_DEMO_STYLES} estilos.`, section: "fotos" });
        return false;
      }
      if (fresh.length) {
        const next = [...picked.filter((s) => !fresh.includes(s)), ...fresh];
        setPicked(next);
        savePicked(demo.id, next);
      }
      return true;
    },
    toggleBatchStyle,
    request: (tasks, opts) => staging.request(tasks, opts),
    cancelPending: staging.cancelPending,
    notice: (text) => setMessage({ tone: "notice", text }),
  };

  const photosSummary = (
    <>
      {summary.photos} {summary.photos === 1 ? "foto" : "fotos"}
      {summary.spaces ? ` · ${summary.spaces} ${summary.spaces === 1 ? "espacio" : "espacios"}` : ""}
      {summary.unassigned ? ` · ${summary.unassigned} sin organizar` : ""} · {summary.ready}{" "}
      {summary.ready === 1 ? "versión lista" : "versiones listas"}
      {summary.running ? ` · ${summary.running} en curso` : ""}
      {summary.issues ? ` · ${summary.issues} con problemas` : ""}
    </>
  );

  const reviewModal = reviewPhoto && reviewGen && (
        <Review
          photosOnly={demo.kind === "fotos"}
          photo={reviewPhoto}
          g={reviewGen}
          shown={reviewPhoto.shown[reviewGen.style] === reviewGen.id}
          blocked={blocked}
          downloading={downloading === reviewGen.id}
          onClose={() => setReview(null)}
          onDownload={() =>
            void download(
              generationDownloadUrl(reviewGen.id, versionFileName(demo.title, spaceName(reviewPhoto), styleName(reviewGen.style), versionNumber(reviewPhoto, reviewGen.id))),
              reviewGen.id,
              versionFileName(demo.title, spaceName(reviewPhoto), styleName(reviewGen.style), versionNumber(reviewPhoto, reviewGen.id)),
            )
          }
          onShow={async () => {
            await patchPhoto(reviewPhoto.id, { approve: reviewGen.id });
          }}
          onDiscard={async () => {
            if (await patchPhoto(reviewPhoto.id, { discard: reviewGen.id })) setReview(null);
          }}
          onRegenerate={() => {
            setReview(null);
            void staging.request([{ photoId: reviewPhoto.id, style: reviewGen.style }], { fresh: true });
          }}
        />
      );

  // "Estudio de imágenes": the same workspace, routes and limits, without the ficha around it.
  if (studio)
    return (
      <div className="st-editor">
        {message && (
          <p className={message.tone === "error" ? "inline-error" : "inline-notice"} role={message.tone === "error" ? "alert" : "status"}>
            {message.text}
            <button type="button" className="icon-button ed-dismiss" aria-label="Cerrar mensaje" onClick={() => setMessage(null)}>
              <X size={14} />
            </button>
          </p>
        )}
        {payer && (
          <p className="pw-note" role="note">
            {payer}
            {blocked ? " Podés ver, comparar, descargar y organizar todo lo creado." : ""}
          </p>
        )}
        {uploads.length > 0 && (
          <ul className="dm-uploads" aria-live="polite">
            {uploads.map((u, i) => (
              <li key={`${u.name}-${i}`} className={`is-${u.state}`}>
                {u.state === "uploading" && <Loader2 size={15} className="spin" />}
                {u.state === "done" && <Check size={15} />}
                {u.state === "error" && <X size={15} />}
                <span>{u.name}</span>
                {u.error && <em>{u.error}</em>}
              </li>
            ))}
          </ul>
        )}
        <PhotoWorkspace
          gallery="flat"
          onUseInDemo={onUseInDemo}
          detail={detail}
          base={base}
          propertyType={type}
          demoStyles={demoStyles}
          mainStyle={main}
          blocked={blocked}
          payerNote={payer}
          staging={staging}
          included={included}
          setIncluded={setIncluded}
          downloading={downloading}
          busy={busy}
          fileName={(p, g) => versionFileName(demo.title, spaceName(p), styleName(g.style), versionNumber(p, g.id))}
          originalName={(p) => versionFileName(demo.title, spaceName(p), "original")}
          actions={workspaceActions}
        />
        {reviewModal}
      </div>
    );

  // «Mostrar en demostración»: each switch saves at once; hiding never clears the value.
  const visibility: Visibility | undefined = tabbed
    ? {
        hidden: detail.settings.hidden,
        disabled: busy || !detail.settingsReady || Boolean(detail.readOnly),
        onToggle: (field: HideableField, show: boolean) =>
          void demoAction(
            {
              action: "settings",
              settings: { hidden: show ? detail.settings.hidden.filter((f) => f !== field) : [...detail.settings.hidden, field] },
            },
            show ? "Se muestra en la demostración." : "Oculto en la demostración: el dato queda guardado.",
            "datos",
          ),
      }
    : undefined;
  const dataBody = (
    <>
        <label className="dm-select dm-type">
          Tipo de inmueble
          <select
            value={type}
            disabled={busy || staging.busy || livePhotos.length > 0 || !detail.settingsReady}
            onChange={(e) => void demoAction({ action: "settings", settings: { propertyType: e.target.value } }, `Tipo de inmueble: ${PROPERTY_TYPE_NAMES[e.target.value as PropertyType]}.`, "datos")}
          >
            {(Object.keys(PROPERTY_TYPE_NAMES) as PropertyType[]).map((t) => (
              <option key={t} value={t}>
                {PROPERTY_TYPE_NAMES[t]}
              </option>
            ))}
          </select>
        </label>
        <p className="dm-help">
          Cambiar el tipo no borra ni renombra versiones: las de estilos del otro tipo quedan guardadas (se ven y descargan desde cada foto) pero no se
          muestran en la ficha.
        </p>
        <form
          className="ed-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(base, { method: "PATCH", body: JSON.stringify({ action: "property", property: forms.property }) });
              saved(await api<DemoDetail>(base), ["property"]);
            }, "Propiedad guardada.", "datos");
          }}
        >
          <PropertyFields visibility={visibility} value={forms.property} onChange={(property) => setForms({ ...forms, property })} />
          <button className="button button-small" disabled={busy || !formsDirty || !formsDirty.property}>
            Guardar propiedad
          </button>
        </form>
        <form
          className="dm-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => saved(await api<DemoDetail>(base, { method: "PATCH", body: JSON.stringify({ action: "demo", title: forms.title }) }), ["title"]), "Título guardado.", "datos");
          }}
        >
          <label className="dm-wide">
            Título que se muestra <small>(vacío usa el de la propiedad)</small>
            <input value={forms.title} maxLength={160} placeholder={detail.property.title} onChange={(e) => setForms({ ...forms, title: e.target.value })} />
          </label>
          <button className="button button-small" disabled={busy || !formsDirty || !formsDirty.title}>
            Guardar título
          </button>
        </form>
        {!detail.settingsReady && <MigrationNote />}
        <ListingForm
          visibility={visibility}
          parts={["datos"]}
          settings={detail.settings}
          disabled={busy || !detail.settingsReady}
          onSave={saveSettings("datos")}
          onDirty={partHandlers.datos}
          saveLabel="Guardar datos"
        />
    </>
  );
  const mapaBody = (
    <>
        <ListingForm
          visibility={visibility} parts={["mapa"]} settings={detail.settings} disabled={busy || !detail.settingsReady} onSave={saveSettings("mapa")} onDirty={partHandlers.mapa} saveLabel="Guardar mapa" />
    </>
  );
  const condBody = (
    <>
        <ListingForm
          visibility={visibility}
          parts={["condiciones"]}
          settings={detail.settings}
          disabled={busy || !detail.settingsReady}
          onSave={saveSettings("condiciones")}
          onDirty={partHandlers.condiciones}
          saveLabel="Guardar características"
        />
    </>
  );
  const marcaBody = (
    <>
        {agencyMode ? (
          <p className="dm-help">
            El logo, los colores y el canal de consultas de la inmobiliaria se cambian en <Link href="/panel/sitio">Mi sitio web</Link> (solo el dueño).
            Acá podés asignar el agente de esta propiedad.
          </p>
        ) : (
          <AgencyBrand
            detail={detail}
            forms={forms}
            setForms={setForms}
            busy={busy}
            base={base}
            run={run}
            onSaved={(d) => saved(d, ["agency", "brand"])}
            reload={load}
          />
        )}
        <ListingForm
          visibility={visibility}
          parts={["contacto"]}
          settings={detail.settings}
          disabled={busy || !detail.settingsReady}
          onSave={saveSettings("marca")}
          onDirty={partHandlers.contacto}
          saveLabel="Guardar agente"
        />
    </>
  );
  const pubBody = (
    <>
        <div className="ed-publish">
          <div>
            <h3>{agencyMode ? "Revisar antes de publicar" : "Antes de compartir"}</h3>
            <p className="dm-help">
              {detail.settings.reviewedAt
                ? `Revisada contra la publicación el ${new Date(detail.settings.reviewedAt).toLocaleDateString("es-AR")}.`
                : "Todavía sin revisar contra la publicación original."}{" "}
              {agencyMode ? "Solo lo ven las personas de tu inmobiliaria." : "Solo lo ve el equipo."}
            </p>
            <div className="dm-review-actions">
              <button
                type="button"
                className="button button-small button-outline"
                disabled={busy || !detail.property.listing_url}
                onClick={() => run(async () => setReread(await api<Reread>(`${base}/publicacion`)), undefined, "publicacion")}
              >
                Completar desde la publicación
              </button>
              <button
                type="button"
                className="button button-small"
                disabled={busy || !detail.settingsReady}
                onClick={() => demoAction({ action: "settings", settings: { reviewedAt: "now" } }, "Marcada como revisada hoy.", "publicacion")}
              >
                Marcar como revisada
              </button>
            </div>
            {detail.warnings.length > 0 ? (
              <ul className="dm-warnings">
                {detail.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : (
              <p className="inline-notice">Todo listo para compartir.</p>
            )}
            {reread && (
              <ListingSync
                reread={reread}
                detail={detail}
                base={base}
                busy={busy}
                onClose={() => setReread(null)}
                onDone={(d, done) => {
                  apply(d);
                  setReread(null);
                  setMessage({ tone: "notice", text: done });
                }}
              />
            )}

            <h3>Estilos que ve el comprador</h3>
            {detail.styles.length ? (
              <ul className="ed-buyer-styles">
                {orderStyles(detail.styles, detail.mainStyle).map((st) => (
                  <li key={st}>
                    <span>
                      {styleName(st)}
                      {!styleFits(st, type) && <small> · de otro tipo de inmueble, no se muestra</small>}
                    </span>
                    <button
                      type="button"
                      className={`dm-main ${st === detail.mainStyle ? "is-main" : ""}`}
                      aria-pressed={st === detail.mainStyle}
                      disabled={busy || st === detail.mainStyle}
                      onClick={() => demoAction({ action: "main-style", style: st }, `${styleName(st)} es ahora el estilo principal.`, "publicacion")}
                    >
                      <Star size={13} /> {st === detail.mainStyle ? "Principal" : "Hacer principal"}
                    </button>
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() =>
                        window.confirm(`Las versiones en ${styleName(st)} dejan de mostrarse en la ficha (quedan en el historial de cada foto). ¿Continuar?`) &&
                        demoAction({ action: "hide-style", style: st }, `${styleName(st)} ya no se muestra en la ficha.`, "publicacion")
                      }
                    >
                      Quitar de la ficha
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dm-help">Todavía no hay versiones creadas.</p>
            )}

            <h3>Al abrir la ficha</h3>
            {!detail.settingsReady && <MigrationNote />}
            <div className="dm-choice dm-choice-column" role="radiogroup" aria-label="Modo de apertura">
              <label>
                <input
                  type="radio"
                  name="open-mode"
                  checked={detail.settings.openMode === "styled"}
                  disabled={busy || !detail.settingsReady || !openStyles.length}
                  onChange={() =>
                    demoAction(
                      { action: "settings", settings: { openMode: "styled", openStyle: detail.settings.openStyle ?? openStyles[0] } },
                      "Guardado.",
                      "publicacion",
                    )
                  }
                />
                Ambientación predeterminada (recomendada)
              </label>
              <label>
                <input
                  type="radio"
                  name="open-mode"
                  checked={detail.settings.openMode === "original"}
                  disabled={busy || !detail.settingsReady}
                  onChange={() => demoAction({ action: "settings", settings: { openMode: "original" } }, "Guardado.", "publicacion")}
                />
                Foto original
              </label>
            </div>
            {detail.settings.openMode === "styled" && (
              <label className="dm-select">
                Estilo al abrir
                <select
                  value={openStyles.includes(detail.settings.openStyle ?? "") ? detail.settings.openStyle! : ""}
                  disabled={busy}
                  onChange={(e) => demoAction({ action: "settings", settings: { openStyle: e.target.value } }, "Guardado.", "publicacion")}
                >
                  {!openStyles.includes(detail.settings.openStyle ?? "") && <option value="">Elegí un estilo…</option>}
                  {openStyles.map((st) => (
                    <option key={st} value={st}>
                      {styleName(st)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="dm-help">
              {openStyles.length
                ? "Con ambientación, cada foto que tenga versiones abre comparada (mitad original y mitad creada) en este estilo; las demás, con la original."
                : "Para abrir con una ambientación, primero creá al menos una versión de una foto visible."}
            </p>
            {!agencyMode && (
              <label className="checkbox-label dm-check">
                <input
                  type="checkbox"
                  checked={detail.settings.banner}
                  disabled={busy || !detail.settingsReady}
                  onChange={(e) => demoAction({ action: "settings", settings: { banner: e.target.checked } }, "Guardado.", "publicacion")}
                />
                Mostrar «Demo preparada para {demo.agencyName} · Por habita.» en el enlace de presentación
              </label>
            )}
            <ListingForm
              parts={["compartir"]}
              settings={detail.settings}
              disabled={busy || !detail.settingsReady}
              onSave={saveSettings("publicacion")}
              onDirty={partHandlers.compartir}
              saveLabel="Guardar textos"
            />
          </div>
          <aside className="ed-share" id="compartir">
            <h3>Compartir</h3>
            {live && agencyMode ? (
              <>
                <label className="dm-link-label">
                  Enlace de la ficha
                  <input
                    className="dm-link"
                    readOnly
                    value={publicLink(demo.token)}
                    onFocus={(e) => e.target.select()}
                    onCopy={() => track("property_shared", { property_id: demo.id, channel: "manual_copy" })}
                  />
                </label>
                <div className="dm-share">
                  <button
                    type="button"
                    className="button button-small"
                    onClick={async () => {
                      const outcome = await shareLink(publicLink(demo.token), demo.title, demo.id);
                      if (outcome === "copied") setMessage({ tone: "notice", text: "Enlace copiado." });
                      else if (outcome === "failed") say({ tone: "error", text: "No pudimos copiar el enlace: seleccionalo en el campo y copialo." });
                    }}
                  >
                    Compartir
                  </button>
                  <a
                    className="button button-small button-outline"
                    href={whatsappShareUrl(publicLink(demo.token))}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => whatsappOpened(demo.id)}
                  >
                    Abrir WhatsApp
                  </a>
                </div>
                <p className="dm-help">Este enlace funciona aunque tu catálogo no esté publicado.</p>
              </>
            ) : (
              <>
                <ActivityStatus activity={demo.activity} sentAt={demo.sentAt} />
                {!agencyMode && (
                  <>
                    <SendLog events={detail.sendLog} />
                    <div className="dm-share-team">
                      <SendWhatsapp demo={demo} fixHere />
                      <SentToggle
                        demo={demo}
                        onDone={(text) => {
                          void load();
                          setMessage({ tone: "notice", text });
                        }}
                      />
                    </div>
                    <AgencyWhatsappEditor
                      demo={demo}
                      onDone={(text) => {
                        void load();
                        setMessage({ tone: "notice", text });
                      }}
                    />
                  </>
                )}
                <ShareCards demo={demo} />
              </>
            )}
            <LinkPreview demo={demo} location={detail.property.location} />
            <p className="dm-help">Así se verá el enlace en WhatsApp: la portada, mitad original y mitad en el estilo principal.</p>
            {live && (
              <button
                type="button"
                className="text-link dm-rotate"
                disabled={busy}
                onClick={() =>
                  window.confirm("El enlace actual dejará de funcionar y vas a tener que enviar el nuevo. ¿Continuar?") &&
                  demoAction({ action: "token" }, "Enlace nuevo generado; el anterior ya no funciona.", "publicacion")
                }
              >
                <RefreshCw size={14} /> Generar un enlace nuevo
              </button>
            )}
          </aside>
        </div>
    </>
  );
  // ---- «Crear demostración interactiva»: the agency's editor, in three tabs (the approved design) ----
  if (tabbed) {
    // The buyers' preview: the agency's own page in its panel, the team's under Administración.
    const previewHref = team ? `/admin/demos/${id}/vista-previa` : `/panel/propiedades/${id}/vista-previa`;
    const status = staging.busy || livePhotos.length ? "Creando versiones…" : dirtyAny ? "Cambios sin guardar" : busy ? "Guardando…" : "Guardado";
    const coverPhoto = (demo.cover ? photos.find((p) => p.id === demo.cover!.id) : null) ?? visiblePhotos[0] ?? photos[0] ?? null;
    const coverGen = coverPhoto ? (coverPhoto.shown[main] ?? Object.values(coverPhoto.shown)[0] ?? null) : null;
    const link = publicLink(demo.token);
    const canWork = !detail.readOnly;
    const setting = (settings: Record<string, unknown>, done = "Guardado.") => void demoAction({ action: "settings", settings }, done, "publicacion");
    const coverArt = (big: boolean) =>
      coverPhoto ? (
        coverGen ? (
          <Comparison
            before={adminPhotoUrl(coverPhoto.id, null, big ? 1200 : 640)}
            after={adminGenerationUrl(coverGen, big ? 1200 : 640)}
            beforeLabel="Antes"
            afterLabel="Después"
            beforeAlt={`${demo.title}, foto original`}
            alt={`${demo.title}, ambientada con IA`}
            initial={50}
          />
        ) : (
          <img src={adminPhotoUrl(coverPhoto.id, null, big ? 1200 : 640)} alt={`${demo.title}, portada`} />
        )
      ) : (
        <span className="dx-noimg">Sin fotos todavía</span>
      );
    async function publish() {
      if (dirtyAny && !window.confirm("Hay cambios sin guardar en «Datos de la propiedad». Se publica lo guardado; los cambios sin guardar quedan en el formulario. ¿Publicar igual?")) return;
      const ok = await run(async () => {
        apply(await api<DemoDetail>(base, { method: "PATCH", body: JSON.stringify({ action: "publish" }) }));
        agencyTrack("property_published", { property_id: demo.id, photos: demo.photos, staged: demo.staged });
      }, undefined, "publicacion");
      if (ok) setJustPublished(true);
    }
    const videoBlock =
      videoEnabled() && demo.kind !== "fotos" ? (
        <section className="dx-video" aria-labelledby="dx-video-title">
          <div className="dx-video-intro">
            <span className="dx-video-icon" aria-hidden="true">
              <PlayCircle size={26} />
            </span>
            <div>
              <h3 id="dx-video-title">Generar video</h3>
              <p>Creá un video con las fotos de esta propiedad.</p>
            </div>
          </div>
          <fieldset className="dx-video-place" disabled={busy || !detail.settingsReady || !canWork}>
            <legend>¿Dónde mostrar el video?</legend>
            {VIDEO_PLACES.map((place) => (
              <label key={place}>
                <input
                  type="radio"
                  name="dx-video-place"
                  checked={detail.settings.videoPlacement === place}
                  onChange={() =>
                    void demoAction(
                      { action: "settings", settings: { videoPlacement: place } },
                      video ? "Ubicación del video guardada." : "Ubicación guardada: se aplica cuando generes el video.",
                      "fotos",
                    )
                  }
                />
                <span>
                  <strong>{VIDEO_PLACE_LABEL[place][0]}</strong>
                  <small>({VIDEO_PLACE_LABEL[place][1]})</small>
                </span>
              </label>
            ))}
          </fieldset>
          {canWork && !team && (
            <Link
              href={`/panel/video?${new URLSearchParams({ propiedad: id, volver: `/panel/propiedades/${id}?seccion=fotos` })}`}
              className="button button-primary dx-video-go"
              onClick={() => agencyTrack("demo_editor_video_opened", { property_id: id, has_video: Boolean(video) })}
            >
              <PlayCircle size={17} aria-hidden="true" /> Generar video
            </Link>
          )}
          {video ? (
            <details className="dx-video-current">
              <summary>Ver el video actual</summary>
              <video src={video.url} controls playsInline preload="metadata" className={video.format === "16:9" ? "" : "is-vertical"} style={{ aspectRatio: formatRatio(formatOf(video.format)) }} />
            </details>
          ) : (
            <p className="dm-help dx-video-note">Todavía no hay video: la ubicación elegida se aplica cuando lo generes. La ficha no muestra un reproductor vacío.</p>
          )}
        </section>
      ) : null;

    return (
      <div className="account-page container dm-page ed-page dx-page">
        {banner}
        <header className="dx-head">
          <Link href={backTo} className="icon-button dx-back" aria-label={backTo.startsWith("/panel/propiedades") ? "Volver a Mis propiedades" : "Volver"}>
            ←
          </Link>
          <div className="dx-head-title">
            <h1>{demo.title}</h1>
            {demo.kind === "fotos" ? <span className="dm-status">Fotos sin ficha</span> : <StatusChip status={demo.status} />}
          </div>
          <span className={`dx-saved ${status === "Guardado" ? "is-ok" : ""}`} role="status">
            {status === "Guardado" ? <Check size={15} aria-hidden="true" /> : busy || staging.busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null} {status}
          </span>
          {demo.kind === "fotos" ? (
            canWork && (
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() =>
                  void run(
                    async () => {
                      await api(`/api/panel/imagenes/${id}/ficha`, { method: "POST" });
                      await load();
                    },
                    "La ficha se creó en borrador con estas fotos y sus versiones. Completá sus datos y publicala cuando quieras.",
                    "datos",
                  )
                }
              >
                Crear ficha con estas fotos
              </button>
            )
          ) : (
            <Link href={previewHref} className="button button-outline dx-preview">
              <Eye size={17} aria-hidden="true" /> Vista previa
            </Link>
          )}
        </header>

        {detail.readOnly && (
          <p className="inline-notice" role="note">
            Tu usuario es de solo vista: podés ver esta propiedad y compartir su enlace, pero no cambiarla.
          </p>
        )}

        {demo.kind !== "fotos" && (
          <div className="dx-tabs" role="tablist" aria-label="Editor de la demostración">
            {(
              [
                ["fotos", "Fotos y espacios"],
                ["datos", "Datos de la propiedad"],
                ["publicacion", "Publicación y enlace"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`dx-tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`dx-panel-${t}`}
                className={tab === t ? "is-on" : ""}
                onClick={() => pickTab(t)}
              >
                {label}
                {t === "datos" && (dirtyParts.size > 0 || (formsDirty && (formsDirty.property || formsDirty.title))) && <span className="dx-dot" aria-label="(cambios sin guardar)" />}
              </button>
            ))}
          </div>
        )}

        {message && (
          <p className={message.tone === "error" ? "inline-error" : "inline-notice"} role={message.tone === "error" ? "alert" : "status"}>
            {message.text}
            <button type="button" className="icon-button ed-dismiss" aria-label="Cerrar mensaje" onClick={() => setMessage(null)}>
              <X size={14} />
            </button>
          </p>
        )}

        {/* Every tab stays mounted (hidden): drafts, selections and progress are kept when switching. */}
        <section id="dx-panel-fotos" role="tabpanel" aria-labelledby="dx-tab-fotos" hidden={tab !== "fotos" && demo.kind !== "fotos"} className="dx-panel">
          {welcome && (
            <section className="ed-welcome" aria-labelledby="ed-welcome-title">
              <span className="ed-welcome-icon" aria-hidden="true">
                <ImageIcon size={20} />
              </span>
              <div>
                <h2 id="ed-welcome-title">Empezá con una foto</h2>
                <p>Elegí un estilo, comparalo con el original y descargalo. Descargar no usa créditos.</p>
              </div>
              <button type="button" className="icon-button" aria-label="Cerrar la guía" onClick={() => setWelcome(false)}>
                <X size={16} />
              </button>
            </section>
          )}
          {demo.kind === "fotos" && (
            <p className="inline-notice" role="note">
              Son fotos importadas, todavía sin ficha. Podés ambientarlas y descargarlas sin crearla; para la demostración, creá la ficha.
            </p>
          )}
          {payer && (
            <p className="pw-note" role="note">
              {payer}
              {blocked ? " Podés ver, comparar, descargar y organizar todo lo creado." : ""}
            </p>
          )}
          {uploads.length > 0 && (
            <ul className="dm-uploads" aria-live="polite">
              {uploads.map((u, i) => (
                <li key={`${u.name}-${i}`} className={`is-${u.state}`}>
                  {u.state === "uploading" && <Loader2 size={15} className="spin" />}
                  {u.state === "done" && <Check size={15} />}
                  {u.state === "error" && <X size={15} />}
                  <span>{u.name}</span>
                  {u.error && <em>{u.error}</em>}
                </li>
              ))}
            </ul>
          )}
          <PhotoWorkspace
            variant="demo"
            editHref={studioEditing ? (photoId, versionId) => studioEditLink(id, photoId, versionId) : undefined}
            belowGrid={videoBlock}
            detail={detail}
            base={base}
            propertyType={type}
            demoStyles={demoStyles}
            mainStyle={main}
            blocked={blocked}
            payerNote={payer}
            staging={staging}
            included={included}
            setIncluded={setIncluded}
            downloading={downloading}
            busy={busy}
            fileName={(p, g) => versionFileName(demo.title, spaceName(p), styleName(g.style), versionNumber(p, g.id))}
            originalName={(p) => versionFileName(demo.title, spaceName(p), "original")}
            actions={workspaceActions}
          />
          {welcome && (
            <section className="ed-next-property" aria-labelledby="ed-next-title">
              <span className="ed-welcome-icon" aria-hidden="true">
                <Home size={20} />
              </span>
              <div>
                <h2 id="ed-next-title">¿Querés probar con otra propiedad?</h2>
                <p>Pegá una publicación y traé sus datos y fotos.</p>
              </div>
              <Link href="/panel" className="button button-outline" onClick={() => agencyTrack("invited_next_property_clicked", { property_id: demo.id })}>
                <Plus size={16} aria-hidden="true" /> Agregar otra propiedad
              </Link>
            </section>
          )}
        </section>

        {demo.kind !== "fotos" && (
          <>
            <section id="dx-panel-datos" role="tabpanel" aria-labelledby="dx-tab-datos" hidden={tab !== "datos"} className="dx-panel dx-data">
              {!detail.settings.showData && (
                <p className="inline-notice" role="note">
                  «Mostrar datos de la propiedad» está apagado en «Publicación y enlace»: la demostración no muestra ninguno de estos datos (quedan guardados).
                </p>
              )}
              <section className="dx-card" aria-labelledby="dx-data-title">
                <div className="dx-card-head">
                  <h2 id="dx-data-title">Información de la propiedad</h2>
                  <span className="dx-vis-head" title="Apagado: el dato queda guardado y editable, pero no se muestra en la ficha pública.">
                    Mostrar en demostración <Info size={14} aria-hidden="true" />
                  </span>
                </div>
                {dataBody}
              </section>
              <section className="dx-card" aria-labelledby="dx-cond-title">
                <div className="dx-card-head">
                  <h2 id="dx-cond-title">Características y condiciones</h2>
                </div>
                {condBody}
              </section>
              <section className="dx-card" aria-labelledby="dx-map-title">
                <div className="dx-card-head">
                  <h2 id="dx-map-title">Ubicación y mapa</h2>
                </div>
                {mapaBody}
              </section>
              <section className="dx-card" aria-labelledby="dx-contact-title">
                <div className="dx-card-head">
                  <h2 id="dx-contact-title">Contacto</h2>
                </div>
                {marcaBody}
              </section>
              <section className="dx-card" aria-labelledby="dx-sync-title">
                <div className="dx-card-head">
                  <h2 id="dx-sync-title">Completar desde la publicación</h2>
                </div>
                <p className="dm-help">
                  {detail.property.listing_url
                    ? "Volvé a leer la publicación original para completar los datos que falten. Nada se reemplaza sin que lo confirmes."
                    : "Esta propiedad no tiene publicación original: sus datos se completan a mano en esta pestaña."}
                </p>
                <button
                  type="button"
                  className="button button-small button-outline"
                  disabled={busy || !detail.property.listing_url || !canWork}
                  onClick={() => run(async () => setReread(await api<Reread>(`${base}/publicacion`)), undefined, "datos")}
                >
                  Completar desde la publicación
                </button>
                {reread && (
                  <ListingSync
                    reread={reread}
                    detail={detail}
                    base={base}
                    busy={busy}
                    onClose={() => setReread(null)}
                    onDone={(d, done) => {
                      apply(d);
                      setReread(null);
                      setMessage({ tone: "notice", text: done });
                    }}
                  />
                )}
              </section>
            </section>

            <section id="dx-panel-publicacion" role="tabpanel" aria-labelledby="dx-tab-publicacion" hidden={tab !== "publicacion"} className="dx-panel">
              <section className="dx-card dx-config" aria-labelledby="dx-config-title">
                <h2 id="dx-config-title">Configuración de la demostración</h2>
                {!detail.settingsReady && <MigrationNote />}
                <div className="dx-config-grid">
                  <fieldset className="dx-checks" disabled={busy || !detail.settingsReady || !canWork}>
                    <legend className="dv2-sr">Qué muestra la demostración</legend>
                    <label className="dx-check">
                      <input type="checkbox" checked={detail.settings.showStyles} onChange={(e) => setting({ showStyles: e.target.checked })} />
                      Mostrar selector de estilos
                    </label>
                    <label className="dx-check">
                      <input
                        type="checkbox"
                        checked={detail.settings.videoPlacement !== "hidden"}
                        disabled={!videoEnabled()}
                        onChange={(e) => setting({ videoPlacement: e.target.checked ? "below" : "hidden" })}
                      />
                      Mostrar video {!video && <small>(cuando exista)</small>}
                    </label>
                    <div className="dx-radios" role="radiogroup" aria-label="Ubicación del video">
                      {VIDEO_PLACES.map((place) => (
                        <label key={place}>
                          <input
                            type="radio"
                            name="dx-pub-video-place"
                            checked={detail.settings.videoPlacement === place}
                            disabled={detail.settings.videoPlacement === "hidden" || !videoEnabled()}
                            onChange={() => setting({ videoPlacement: place })}
                          />
                          {place === "below" ? "Video debajo de las fotos" : `Video ${VIDEO_PLACE_LABEL[place][0].toLowerCase()} (en la galería)`}
                        </label>
                      ))}
                    </div>
                    <label className="dx-check">
                      <input type="checkbox" checked={detail.settings.showData} onChange={(e) => setting({ showData: e.target.checked })} />
                      Mostrar datos de la propiedad
                    </label>
                    <small className="dx-check-help">
                      Usa la configuración definida en{" "}
                      <button type="button" className="text-link" onClick={() => pickTab("datos")}>
                        «Datos de la propiedad»
                      </button>
                      .
                    </small>
                    <label className="dx-check">
                      <input type="checkbox" checked={detail.settings.showContact} onChange={(e) => setting({ showContact: e.target.checked })} />
                      Incluir datos de contacto
                    </label>
                  </fieldset>
                  <figure className="dx-config-preview">{coverArt(false)}</figure>
                </div>
                {!live && canWork && (
                  <button type="button" className="button button-primary dx-publish" disabled={busy} onClick={() => void publish()}>
                    <Link2 size={18} aria-hidden="true" /> Publicar y obtener enlace
                  </button>
                )}
                {!live && (
                  <p className="dm-help">
                    Publicar no usa créditos y no necesita ambientaciones: podés publicar con las fotos originales. Antes, revisala en{" "}
                    <Link href={previewHref}>Vista previa</Link>.
                  </p>
                )}
              </section>

              {live && (
                <section className="dx-card dx-published" aria-labelledby="dx-published-title">
                  <div className="dx-published-main">
                    <div className="dx-published-head">
                      <span className="dx-ok" aria-hidden="true">
                        <Check size={26} strokeWidth={3} />
                      </span>
                      <div>
                        <h2 id="dx-published-title">{justPublished ? "¡Demostración publicada!" : "Demostración publicada"}</h2>
                        <p>{team ? "La ficha ya está online." : "Tu propiedad ya está online y lista para compartir."}</p>
                        {team && (
                          <p className="dm-help">
                            Para mandársela a la inmobiliaria con su invitación, usá «Enviar» en <Link href="/admin/demos">Demos</Link>.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="dx-link">
                      <Link2 size={17} aria-hidden="true" />
                      <input
                        readOnly
                        value={link}
                        aria-label="Enlace de la demostración"
                        onFocus={(e) => e.target.select()}
                        onCopy={() => agencyTrack("property_shared", { property_id: demo.id, channel: "manual_copy" })}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Copiar enlace"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(link);
                            agencyTrack("property_shared", { property_id: demo.id, channel: "copy_button" });
                            setMessage({ tone: "notice", text: "Enlace copiado." });
                          } catch {
                            say({ tone: "error", text: "No pudimos copiar el enlace: seleccionalo en el campo y copialo." });
                          }
                        }}
                      >
                        <Copy size={17} />
                      </button>
                    </div>
                    <a className="button button-primary dx-wa" href={whatsappShareUrl(link)} target="_blank" rel="noopener noreferrer" onClick={() => agencyMode && whatsappOpened(demo.id)}>
                      <MessageCircle size={18} aria-hidden="true" /> Compartir por WhatsApp
                    </a>
                    <a className="button button-outline dx-view" href={link} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={17} aria-hidden="true" /> Ver demostración
                    </a>
                    {canWork && (
                      <button
                        type="button"
                        className="text-link dx-unpublish"
                        disabled={busy}
                        onClick={() =>
                          window.confirm(
                            `¿Despublicar «${demo.title}»? El enlace deja de funcionar enseguida para quien lo tenga ${team ? "" : " y sale de tu catálogo"}. La ficha, sus fotos y versiones se conservan; al volver a publicar, el enlace es el mismo.`,
                          ) &&
                          void run(
                            async () => {
                              apply(await api<DemoDetail>(base, { method: "PATCH", body: JSON.stringify({ action: "unpublish" }) }));
                              setJustPublished(false);
                              agencyTrack("property_unpublished", { property_id: demo.id, photos: demo.photos, staged: demo.staged });
                            },
                            "Ficha despublicada: el enlace dejó de estar disponible.",
                            "publicacion",
                          )
                        }
                      >
                        Despublicar
                      </button>
                    )}
                  </div>
                  <figure className="dx-published-card">
                    <div className="dx-published-art">{coverArt(true)}</div>
                    <figcaption>
                      <strong>{demo.title}</strong>
                      {detail.property.location && <small>{detail.property.location}</small>}
                    </figcaption>
                  </figure>
                </section>
              )}

              <details className="dx-card dx-more">
                <summary>Más opciones de publicación</summary>
                <p className="dm-help">Revisión, estilo principal, cómo abre la ficha, textos al compartir y enlace.</p>
                {pubBody}
              </details>
            </section>
          </>
        )}
        {reviewModal}
      </div>
    );
  }
  return (
    <div className="account-page container dm-page ed-page">
      {banner}
      <header className="ed-header">
        {!banner && (
          <Link href={backTo} className="text-link">
            ←{" "}
            {backTo.startsWith("/panel/imagenes/lote")
              ? "Volver al lote"
              : backTo.startsWith("/panel/imagenes")
                ? "Fotos importadas"
                : backTo.startsWith("/panel")
                  ? "Mis propiedades"
                  : backTo.startsWith("/admin/demos")
                    ? "Demos"
                    : "Inmobiliarias"}
          </Link>
        )}
        {detail.readOnly && (
          <p className="inline-notice" role="note">
            Tu usuario es de solo vista: podés ver esta propiedad y compartir su enlace, pero no cambiarla.
          </p>
        )}
        {demo.kind === "fotos" && (
          <p className="inline-notice" role="note">
            Son fotos importadas, todavía sin ficha. Podés ambientarlas y descargarlas sin crearla; ver o elegir una versión no publica nada.
          </p>
        )}
        <div className="ed-header-row">
          <div>
            <span className="eyebrow">{demo.agencyName}</span>
            <h1>
              {demo.title}
              <span className="accent">.</span>
            </h1>
            <p className="ed-header-meta">
              {demo.kind === "fotos" ? <span className="dm-status">Fotos sin ficha</span> : <StatusChip status={demo.status} />}{" "}
              <span role="status">
                {staging.busy || livePhotos.length
                  ? "Creando versiones…"
                  : dirtyAny
                    ? "Hay cambios sin guardar"
                    : busy
                      ? "Guardando…"
                      : "Todo guardado"}
              </span>
            </p>
          </div>
          {demo.kind === "fotos" ? (
            <div className="dm-heading-actions">
              {agencyMode && (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      async () => {
                        await api(`/api/panel/imagenes/${id}/ficha`, { method: "POST" });
                        await load();
                      },
                      "La ficha se creó en borrador con estas fotos y sus versiones. Completá sus datos y publicala cuando quieras.",
                      "publicacion",
                    )
                  }
                >
                  Crear ficha con estas fotos
                </button>
              )}
            </div>
          ) : (
          <div className="dm-heading-actions">
            {/* Sharing first (spec v3 §3.1): not at the end of a long page. */}
            {live && agencyMode && (
              <button
                type="button"
                className="button button-primary"
                onClick={async () => {
                  const outcome = await shareLink(publicLink(demo.token), demo.title, demo.id);
                  if (outcome === "copied") setMessage({ tone: "notice", text: "Enlace copiado." });
                  else if (outcome === "failed") say({ tone: "error", text: "No pudimos copiar el enlace: copialo desde «Publicación y compartir».", section: "publicacion" });
                }}
              >
                <Share2 size={17} aria-hidden="true" /> Compartir
              </button>
            )}
            {live && agencyMode ? (
              <a href={publicLink(demo.token)} target="_blank" rel="noopener noreferrer" className="button button-outline">
                <Eye size={17} /> Vista para comprador
              </a>
            ) : (
              <Link href={agencyMode ? `/panel/propiedades/${id}/vista-previa` : `/admin/demos/${id}/vista-previa`} className="button button-outline">
                <Eye size={17} /> {agencyMode ? "Vista para comprador" : "Vista previa"}
              </Link>
            )}
            <button
              type="button"
              className={`button ${live ? "button-outline" : "button-primary"}`}
              disabled={busy}
              onClick={() =>
                window.confirm(
                  live
                    ? `¿Despublicar «${demo.title}»? El enlace deja de funcionar enseguida para quien lo tenga${agencyMode ? " y sale de tu catálogo" : ""}. La ficha, sus fotos y versiones se conservan.`
                    : `¿Publicar «${demo.title}»? Cualquiera con el enlace va a poder verla${agencyMode ? ", y aparece en tu catálogo si está publicado" : ""}. Publicar no usa créditos.`,
                ) &&
                void run(
                  async () => {
                    apply(await api<DemoDetail>(base, { method: "PATCH", body: JSON.stringify({ action: live ? "unpublish" : "publish" }) }));
                    // Counted once the server confirmed it.
                    if (agencyMode) track(live ? "property_unpublished" : "property_published", { property_id: demo.id, photos: demo.photos, staged: demo.staged });
                  },
                  live
                    ? `${agencyMode ? "Ficha despublicada" : "Demo despublicada"}: el enlace dejó de estar disponible.`
                    : `${agencyMode ? "Ficha publicada" : "Demo publicada"}. Ya podés compartir el enlace.`,
                  "publicacion",
                )
              }
            >
              {live ? "Despublicar" : agencyMode ? "Publicar ficha" : "Publicar demo"}
            </button>
          </div>
          )}
        </div>
      </header>
      {message && (
        <p className={message.tone === "error" ? "inline-error" : "inline-notice"} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
          <button type="button" className="icon-button ed-dismiss" aria-label="Cerrar mensaje" onClick={() => setMessage(null)}>
            <X size={14} />
          </button>
        </p>
      )}

      {welcome && (
        <section className="ed-welcome" aria-labelledby="ed-welcome-title">
          <span className="ed-welcome-icon" aria-hidden="true">
            <ImageIcon size={20} />
          </span>
          <div>
            <h2 id="ed-welcome-title">Empezá con una foto</h2>
            <p>Elegí una versión, comparala con el original y descargala. Descargar no usa créditos.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Cerrar la guía" onClick={() => setWelcome(false)}>
            <X size={16} />
          </button>
        </section>
      )}

      <Fold id="fotos" title="Fotos y espacios" summary={photosSummary} open={open.has("fotos")} onToggle={() => toggle("fotos")}>
        {payer && (
          <p className="pw-note" role="note">
            {payer}
            {blocked ? " Podés ver, comparar, descargar y organizar todo lo creado." : ""}
          </p>
        )}
        {uploads.length > 0 && (
          <ul className="dm-uploads" aria-live="polite">
            {uploads.map((u, i) => (
              <li key={`${u.name}-${i}`} className={`is-${u.state}`}>
                {u.state === "uploading" && <Loader2 size={15} className="spin" />}
                {u.state === "done" && <Check size={15} />}
                {u.state === "error" && <X size={15} />}
                <span>{u.name}</span>
                {u.error && <em>{u.error}</em>}
              </li>
            ))}
          </ul>
        )}
        <PhotoWorkspace
          detail={detail}
          base={base}
          propertyType={type}
          demoStyles={demoStyles}
          mainStyle={main}
          blocked={blocked}
          payerNote={payer}
          staging={staging}
          included={included}
          setIncluded={setIncluded}
          downloading={downloading}
          busy={busy}
          fileName={(p, g) => versionFileName(demo.title, spaceName(p), styleName(g.style), versionNumber(p, g.id))}
          originalName={(p) => versionFileName(demo.title, spaceName(p), "original")}
          actions={workspaceActions}
        />
      </Fold>

      {agencyMode && welcome && (
        <section className="ed-next-property" aria-labelledby="ed-next-title">
          <span className="ed-welcome-icon" aria-hidden="true">
            <Home size={20} />
          </span>
          <div>
            <h2 id="ed-next-title">¿Querés probar con otra propiedad?</h2>
            <p>Pegá una publicación y traé sus datos y fotos.</p>
          </div>
          <Link href="/panel" className="button button-outline" onClick={() => track("invited_next_property_clicked", { property_id: demo.id })}>
            <Plus size={16} aria-hidden="true" /> Agregar otra propiedad
          </Link>
        </section>
      )}

      <Fold
        id="datos"
        title="Datos de la propiedad"
        summary={absent.length ? `Falta: ${absent.join(", ")}` : "Completos"}
        open={open.has("datos")}
        onToggle={() => toggle("datos")}
        dirty={formsDirty ? formsDirty.property || formsDirty.title || dirtyParts.has("datos") : false}
      >
        {dataBody}
      </Fold>

      <Fold
        id="mapa"
        title="Ubicación y mapa"
        summary={MAP_SUMMARY[detail.settings.map.precision]}
        open={open.has("mapa")}
        onToggle={() => toggle("mapa")}
        dirty={dirtyParts.has("mapa")}
      >
        {mapaBody}
      </Fold>

      <Fold
        id="condiciones"
        title="Características y condiciones"
        summary={`${detail.settings.facts.length} datos con íconos · ${detail.settings.amenities.length} grupos de características`}
        open={open.has("condiciones")}
        onToggle={() => toggle("condiciones")}
        dirty={dirtyParts.has("condiciones")}
      >
        {condBody}
      </Fold>

      <Fold
        id="marca"
        title="Marca y contacto"
        summary={
          detail.settings.agent?.name
            ? `Agente: ${detail.settings.agent.name}`
            : detail.branding.contactKind && detail.branding.contactValue
              ? "Contacto de la inmobiliaria"
              : "Sin contacto para consultas"
        }
        open={open.has("marca")}
        onToggle={() => toggle("marca")}
        dirty={dirtyParts.has("contacto") || (formsDirty ? formsDirty.agency || formsDirty.brand : false)}
      >
        {marcaBody}
      </Fold>

      <Fold
        id="publicacion"
        title="Publicación y compartir"
        summary={`${live ? "Publicada" : "Borrador"}${detail.warnings.length ? ` · ${detail.warnings.length} ${detail.warnings.length === 1 ? "aviso" : "avisos"}` : ""}`}
        open={open.has("publicacion")}
        onToggle={() => toggle("publicacion")}
        dirty={dirtyParts.has("compartir")}
      >
        {pubBody}
      </Fold>

      {reviewModal}
    </div>
  );
}

/** The team's fields about the agency: identity, private notes, logo, colors and the inquiries channel. */
function AgencyBrand({
  detail,
  forms,
  setForms,
  busy,
  base,
  run,
  onSaved,
  reload,
}: {
  detail: DemoDetail;
  forms: ReturnType<typeof formsOf>;
  setForms: (f: ReturnType<typeof formsOf>) => void;
  busy: boolean;
  base: string;
  run: (task: () => Promise<void>, done?: string, section?: Section) => Promise<boolean>;
  onSaved: (d: DemoDetail) => void;
  reload: () => Promise<void>;
}) {
  const brand = forms.brand;
  const setBrand = (b: typeof brand) => setForms({ ...forms, brand: b });
  const name = detail.demo.agencyName;
  return (
    <>
      {!detail.settingsReady && <MigrationNote />}
      <div className="dm-logo">
        {detail.branding.logo ? <img src={detail.branding.logo} alt={`Logo de ${name}`} /> : <span className="dm-logo-empty">Sin logo: se muestra el nombre</span>}
        <div className="dm-logo-actions">
          <label className="button button-small button-outline">
            {detail.branding.logo ? "Cambiar logo" : "Subir logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="dm-hidden-input"
              disabled={busy || !detail.settingsReady}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const form = new FormData();
                form.set("logo", file);
                void run(async () => {
                  await api(`${base}/logo`, { method: "POST", body: form });
                  await reload();
                }, "Logo guardado.", "marca");
              }}
            />
          </label>
          {detail.branding.logo && (
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`${base}/logo`, { method: "DELETE" });
                  await reload();
                }, "Logo quitado.", "marca")
              }
            >
              Quitar
            </button>
          )}
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api(base, { method: "PATCH", body: JSON.stringify({ action: "agency", agency: forms.agency }) });
            if (detail.settingsReady) await api(base, { method: "PATCH", body: JSON.stringify({ action: "branding", branding: brand }) });
            onSaved(await api<DemoDetail>(base));
          }, "Inmobiliaria guardada.", "marca");
        }}
      >
        <AgencyFields value={forms.agency} onChange={(agency) => setForms({ ...forms, agency })} />
        <div className="dm-fields">
          <label>
            Color principal <small>(botones)</small>
            <span className="dm-color">
              <input type="color" value={brand.primary || "#1f3a5f"} onChange={(e) => setBrand({ ...brand, primary: e.target.value })} aria-label="Color principal" />
              <input value={brand.primary} placeholder="#1f3a5f" maxLength={7} onChange={(e) => setBrand({ ...brand, primary: e.target.value })} />
            </span>
          </label>
          <label>
            Color secundario <small>(selección y etiquetas)</small>
            <span className="dm-color">
              <input type="color" value={brand.accent || "#6f8f5a"} onChange={(e) => setBrand({ ...brand, accent: e.target.value })} aria-label="Color secundario" />
              <input value={brand.accent} placeholder="#6f8f5a" maxLength={7} onChange={(e) => setBrand({ ...brand, accent: e.target.value })} />
            </span>
          </label>
          <label>
            Tipografía de títulos
            <select value={brand.titleFont} onChange={(e) => setBrand({ ...brand, titleFont: e.target.value as "sans" | "serif" })}>
              <option value="sans">Sin serif (moderna)</option>
              <option value="serif">Con serif (clásica)</option>
            </select>
          </label>
          <label>
            Cómo la contactan los compradores
            <select value={brand.contactKind} onChange={(e) => setBrand({ ...brand, contactKind: e.target.value as typeof brand.contactKind })}>
              {Object.entries(CONTACT_LABELS).map(([k, [label]]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="dm-wide">
            {CONTACT_LABELS[brand.contactKind][0]} <small>(el mismo canal que usa en su sitio)</small>
            <input value={brand.contactValue} maxLength={300} placeholder={CONTACT_LABELS[brand.contactKind][1]} onChange={(e) => setBrand({ ...brand, contactValue: e.target.value })} />
          </label>
          <label className="dm-wide">
            Enlace para coordinar visitas <small>(opcional: solo si existe)</small>
            <input value={brand.visitUrl} maxLength={300} inputMode="url" placeholder="https://…" onChange={(e) => setBrand({ ...brand, visitUrl: e.target.value })} />
          </label>
        </div>
        <p className="dm-help">
          «Consultar a {name}» usa este canal. Con WhatsApp se prepara un mensaje con la propiedad; el comprador decide enviarlo. Sin contacto cargado, el
          botón no aparece.
        </p>
        <button className="button button-small" disabled={busy}>
          Guardar inmobiliaria
        </button>
      </form>
    </>
  );
}

/** One created version, large: compare, download, choose it for the listing, discard or create another. Closing saves nothing. */
function Review({
  photosOnly = false,
  photo,
  g,
  shown,
  blocked,
  downloading,
  onClose,
  onDownload,
  onShow,
  onDiscard,
  onRegenerate,
}: {
  /** Imported photos without a ficha: the chosen version is "seleccionada", not shown on a ficha. */
  photosOnly?: boolean;
  photo: EditorPhoto;
  g: GenerationRow;
  shown: boolean;
  blocked: string | null;
  downloading: boolean;
  onClose: () => void;
  onDownload: () => void;
  onShow: () => Promise<void>;
  onDiscard: () => Promise<void>;
  onRegenerate: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const discarded = photo.discarded.includes(g.id);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [onClose]);
  const act = async (f: () => Promise<void>) => {
    setSaving(true);
    try {
      await f();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="dm-modal" role="dialog" aria-modal="true" aria-labelledby="dm-review-title" onClick={onClose}>
      <div className="dm-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="dm-modal-head">
          <h2 id="dm-review-title">
            {photoLabel(photo)} · {styleName(g.style)}
            <small className="ed-review-state">{discarded ? "Descartada" : shown ? (photosOnly ? "Versión seleccionada" : "Se muestra en la ficha") : "Guardada, no se muestra"}</small>
          </h2>
          <button ref={close} type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <Comparison
          before={adminPhotoUrl(photo.id, null, 1600)}
          after={adminGenerationUrl(g.id, 1600)}
          beforeLabel="Foto original"
          beforeAlt="Foto original"
          afterLabel={`Versión ${styleName(g.style)}`}
          alt="Versión creada con IA"
          initial={50}
        />
        <p className="dm-help">
          Comprobá que paredes, puertas, ventanas, pisos, dimensiones y vistas sigan iguales y que no aparezcan características que la propiedad no
          tiene. La descarga es un JPEG de hasta 2048 px.
        </p>
        <div className="dm-modal-actions">
          <button type="button" className="button button-outline" disabled={downloading} onClick={onDownload}>
            {downloading ? <Loader2 size={16} className="spin" /> : null} Descargar
          </button>
          {!shown && !discarded && (
            <button type="button" className="button button-outline" disabled={saving} onClick={() => act(onShow)}>
              <Check size={16} /> Mostrar esta en la ficha
            </button>
          )}
          {!discarded && (
            <button type="button" className="button button-outline" disabled={saving} onClick={() => act(onDiscard)}>
              <Trash2 size={16} /> Descartar
            </button>
          )}
          <button type="button" className="button button-outline" disabled={saving || Boolean(blocked)} title={blocked ?? undefined} onClick={onRegenerate}>
            <RefreshCw size={16} /> Crear otra versión
          </button>
          <button type="button" className="button button-primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function MigrationNote() {
  return (
    <p className="inline-error" role="status">
      Para guardar logo, colores, contacto y apertura falta aplicar la migración{" "}
      <code>202610270001_demo_branding.sql</code> en Supabase. Mientras tanto la demo abre con la foto
      original y sin marca propia.
    </p>
  );
}

type Reread = {
  imported: ImportedDemo;
  fill: ImportChange[];
  conflicts: ImportChange[];
  checkedAt: string;
};

/**
 * A new reading of the original listing, applied with care: empty fields and
 * what the old reading wrote are completed; values edited by hand are listed
 * and only replaced if ticked. The link and the stagings are kept, the
 * listing's own photos are added in its order and the ones from other
 * properties are taken out.
 */
function ListingSync({
  reread,
  detail,
  base,
  busy,
  onClose,
  onDone,
}: {
  reread: Reread;
  detail: DemoDetail;
  base: string;
  busy: boolean;
  onClose: () => void;
  onDone: (d: DemoDetail, notice: string) => void;
}) {
  const [replace, setReplace] = useState<Set<ImportField>>(new Set());
  const [dropForeign, setDropForeign] = useState(true);
  // Completing the data (a missing map, say) does not download the photos again unless asked.
  const [withPhotos, setWithPhotos] = useState(detail.photos.length === 0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const imported = reread.imported;
  const foreign = foreignPhotos(detail.photos, imported.propertyId);
  const working = Boolean(status) || busy;
  const pending = exceptions(imported.report);

  async function complete() {
    setError("");
    setStatus("Completando los datos…");
    try {
      const done = await api<{ fields: string[]; completed: { logo: boolean; contact: boolean }; images: string[] }>(
        `${base}/publicacion`,
        { method: "POST", body: JSON.stringify({ replace: [...replace] }) },
      );
      let removed = 0;
      let hidden = 0;
      if (withPhotos && dropForeign)
        for (const p of foreign) {
          setStatus(`Quitando fotos de otras propiedades: ${removed + hidden + 1} de ${foreign.length}…`);
          // Without stagings nothing is lost; with them, the photo is only hidden.
          if (p.generations.length) {
            await api(`${base}/photos/${p.id}`, { method: "PATCH", body: JSON.stringify({ changes: { visible: false } }) });
            hidden++;
          } else {
            await api(`${base}/photos/${p.id}`, { method: "DELETE" });
            removed++;
          }
        }
      const { ids, failed } = withPhotos ? await syncPhotos(base, done.images, setStatus) : { ids: [] as string[], failed: 0 };
      if (withPhotos) {
        const fresh = await api<DemoDetail>(base);
        const rest = fresh.photos.map((p) => p.id).filter((id) => !ids.includes(id));
        const order = [...ids.filter((id) => fresh.photos.some((p) => p.id === id)), ...rest];
        if (order.join() !== fresh.photos.map((p) => p.id).join())
          await api(base, { method: "PATCH", body: JSON.stringify({ action: "order", ids: order }) });
      }
      const added = ids.length - detail.photos.filter((p) => ids.includes(p.id)).length;
      onDone(
        await api<DemoDetail>(base),
        [
          `${done.fields.length} datos completados desde la publicación`,
          withPhotos ? `${added} fotos agregadas, ${ids.length - added} ya estaban` : "",
          failed ? `${failed} no se pudieron descargar` : "",
          removed + hidden ? `${removed + hidden} de otras propiedades quitadas${hidden ? ` (${hidden} ocultas por tener ambientaciones)` : ""}` : "",
          done.completed.logo ? "logo importado" : "",
          done.completed.contact ? "contacto de la inmobiliaria cargado" : "",
        ]
          .filter(Boolean)
          .join(" · ") + ".",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos completar la demo.");
    } finally {
      setStatus("");
    }
  }

  return (
    <div className="dm-reread" role="region" aria-label="Completar desde la publicación">
      <div className="dm-reread-head">
        <strong>Publicación leída el {new Date(reread.checkedAt).toLocaleString("es-AR")}</strong>
        <button type="button" className="text-link" onClick={onClose} disabled={working}>
          Cerrar
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <ImportPreview data={imported} />
      {reread.fill.length > 0 ? (
        <>
          <h3>Se completa</h3>
          <table>
            <tbody>
              {reread.fill.map((c) => (
                <tr key={c.field} className="is-diff">
                  <th scope="row">{c.label}</th>
                  <td>{c.current === "—" ? <em>vacío</em> : c.current}</td>
                  <td>{c.imported}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="dm-help">No hay datos vacíos para completar.</p>
      )}
      {reread.conflicts.length > 0 && (
        <>
          <h3>Distinto a lo que se editó a mano</h3>
          <p className="dm-help">Se mantiene lo de la demo salvo que marques reemplazarlo.</p>
          <table>
            <thead>
              <tr>
                <th scope="col">Dato</th>
                <th scope="col">En la demo</th>
                <th scope="col">En la publicación</th>
                <th scope="col">Reemplazar</th>
              </tr>
            </thead>
            <tbody>
              {reread.conflicts.map((c) => (
                <tr key={c.field} className="is-diff">
                  <th scope="row">{c.label}</th>
                  <td>{c.current}</td>
                  <td>{c.imported}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Reemplazar ${c.label}`}
                      checked={replace.has(c.field)}
                      onChange={(e) => {
                        const next = new Set(replace);
                        if (e.target.checked) next.add(c.field);
                        else next.delete(c.field);
                        setReplace(next);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {pending.length > 0 && (
        <ul className="dm-warnings">
          {pending.map((r) => (
            <li key={r.field}>
              <strong>{r.field}:</strong> {r.note}
            </li>
          ))}
        </ul>
      )}
      <label className="dm-check">
        <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
        Agregar también las fotos que faltan ({imported.images.length} en la publicación)
      </label>
      <p className="dm-help">
        Las fotos que ya están conservan sus ambientaciones; las que faltan se agregan en el orden de la
        publicación. Sin marcar, solo se completan los datos (por ejemplo, el mapa).
      </p>
      {withPhotos && foreign.length > 0 && (
        <label className="dm-check">
          <input type="checkbox" checked={dropForeign} onChange={(e) => setDropForeign(e.target.checked)} />
          Quitar {foreign.length} fotos de otras propiedades (las que tienen ambientaciones quedan ocultas, no se borran)
        </label>
      )}
      <details className="dm-report-wrap">
        <summary>Ver todos los datos leídos</summary>
        <ImportReport report={imported.report} />
      </details>
      <button type="button" className="button button-primary" disabled={working} onClick={() => void complete()}>
        {status || "Completar la demo"}
      </button>
    </div>
  );
}

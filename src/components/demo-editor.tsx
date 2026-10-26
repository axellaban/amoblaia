"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Comparison } from "./comparison";
import {
  AgencyFields,
  LinkPreview,
  PropertyFields,
  ShareButtons,
  StatusChip,
  api,
  publicLink,
} from "./admin-demos";
import { optimizePhoto } from "@/lib/images";
import { rooms } from "@/lib/catalog";
import { DEMO_STYLES, PROPERTY_TYPE_NAMES, styleFits, type PropertyType } from "@/lib/demos/styles";
import { ListingForm } from "./demo-listing-form";
import { ImportPreview, ImportReport, exceptions, foreignPhotos, syncPhotos } from "./demo-import";
import type { ImportChange, ImportField, ImportedDemo } from "@/lib/demos/import";
import {
  MAX_DEMO_STYLES,
  adminGenerationUrl,
  adminPhotoUrl,
  generationNote,
  orderStyles,
  photoLabel,
  roomName,
  styleName,
  type DemoDetail,
  type EditorPhoto,
  type GenerationRow,
} from "@/lib/demos/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const emptyBrand = {
  primary: "",
  accent: "",
  titleFont: "sans" as "sans" | "serif",
  contactKind: "whatsapp" as "whatsapp" | "url" | "phone" | "email",
  contactValue: "",
  visitUrl: "",
};
const CONTACT_LABELS = {
  whatsapp: ["WhatsApp", "+54 9 223 555-1234"],
  url: ["Formulario o página de contacto", "https://inmobiliaria.com/contacto"],
  phone: ["Teléfono", "+54 223 555-1234"],
  email: ["Email", "consultas@inmobiliaria.com"],
} as const;
const liveStatus = (g: GenerationRow) => g.status === "queued" || g.status === "running";
const isLive = (p: EditorPhoto, style?: string) =>
  p.generations.some((g) => liveStatus(g) && (!style || g.style === style));
type Task = { photoId: string; style: string };
const taskKey = (t: Task) => `${t.photoId}:${t.style}`;
/** Styles checked in the panel but not staged yet live only in this browser until they are. */
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

export function DemoEditor({ id }: { id: string }) {
  const [detail, setDetail] = useState<DemoDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string[]>([]);
  const [queue, setQueue] = useState<Task[]>([]);
  const [review, setReview] = useState<{ photoId: string; style: string } | null>(null);
  const [title, setTitle] = useState("");
  const [agency, setAgency] = useState({ name: "", website: "", contact_name: "", notes: "" });
  const [property, setProperty] = useState({ title: "", listing_url: "", location: "", description: "" });
  const [brand, setBrand] = useState(emptyBrand);
  const [reread, setReread] = useState<Reread | null>(null);
  const base = `/api/admin/demos/${id}`;
  const queueRef = useRef<string | null>(null);
  const firstLoad = useRef(true);

  const apply = useCallback((d: DemoDetail) => {
    setDetail(d);
    if (firstLoad.current) {
      firstLoad.current = false;
      // Every visible photo is staged unless unticked (bathrooms, façades, plans…).
      setSelected(new Set(d.photos.filter((p) => p.visible).map((p) => p.id)));
      setPicked(readPicked(d.demo.id));
    }
    setTitle(d.demo.title === d.property.title ? "" : d.demo.title);
    setAgency({
      name: d.agency.name,
      website: d.agency.website ?? "",
      contact_name: d.agency.contact_name ?? "",
      notes: d.agency.notes ?? "",
    });
    setProperty({
      title: d.property.title,
      listing_url: d.property.listing_url ?? "",
      location: d.property.location ?? "",
      description: d.property.description ?? "",
    });
    setBrand({
      primary: d.branding.primary ?? "",
      accent: d.branding.accent ?? "",
      titleFont: d.branding.titleFont ?? "sans",
      contactKind: d.branding.contactKind ?? "whatsapp",
      contactValue: d.branding.contactValue ?? "",
      visitUrl: d.branding.visitUrl ?? "",
    });
  }, []);
  const load = useCallback(async () => apply(await api<DemoDetail>(base)), [apply, base]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  const updatePhoto = useCallback((photo: EditorPhoto | null, photoId: string) => {
    setDetail((d) => {
      if (!d) return d;
      const photos = photo
        ? d.photos.map((p) => (p.id === photo.id ? photo : p))
        : d.photos.filter((p) => p.id !== photoId);
      return {
        ...d,
        photos,
        demo: {
          ...d.demo,
          photos: photos.length,
          staged: photos.filter((p) => Object.keys(p.shown).length).length,
        },
      };
    });
  }, []);

  async function run(task: () => Promise<void>, done?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setBusy(false);
    }
  }
  const demoAction = (body: Record<string, unknown>, done?: string) =>
    run(async () => {
      apply(await api<DemoDetail>(base, { method: "PATCH", body: JSON.stringify(body) }));
    }, done);
  async function patchPhoto(photoId: string, body: Record<string, unknown>) {
    setError("");
    try {
      const { photo } = await api<{ photo: EditorPhoto }>(`${base}/photos/${photoId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      updatePhoto(photo, photoId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar la foto.");
    }
  }
  const poll = useCallback(
    async (photoId: string) => {
      const { photo } = await api<{ photo: EditorPhoto | null }>(`${base}/photos/${photoId}`);
      updatePhoto(photo, photoId);
      return photo;
    },
    [base, updatePhoto],
  );

  // Photos still rendering (for example after a reload) are followed until they finish.
  const livePhotos = useMemo(
    () => (detail?.photos || []).filter((p) => isLive(p)).map((p) => p.id),
    [detail],
  );
  useEffect(() => {
    if (!livePhotos.length) return;
    const timer = setInterval(() => {
      for (const photoId of livePhotos)
        if (photoId !== queueRef.current) void poll(photoId).catch(() => null);
    }, 5000);
    return () => clearInterval(timer);
  }, [livePhotos, poll]);
  // Keeps the screen awake and warns before leaving while proposals render.
  useEffect(() => {
    if (!queue.length && !livePhotos.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [queue.length, livePhotos.length]);

  /** One version at a time: the account admits one live generation, like the studio. */
  async function generate(tasks: Task[]) {
    setQueue(tasks);
    setError("");
    setNotice("");
    let failures = 0;
    for (const task of tasks) {
      queueRef.current = task.photoId;
      const photo = detail?.photos.find((p) => p.id === task.photoId);
      if (!photo) continue;
      try {
        await api(`${base}/photos/${task.photoId}`, {
          method: "POST",
          body: JSON.stringify({
            key: crypto.randomUUID(),
            room: photo.room,
            mode: photo.mode,
            style: task.style,
          }),
        });
        let current = await poll(task.photoId);
        while (current && isLive(current)) {
          await sleep(4000);
          current = await poll(task.photoId);
        }
        const last = current?.generations.find((g) => g.style === task.style);
        if (last?.status !== "succeeded") failures++;
      } catch (e) {
        failures++;
        setError(e instanceof Error ? e.message : "No pudimos ambientar la foto.");
        // Quota, capacity or configuration problems would repeat: stop the batch.
        break;
      } finally {
        setQueue((q) => q.filter((x) => taskKey(x) !== taskKey(task)));
      }
    }
    queueRef.current = null;
    setQueue([]);
    if (!failures)
      setNotice("Ambientaciones listas. Revisalas: las que no sirvan, descartalas o regeneralas.");
  }

  async function upload(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setError("");
    setNotice("");
    setUploads(list.map((f) => ({ name: f.name, state: "waiting" })));
    let ok = 0;
    for (const [i, file] of list.entries()) {
      setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: "uploading" } : x)));
      try {
        const { file: optimized } = await optimizePhoto(file);
        const form = new FormData();
        form.set("image", optimized);
        await api(`${base}/photos`, { method: "POST", body: form });
        ok++;
        setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: "done" } : x)));
      } catch (e) {
        const message = e instanceof Error ? e.message : "No pudimos subir la foto.";
        setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: "error", error: message } : x)));
      }
    }
    await load().catch(() => null);
    if (ok) setNotice(`${ok} ${ok === 1 ? "foto cargada" : "fotos cargadas"}. Indicá el ambiente de cada una.`);
    setTimeout(() => setUploads((u) => u.filter((x) => x.state === "error")), 2500);
  }

  async function move(photoId: string, step: number) {
    if (!detail) return;
    const ids = detail.photos.map((p) => p.id);
    const from = ids.indexOf(photoId),
      to = from + step;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setDetail({
      ...detail,
      photos: ids.map((pid) => detail.photos.find((p) => p.id === pid)!),
    });
    await demoAction({ action: "order", ids });
  }

  if (!detail)
    return (
      <div className="account-page container dm-page">
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : (
          <p>Cargando demo…</p>
        )}
      </div>
    );

  const { demo, photos } = detail;
  const live = demo.status === "published";
  const generating = queue.length > 0;
  const busyAny = generating || livePhotos.length > 0;
  // Styles of the demo: the staged ones plus the ones just checked here.
  const type: PropertyType = detail.settings.propertyType;
  // Only styles that fit the property: an office never offers a living room.
  const typeStyles = DEMO_STYLES[type];
  const chosen = orderStyles([...detail.styles, ...picked], detail.mainStyle).filter((st) => styleFits(st, type));
  const main = chosen.includes(detail.mainStyle) ? detail.mainStyle : chosen[0];
  const pending: Task[] = photos
    .filter((p) => selected.has(p.id))
    .flatMap((p) =>
      chosen.filter((style) => !p.shown[style] && !isLive(p, style)).map((style) => ({ photoId: p.id, style })),
    );
  // Opening mode B uses a style of the first photo the buyer sees.
  const firstVisible = photos.find((p) => p.visible);
  const openStyles = firstVisible ? chosen.filter((st) => firstVisible.shown[st]) : [];
  const reviewPhoto = review && photos.find((p) => p.id === review.photoId);
  const reviewGenId = review && reviewPhoto?.shown[review.style];
  const reviewGen = reviewPhoto?.generations.find((g) => g.id === reviewGenId);

  /** The ambientaciones follow the property: other types' styles stop showing (they are not deleted). */
  async function changeType(next: PropertyType) {
    await demoAction({ action: "settings", settings: { propertyType: next } }, `Tipo de inmueble: ${PROPERTY_TYPE_NAMES[next]}.`);
    if (!styleFits(detail!.mainStyle, next))
      await demoAction({ action: "main-style", style: DEMO_STYLES[next][0].id });
  }

  async function toggleStyle(style: string, on: boolean) {
    if (on) {
      if (chosen.length >= MAX_DEMO_STYLES) {
        setError(`Una demo admite hasta ${MAX_DEMO_STYLES} estilos.`);
        return;
      }
      const next = [...picked.filter((s) => s !== style), style];
      setPicked(next);
      savePicked(demo.id, next);
      // The first style becomes the main one.
      if (!chosen.length) await demoAction({ action: "main-style", style });
      return;
    }
    const staged = photos.filter((p) => p.shown[style]).length;
    if (
      staged &&
      !window.confirm(
        `Se quitan de la demo las ${staged} ${staged === 1 ? "foto ambientada" : "fotos ambientadas"} en ${styleName(style)}. Quedan en "Descartadas" por si querés recuperarlas. ¿Continuar?`,
      )
    )
      return;
    const next = picked.filter((s) => s !== style);
    setPicked(next);
    savePicked(demo.id, next);
    if (staged) await demoAction({ action: "hide-style", style }, `${styleName(style)} ya no se muestra en la demo.`);
    const rest = chosen.filter((s) => s !== style);
    if (style === main && rest.length) await demoAction({ action: "main-style", style: rest[0] });
  }

  return (
    <div className="account-page container dm-page">
      <Link href="/admin/demos" className="text-link">
        ← Demos comerciales
      </Link>
      <div className="dm-heading">
        <div>
          <span className="eyebrow">{demo.agencyName}</span>
          <h1>
            {demo.title}
            <span className="accent">.</span>
          </h1>
          <p>
            <StatusChip status={demo.status} /> {demo.photos} {demo.photos === 1 ? "foto" : "fotos"} ·{" "}
            {demo.staged} {demo.staged === 1 ? "ambientada" : "ambientadas"}
          </p>
        </div>
        <div className="dm-heading-actions">
          <Link href={`/admin/demos/${id}/vista-previa`} className="button button-outline">
            <Eye size={17} /> Vista previa
          </Link>
          <button
            type="button"
            className={`button ${live ? "button-outline" : "button-primary"}`}
            disabled={busy}
            onClick={() =>
              demoAction(
                { action: live ? "unpublish" : "publish" },
                live
                  ? "Demo despublicada: el enlace dejó de estar disponible."
                  : "Demo publicada. Ya podés compartir el enlace.",
              )
            }
          >
            {live ? "Despublicar" : "Publicar demo"}
          </button>
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}

      <section className="account-panel dm-review" aria-labelledby="dm-review-title-2">
        <div className="dm-styles-head">
          <div>
            <h2 id="dm-review-title-2">Antes de compartir</h2>
            <p className="dm-help">
              {detail.settings.reviewedAt
                ? `Revisada contra la publicación el ${new Date(detail.settings.reviewedAt).toLocaleDateString("es-AR")}.`
                : "Todavía sin revisar contra la publicación original."}{" "}
              Solo lo ve el equipo.
            </p>
          </div>
          <div className="dm-review-actions">
            <button
              type="button"
              className="button button-small button-outline"
              disabled={busy || !detail.property.listing_url}
              onClick={() =>
                run(async () => {
                  setReread(await api<Reread>(`${base}/publicacion`));
                })
              }
            >
              Completar desde la publicación
            </button>
            <button
              type="button"
              className="button button-small"
              disabled={busy || !detail.settingsReady}
              onClick={() => demoAction({ action: "settings", settings: { reviewedAt: "now" } }, "Marcada como revisada hoy.")}
            >
              Marcar como revisada
            </button>
          </div>
        </div>
        {!detail.settingsReady && <MigrationNote />}
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
              setNotice(done);
            }}
          />
        )}
      </section>

      <section className="account-panel dm-styles-panel" aria-labelledby="dm-styles-title">
        <div className="dm-styles-head">
          <div>
            <h2 id="dm-styles-title">Estilos de la demo</h2>
            <label className="dm-select dm-type">
              Tipo de inmueble
              <select
                value={type}
                disabled={busy || busyAny || !detail.settingsReady}
                onChange={(e) => void changeType(e.target.value as PropertyType)}
              >
                {(Object.keys(PROPERTY_TYPE_NAMES) as PropertyType[]).map((t) => (
                  <option key={t} value={t}>
                    {PROPERTY_TYPE_NAMES[t]}
                  </option>
                ))}
              </select>
            </label>
            <p className="dm-help">
              Elegí qué estilos va a ver la inmobiliaria en cada foto. El principal se usa de portada y
              en la vista previa de WhatsApp: la primera foto, mitad original y mitad ambientada.
            </p>
          </div>
          <span className="dm-styles-count">
            {chosen.length} de {MAX_DEMO_STYLES}
          </span>
        </div>
        <ul className="dm-styles">
          {typeStyles.map((st) => {
            const on = chosen.includes(st.id);
            return (
              <li key={st.id} className={on ? "is-on" : ""}>
                <label>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy || busyAny}
                    onChange={(e) => void toggleStyle(st.id, e.target.checked)}
                  />
                  <span className="dm-style-swatch" style={{ background: st.color }} aria-hidden="true" />
                  {st.name}
                </label>
                {on && (
                  <button
                    type="button"
                    className={`dm-main ${st.id === main ? "is-main" : ""}`}
                    aria-pressed={st.id === main}
                    disabled={busy || st.id === main}
                    onClick={() =>
                      demoAction({ action: "main-style", style: st.id }, `${st.name} es ahora el estilo principal.`)
                    }
                  >
                    <Star size={13} /> {st.id === main ? "Principal" : "Hacer principal"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="dm-styles-foot">
          <p className="dm-help">
            {chosen.length
              ? `${selected.size} ${selected.size === 1 ? "foto marcada" : "fotos marcadas"} × ${chosen.length} ${chosen.length === 1 ? "estilo" : "estilos"}. Se ambientan de a una.`
              : "Elegí al menos un estilo para ambientar las fotos."}
          </p>
          <button
            type="button"
            className="button button-primary"
            disabled={!pending.length || busyAny}
            onClick={() => void generate(pending)}
          >
            {generating ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            {generating
              ? `Ambientando… quedan ${queue.length}`
              : pending.length
                ? `Ambientar ${pending.length} ${pending.length === 1 ? "imagen pendiente" : "imágenes pendientes"}`
                : "Todo ambientado"}
          </button>
        </div>
      </section>

      <div className="dm-editor">
        <section className="account-panel dm-photos" aria-labelledby="dm-photos-title">
          <h2 id="dm-photos-title">Fotos de la propiedad</h2>
          <p className="dm-help">
            Las originales se conservan sin cambios. Cada foto marcada se ambienta en los estilos de la
            demo: la IA mantiene encuadre, paredes, aberturas y pisos, pero revisá cada versión antes de
            publicar.
          </p>
          <label
            className={`dm-drop ${dragging ? "is-dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void upload(e.dataTransfer.files);
            }}
          >
            <ImagePlus size={26} aria-hidden="true" />
            <span>
              <strong>Arrastrá las fotos acá</strong> o tocá para elegirlas
            </span>
            <small>JPG, PNG o WebP de hasta 10 MB. Se optimizan antes de subir.</small>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => {
                if (e.target.files) void upload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
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

          {photos.length > 0 && (
            <div className="dm-batch">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selected.size === photos.length}
                  disabled={generating}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(photos.map((p) => p.id)) : new Set())
                  }
                />
                Ambientar todas
              </label>
              <span className="dm-help">Destildá las que se muestran como son (baños, fachadas, planos).</span>
            </div>
          )}

          {!photos.length && <p className="dm-empty-photos">Todavía no cargaste fotos.</p>}
          <ol className="dm-photo-list">
            {photos.map((p, i) => {
              const discarded = p.generations.filter((g) => p.discarded.includes(g.id));
              const busyPhoto = isLive(p) || queue.some((t) => t.photoId === p.id);
              const cover = demo.cover?.id === p.id;
              const mainVersion = p.shown[main];
              return (
                <li key={p.id} className={`dm-photo ${p.visible ? "" : "is-hidden"}`}>
                  <div className="dm-photo-head">
                    <input
                      type="checkbox"
                      aria-label={`Ambientar ${photoLabel(p)}`}
                      title="Ambientar esta foto"
                      checked={selected.has(p.id)}
                      disabled={generating}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(p.id);
                        else next.delete(p.id);
                        setSelected(next);
                      }}
                    />
                    <span className="dm-photo-index">{i + 1}</span>
                    <div className="dm-photo-thumb">
                      <img
                        src={mainVersion ? adminGenerationUrl(mainVersion, 480) : adminPhotoUrl(p.id, null, 480)}
                        alt={photoLabel(p)}
                        loading="lazy"
                      />
                      <div className="dm-badges">
                        {cover && <span>Portada</span>}
                        {!selected.has(p.id) && <span className="is-muted">Sin ambientar</span>}
                        {!p.visible && <span className="is-muted">Oculta</span>}
                      </div>
                    </div>
                    <div className="dm-photo-fields">
                      <label hidden={type === "office"}>
                        Ambiente
                        <select
                          value={p.room}
                          disabled={busyPhoto}
                          onChange={(e) => patchPhoto(p.id, { changes: { room: e.target.value } })}
                        >
                          {rooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Nombre visible
                        <input
                          defaultValue={p.label ?? ""}
                          placeholder={roomName(p.room)}
                          maxLength={80}
                          onBlur={(e) => {
                            if ((p.label ?? "") !== e.target.value.trim())
                              void patchPhoto(p.id, { changes: { label: e.target.value } });
                          }}
                        />
                      </label>
                      <label>
                        Operación
                        <select
                          value={p.mode}
                          disabled={busyPhoto}
                          onChange={(e) => patchPhoto(p.id, { changes: { mode: e.target.value } })}
                        >
                          <option value="furnish">Amoblar (vacío)</option>
                          <option value="redesign">Rediseñar (con muebles)</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="dm-photo-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Subir"
                      disabled={i === 0 || busy}
                      onClick={() => move(p.id, -1)}
                    >
                      <ArrowUp size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Bajar"
                      disabled={i === photos.length - 1 || busy}
                      onClick={() => move(p.id, 1)}
                    >
                      <ArrowDown size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={p.visible ? "Ocultar en la demo" : "Mostrar en la demo"}
                      title={p.visible ? "Ocultar en la demo" : "Mostrar en la demo"}
                      onClick={() => patchPhoto(p.id, { changes: { visible: !p.visible } })}
                    >
                      {p.visible ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                    <button
                      type="button"
                      className={`icon-button ${demo.coverPhotoId === p.id ? "is-on" : ""}`}
                      aria-label="Usar como portada"
                      aria-pressed={demo.coverPhotoId === p.id}
                      title="Usar como portada"
                      disabled={busy}
                      onClick={() =>
                        demoAction({
                          action: "cover",
                          photoId: demo.coverPhotoId === p.id ? null : p.id,
                        })
                      }
                    >
                      <Star size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-button dm-danger"
                      aria-label="Eliminar foto"
                      disabled={busyPhoto}
                      onClick={() =>
                        window.confirm("¿Quitar esta foto de la demo? También se borran sus propuestas.") &&
                        run(async () => {
                          await api(`${base}/photos/${p.id}`, { method: "DELETE" });
                          updatePhoto(null, p.id);
                        }, "Foto eliminada.")
                      }
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  {chosen.length > 0 && selected.has(p.id) && (
                    <div className="dm-proposals">
                      <span className="dm-proposals-title">Estilos</span>
                      <ul>
                        {chosen.map((style) => (
                          <StyleCell
                            key={style}
                            photo={p}
                            style={style}
                            queued={queue.some((t) => t.photoId === p.id && t.style === style)}
                            disabled={busyAny}
                            onOpen={() => setReview({ photoId: p.id, style })}
                            onStage={() => void generate([{ photoId: p.id, style }])}
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                  {discarded.length > 0 && (
                    <details className="dm-discarded">
                      <summary>Descartadas ({discarded.length})</summary>
                      <ul>
                        {discarded.map((g) => (
                          <li key={g.id}>
                            {g.status === "succeeded" && (
                              <img src={adminGenerationUrl(g.id, 480)} alt="" loading="lazy" />
                            )}
                            <button
                              type="button"
                              className="button button-small button-outline"
                              onClick={() => patchPhoto(p.id, { restore: g.id })}
                            >
                              <Undo2 size={14} /> Recuperar
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="dm-side">
          <section className="account-panel">
            <h2>Compartir</h2>
            {live ? (
              <>
                <label className="dm-link-label">
                  Para presentar a la inmobiliaria {detail.settings.banner ? "(con la franja de la demo)" : ""}
                  <input
                    className="dm-link"
                    readOnly
                    value={publicLink(demo.token, true)}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <label className="dm-link-label">
                  Para compradores (sin franja ni marcas de amoblaIA)
                  <input className="dm-link" readOnly value={publicLink(demo.token)} onFocus={(e) => e.target.select()} />
                </label>
                <div className="dm-share">
                  <ShareButtons demo={demo} />
                </div>
                <p className="dm-help">WhatsApp envía a la inmobiliaria los dos enlaces.</p>
              </>
            ) : (
              <p className="dm-help">
                Es un borrador: nadie puede verla. Publicala para obtener el enlace.
              </p>
            )}
            <LinkPreview demo={demo} location={detail.property.location} />
            <p className="dm-help">
              Así se verá el enlace en WhatsApp: la portada, mitad original y mitad en el estilo principal.
            </p>
            {live && (
              <button
                type="button"
                className="text-link dm-rotate"
                disabled={busy}
                onClick={() =>
                  window.confirm(
                    "El enlace actual dejará de funcionar y vas a tener que enviar el nuevo. ¿Continuar?",
                  ) && demoAction({ action: "token" }, "Enlace nuevo generado; el anterior ya no funciona.")
                }
              >
                <RefreshCw size={14} /> Generar un enlace nuevo
              </button>
            )}
          </section>
          <section className="account-panel">
            <h2>Al abrir la demo</h2>
            {!detail.settingsReady && <MigrationNote />}
            <div className="dm-choice dm-choice-column" role="radiogroup" aria-label="Modo de apertura">
              <label>
                <input
                  type="radio"
                  name="open-mode"
                  checked={detail.settings.openMode === "original"}
                  disabled={busy || !detail.settingsReady}
                  onChange={() => demoAction({ action: "settings", settings: { openMode: "original" } }, "Guardado.")}
                />
                Foto original (recomendado)
              </label>
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
                    )
                  }
                />
                Ambientación predeterminada
              </label>
            </div>
            {detail.settings.openMode === "styled" && (
              <label className="dm-select">
                Estilo de la primera foto
                <select
                  value={openStyles.includes(detail.settings.openStyle ?? "") ? detail.settings.openStyle! : ""}
                  disabled={busy}
                  onChange={(e) => demoAction({ action: "settings", settings: { openStyle: e.target.value } }, "Guardado.")}
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
                ? "Con ambientación, cada foto que tenga ambientaciones abre comparada: mitad original y mitad ambientada, con la barra al medio, en este estilo (o el último que eligió el comprador). Las fotos sin ambientaciones abren con la original."
                : "Para abrir con una ambientación, la primera foto visible tiene que tener al menos un estilo listo."}
            </p>
            <label className="checkbox-label dm-check">
              <input
                type="checkbox"
                checked={detail.settings.banner}
                disabled={busy || !detail.settingsReady}
                onChange={(e) => demoAction({ action: "settings", settings: { banner: e.target.checked } }, "Guardado.")}
              />
              Mostrar «Demo preparada para {demo.agencyName} · Por Amobla IA» en el enlace de presentación
            </label>
            <p className="dm-help">Estos ajustes son privados: el comprador nunca los ve.</p>
          </section>
          <section className="account-panel">
            <h2>Título de la demo</h2>
            <form
              className="dm-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void demoAction({ action: "demo", title }, "Título guardado.");
              }}
            >
              <input
                value={title}
                maxLength={160}
                placeholder={detail.property.title}
                onChange={(e) => setTitle(e.target.value)}
                aria-label="Título de la demo"
              />
              <button className="button button-small" disabled={busy}>
                Guardar
              </button>
            </form>
            <p className="dm-help">Vacío usa el título de la propiedad.</p>
          </section>
          <section className="account-panel">
            <h2>Inmobiliaria</h2>
            {!detail.settingsReady && <MigrationNote />}
            <div className="dm-logo">
              {detail.branding.logo ? (
                <img src={detail.branding.logo} alt={`Logo de ${demo.agencyName}`} />
              ) : (
                <span className="dm-logo-empty">Sin logo: se muestra el nombre</span>
              )}
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
                        await load();
                      }, "Logo guardado.");
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
                        await load();
                      }, "Logo quitado.")
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
                  await api(base, { method: "PATCH", body: JSON.stringify({ action: "agency", agency }) });
                  if (detail.settingsReady)
                    await api(base, { method: "PATCH", body: JSON.stringify({ action: "branding", branding: brand }) });
                  await load();
                }, "Inmobiliaria guardada.");
              }}
            >
              <AgencyFields value={agency} onChange={setAgency} />
              <div className="dm-fields">
                <label>
                  Color principal <small>(botones)</small>
                  <span className="dm-color">
                    <input
                      type="color"
                      value={brand.primary || "#1f3a5f"}
                      onChange={(e) => setBrand({ ...brand, primary: e.target.value })}
                      aria-label="Color principal"
                    />
                    <input
                      value={brand.primary}
                      placeholder="#1f3a5f"
                      maxLength={7}
                      onChange={(e) => setBrand({ ...brand, primary: e.target.value })}
                    />
                  </span>
                </label>
                <label>
                  Color secundario <small>(selección y etiquetas)</small>
                  <span className="dm-color">
                    <input
                      type="color"
                      value={brand.accent || "#6f8f5a"}
                      onChange={(e) => setBrand({ ...brand, accent: e.target.value })}
                      aria-label="Color secundario"
                    />
                    <input
                      value={brand.accent}
                      placeholder="#6f8f5a"
                      maxLength={7}
                      onChange={(e) => setBrand({ ...brand, accent: e.target.value })}
                    />
                  </span>
                </label>
                <label>
                  Tipografía de títulos
                  <select
                    value={brand.titleFont}
                    onChange={(e) => setBrand({ ...brand, titleFont: e.target.value as "sans" | "serif" })}
                  >
                    <option value="sans">Sin serif (moderna)</option>
                    <option value="serif">Con serif (clásica)</option>
                  </select>
                </label>
                <label>
                  Cómo la contactan los compradores
                  <select
                    value={brand.contactKind}
                    onChange={(e) => setBrand({ ...brand, contactKind: e.target.value as typeof brand.contactKind })}
                  >
                    {Object.entries(CONTACT_LABELS).map(([k, [label]]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="dm-wide">
                  {CONTACT_LABELS[brand.contactKind][0]} <small>(el mismo canal que usa en su sitio)</small>
                  <input
                    value={brand.contactValue}
                    maxLength={300}
                    placeholder={CONTACT_LABELS[brand.contactKind][1]}
                    onChange={(e) => setBrand({ ...brand, contactValue: e.target.value })}
                  />
                </label>
                <label className="dm-wide">
                  Enlace para coordinar visitas <small>(opcional: solo si existe)</small>
                  <input
                    value={brand.visitUrl}
                    maxLength={300}
                    inputMode="url"
                    placeholder="https://…"
                    onChange={(e) => setBrand({ ...brand, visitUrl: e.target.value })}
                  />
                </label>
              </div>
              <p className="dm-help">
                «Consultar a {demo.agencyName}» usa este canal. Con WhatsApp se prepara un mensaje con la
                propiedad; el comprador decide enviarlo. Sin contacto cargado, el botón no aparece.
              </p>
              <button className="button button-small" disabled={busy}>
                Guardar inmobiliaria
              </button>
            </form>
          </section>
          <section className="account-panel">
            <h2>Propiedad</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api(base, { method: "PATCH", body: JSON.stringify({ action: "property", property }) });
                  await load();
                }, "Propiedad guardada.");
              }}
            >
              <PropertyFields value={property} onChange={setProperty} />
              <button className="button button-small" disabled={busy}>
                Guardar propiedad
              </button>
            </form>
          </section>
        </aside>
      </div>

      <section className="account-panel dm-listing-panel" aria-labelledby="dm-listing-title">
        <h2 id="dm-listing-title">Ficha de la propiedad</h2>
        <p className="dm-help">
          Todo lo que el comprador ve además de las fotos. Copiá los datos de la publicación original; los campos
          vacíos no se muestran.
        </p>
        {!detail.settingsReady && <MigrationNote />}
        <ListingForm
          settings={detail.settings}
          disabled={busy || !detail.settingsReady}
          onSave={(settings) => demoAction({ action: "settings", settings }, "Ficha guardada.")}
        />
      </section>

      {reviewPhoto && reviewGen && review && (
        <Review
          photo={reviewPhoto}
          g={reviewGen}
          busy={busyAny}
          onClose={() => setReview(null)}
          onDiscard={async () => {
            await patchPhoto(reviewPhoto.id, { discard: reviewGen.id });
            setReview(null);
          }}
          onRegenerate={() => {
            setReview(null);
            void generate([{ photoId: reviewPhoto.id, style: review.style }]);
          }}
        />
      )}
    </div>
  );
}

/** Natural width/height of an image, once loaded. */
function useImageRatio(url: string | null) {
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => img.naturalHeight && setRatio(img.naturalWidth / img.naturalHeight);
    img.src = url;
  }, [url]);
  return url ? ratio : null;
}

/** One style of one photo: its version, or where it stands. */
function StyleCell({
  photo,
  style,
  queued,
  disabled,
  onOpen,
  onStage,
}: {
  photo: EditorPhoto;
  style: string;
  queued: boolean;
  disabled: boolean;
  onOpen: () => void;
  onStage: () => void;
}) {
  const shown = photo.shown[style];
  const last = photo.generations.find((g) => g.style === style && !photo.discarded.includes(g.id));
  // A version framed differently from the original cannot be compared cleanly.
  const originalRatio = useImageRatio(shown ? adminPhotoUrl(photo.id, null, 480) : null);
  const stagedRatio = useImageRatio(shown ? adminGenerationUrl(shown, 480) : null);
  const mismatch =
    originalRatio && stagedRatio ? Math.abs(stagedRatio - originalRatio) / originalRatio > 0.03 : false;
  const running = queued || (last ? liveStatus(last) : false);
  const failed = !running && !shown && last && ["failed", "needs_review"].includes(last.status);
  return (
    <li className={`dm-proposal ${shown ? "is-approved" : ""} ${failed ? `is-${last!.status}` : ""}`}>
      {shown && !running ? (
        <button type="button" onClick={onOpen} aria-label={`Revisar ${styleName(style)}`}>
          <img src={adminGenerationUrl(shown, 480)} alt="" loading="lazy" />
        </button>
      ) : (
        <div className="dm-proposal-wait">
          {running && <Loader2 size={18} className="spin" />}
          <span>{running ? (queued && !last ? "En cola" : "Ambientando…") : failed ? generationNote(last!) : "Sin ambientar"}</span>
        </div>
      )}
      {mismatch && (
        <span className="dm-cell-warn" role="note">
          Encuadre distinto al original: revisalo antes de publicar.
        </span>
      )}
      <small className="dm-cell-foot">
        <strong>{styleName(style)}</strong>
        {!running && (
          <button type="button" className="text-link" disabled={!shown && disabled} onClick={shown ? onOpen : onStage}>
            {shown ? "Revisar" : failed ? "Reintentar" : "Ambientar"}
          </button>
        )}
      </small>
    </li>
  );
}

function Review({
  photo,
  g,
  busy,
  onClose,
  onDiscard,
  onRegenerate,
}: {
  photo: EditorPhoto;
  g: GenerationRow;
  busy: boolean;
  onClose: () => void;
  onDiscard: () => Promise<void>;
  onRegenerate: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dm-modal" role="dialog" aria-modal="true" aria-labelledby="dm-review-title" onClick={onClose}>
      <div className="dm-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="dm-modal-head">
          <h2 id="dm-review-title">
            {photoLabel(photo)} · {styleName(g.style)}
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
          afterLabel={`Ambientación ${styleName(g.style)}`}
          alt="Ambientación con IA"
          initial={50}
        />
        <p className="dm-help">
          Esta versión se muestra en la demo. Comprobá que paredes, puertas, ventanas, pisos, dimensiones y
          vistas sigan iguales y que no aparezcan características que la propiedad no tiene. Si algo
          cambió, descartala (vuelve la versión anterior de este estilo, si hay) o regenerala.
        </p>
        <div className="dm-modal-actions">
          <button
            type="button"
            className="button button-outline"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onDiscard();
              setSaving(false);
            }}
          >
            <Trash2 size={16} /> Descartar
          </button>
          <button type="button" className="button button-outline" disabled={saving || busy} onClick={onRegenerate}>
            <RefreshCw size={16} /> Regenerar
          </button>
          <button type="button" className="button button-primary" onClick={onClose}>
            <Check size={16} /> Se ve bien
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
      if (dropForeign)
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
      const { ids, failed } = await syncPhotos(base, done.images, setStatus);
      const fresh = await api<DemoDetail>(base);
      const rest = fresh.photos.map((p) => p.id).filter((id) => !ids.includes(id));
      const order = [...ids.filter((id) => fresh.photos.some((p) => p.id === id)), ...rest];
      if (order.join() !== fresh.photos.map((p) => p.id).join())
        await api(base, { method: "PATCH", body: JSON.stringify({ action: "order", ids: order }) });
      const added = ids.length - detail.photos.filter((p) => ids.includes(p.id)).length;
      onDone(
        await api<DemoDetail>(base),
        [
          `${done.fields.length} datos completados desde la publicación`,
          `${added} fotos agregadas, ${ids.length - added} ya estaban`,
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
      <p className="dm-help">
        Fotos: la publicación tiene {imported.images.length} de esta propiedad. Las que ya están en la demo conservan
        sus ambientaciones; las que faltan se agregan y quedan en el orden de la publicación.
      </p>
      {foreign.length > 0 && (
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

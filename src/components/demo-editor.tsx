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
import { rooms, styles } from "@/lib/catalog";
import {
  adminGenerationUrl,
  adminPhotoUrl,
  generationNote,
  modeName,
  photoLabel,
  roomName,
  styleName,
  type DemoDetail,
  type EditorPhoto,
  type GenerationRow,
} from "@/lib/demos/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isLive = (p: EditorPhoto) =>
  p.generations.some((g) => g.status === "queued" || g.status === "running");
type Upload = { name: string; state: "waiting" | "uploading" | "done" | "error"; error?: string };

export function DemoEditor({ id }: { id: string }) {
  const [detail, setDetail] = useState<DemoDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchStyle, setBatchStyle] = useState("modern");
  const [queue, setQueue] = useState<string[]>([]);
  const [review, setReview] = useState<{ photoId: string; generationId: string } | null>(null);
  const [title, setTitle] = useState("");
  const [agency, setAgency] = useState({ name: "", website: "", contact_name: "", notes: "" });
  const [property, setProperty] = useState({ title: "", listing_url: "", location: "", description: "" });
  const base = `/api/admin/demos/${id}`;
  const queueRef = useRef<string | null>(null);

  const apply = useCallback((d: DemoDetail) => {
    setDetail(d);
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
          staged: photos.filter((p) => p.approvedGenerationId).length,
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
    () => (detail?.photos || []).filter(isLive).map((p) => p.id),
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

  /** One proposal at a time: the account admits one live generation, like the studio. */
  async function generate(photoIds: string[], style?: string) {
    setQueue(photoIds);
    setError("");
    setNotice("");
    let failures = 0;
    for (const photoId of photoIds) {
      queueRef.current = photoId;
      const photo = detail?.photos.find((p) => p.id === photoId);
      if (!photo) continue;
      try {
        await api(`${base}/photos/${photoId}`, {
          method: "POST",
          body: JSON.stringify({
            key: crypto.randomUUID(),
            room: photo.room,
            mode: photo.mode,
            style: style ?? photo.style,
          }),
        });
        let current = await poll(photoId);
        while (current && isLive(current)) {
          await sleep(4000);
          current = await poll(photoId);
        }
        if (current?.generations[0]?.status !== "succeeded") failures++;
      } catch (e) {
        failures++;
        setError(e instanceof Error ? e.message : "No pudimos ambientar la foto.");
        // Quota, capacity or configuration problems would repeat: stop the batch.
        break;
      } finally {
        setQueue((q) => q.filter((x) => x !== photoId));
      }
    }
    queueRef.current = null;
    setQueue([]);
    setSelected(new Set());
    if (!failures)
      setNotice("Propuestas listas. Revisalas y aprobá la que se mostrará en la demo.");
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
  const reviewPhoto = review && photos.find((p) => p.id === review.photoId);
  const reviewGen = reviewPhoto?.generations.find((g) => g.id === review?.generationId);

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

      <div className="dm-editor">
        <section className="account-panel dm-photos" aria-labelledby="dm-photos-title">
          <h2 id="dm-photos-title">Fotos de la propiedad</h2>
          <p className="dm-help">
            Las originales se conservan sin cambios. Ambientá las que quieras: la IA mantiene encuadre,
            paredes, aberturas y pisos, pero revisá cada propuesta antes de aprobarla.
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
                Seleccionar todas
              </label>
              <label>
                Estilo
                <select
                  value={batchStyle}
                  disabled={generating}
                  onChange={(e) => setBatchStyle(e.target.value)}
                >
                  {styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button button-small button-primary"
                disabled={!selected.size || generating || livePhotos.length > 0}
                onClick={() =>
                  void generate(
                    photos.filter((p) => selected.has(p.id)).map((p) => p.id),
                    batchStyle,
                  )
                }
              >
                <Sparkles size={15} />
                {generating
                  ? `Ambientando… quedan ${queue.length}`
                  : `Ambientar seleccionadas (${selected.size})`}
              </button>
            </div>
          )}

          {!photos.length && <p className="dm-empty-photos">Todavía no cargaste fotos.</p>}
          <ol className="dm-photo-list">
            {photos.map((p, i) => {
              const visible = p.generations.filter((g) => !p.discarded.includes(g.id));
              const discarded = p.generations.filter((g) => p.discarded.includes(g.id));
              const busyPhoto = isLive(p) || queue.includes(p.id);
              const cover = demo.cover?.id === p.id;
              return (
                <li key={p.id} className={`dm-photo ${p.visible ? "" : "is-hidden"}`}>
                  <div className="dm-photo-head">
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${photoLabel(p)}`}
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
                        src={
                          p.approvedGenerationId
                            ? adminGenerationUrl(p.approvedGenerationId, 480)
                            : adminPhotoUrl(p.id, "original", 480)
                        }
                        alt={photoLabel(p)}
                        loading="lazy"
                      />
                      <div className="dm-badges">
                        {cover && <span>Portada</span>}
                        {p.approvedGenerationId && <span className="is-ai">IA aprobada</span>}
                        {!p.visible && <span className="is-muted">Oculta</span>}
                      </div>
                    </div>
                    <div className="dm-photo-fields">
                      <label>
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
                      <label>
                        Estilo
                        <select
                          value={p.style}
                          disabled={busyPhoto}
                          onChange={(e) => patchPhoto(p.id, { changes: { style: e.target.value } })}
                        >
                          {styles.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="dm-photo-actions">
                    <button
                      type="button"
                      className="button button-small button-primary"
                      disabled={busyPhoto || generating || livePhotos.length > 0}
                      onClick={() => void generate([p.id])}
                    >
                      {busyPhoto ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                      {busyPhoto
                        ? "Ambientando…"
                        : p.generations.length
                          ? "Regenerar con IA"
                          : "Ambientar con IA"}
                    </button>
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
                  {visible.length > 0 && (
                    <div className="dm-proposals">
                      <span className="dm-proposals-title">Propuestas</span>
                      <ul>
                        {visible.map((g) => (
                          <Proposal
                            key={g.id}
                            g={g}
                            approved={p.approvedGenerationId === g.id}
                            onOpen={() => setReview({ photoId: p.id, generationId: g.id })}
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
                <input
                  className="dm-link"
                  readOnly
                  value={publicLink(demo.token)}
                  onFocus={(e) => e.target.select()}
                  aria-label="Enlace público"
                />
                <div className="dm-share">
                  <ShareButtons demo={demo} />
                </div>
              </>
            ) : (
              <p className="dm-help">
                Es un borrador: nadie puede verla. Publicala para obtener el enlace.
              </p>
            )}
            <LinkPreview demo={demo} location={detail.property.location} />
            <p className="dm-help">Así se verá el enlace en WhatsApp. La imagen es la portada.</p>
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
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void demoAction({ action: "agency", agency }, "Inmobiliaria guardada.");
              }}
            >
              <AgencyFields value={agency} onChange={setAgency} />
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
                void demoAction({ action: "property", property }, "Propiedad guardada.");
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

      {reviewPhoto && reviewGen && (
        <Review
          photo={reviewPhoto}
          g={reviewGen}
          approved={reviewPhoto.approvedGenerationId === reviewGen.id}
          onClose={() => setReview(null)}
          onApprove={async () => {
            await patchPhoto(reviewPhoto.id, {
              approve: reviewPhoto.approvedGenerationId === reviewGen.id ? null : reviewGen.id,
            });
            setReview(null);
          }}
          onDiscard={async () => {
            await patchPhoto(reviewPhoto.id, { discard: reviewGen.id });
            setReview(null);
          }}
        />
      )}
    </div>
  );
}

function Proposal({
  g,
  approved,
  onOpen,
}: {
  g: GenerationRow;
  approved: boolean;
  onOpen: () => void;
}) {
  const ready = g.status === "succeeded";
  return (
    <li className={`dm-proposal ${approved ? "is-approved" : ""} is-${g.status}`}>
      {ready ? (
        <button type="button" onClick={onOpen} aria-label={`Revisar propuesta ${styleName(g.style)}`}>
          <img src={adminGenerationUrl(g.id, 480)} alt="" loading="lazy" />
          {approved && (
            <span className="dm-approved">
              <Check size={13} /> En la demo
            </span>
          )}
        </button>
      ) : (
        <div className="dm-proposal-wait">
          {["queued", "running"].includes(g.status) && <Loader2 size={18} className="spin" />}
          <span>{generationNote(g)}</span>
        </div>
      )}
      <small>
        {styleName(g.style)} · {modeName(g.mode)}
      </small>
    </li>
  );
}

function Review({
  photo,
  g,
  approved,
  onClose,
  onApprove,
  onDiscard,
}: {
  photo: EditorPhoto;
  g: GenerationRow;
  approved: boolean;
  onClose: () => void;
  onApprove: () => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const act = (fn: () => Promise<void>) => async () => {
    setSaving(true);
    await fn();
    setSaving(false);
  };
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
          before={adminPhotoUrl(photo.id, "original", 1600)}
          after={adminGenerationUrl(g.id, 1600)}
          beforeLabel="Foto original"
          beforeAlt="Foto original"
          afterLabel="Propuesta con IA"
          alt="Propuesta de ambientación con IA"
          initial={50}
        />
        <p className="dm-help">
          Antes de aprobar, comprobá que paredes, puertas, ventanas, pisos, dimensiones y vistas sigan
          iguales y que no aparezcan características que la propiedad no tiene. Si algo cambió,
          descartala.
        </p>
        <div className="dm-modal-actions">
          <button type="button" className="button button-outline" disabled={saving} onClick={act(onDiscard)}>
            <Trash2 size={16} /> Descartar
          </button>
          <button type="button" className="button button-primary" disabled={saving} onClick={act(onApprove)}>
            <Check size={16} /> {approved ? "Quitar de la demo" : "Aprobar para la demo"}
          </button>
        </div>
      </div>
    </div>
  );
}

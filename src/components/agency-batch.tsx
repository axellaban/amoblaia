"use client";
// La bandeja de fotos importadas: varias propiedades o grupos a la vez.
// Choose photos, give each its room (never guessed), pick one action and
// style, see the server's cost for the whole batch, then create the versions
// one at a time with the same routes, keys and limits the editor uses. The
// queue of versions not sent yet lives in this tab, and the page says so.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { ApiError, api } from "./admin-demos";
import { track } from "@/lib/analytics";
import { modes, rooms } from "@/lib/catalog";
import { isLive } from "@/lib/demos/editor-logic";
import { adminGenerationUrl, adminPhotoUrl, type DemoDetail, type EditorPhoto } from "@/lib/demos/shared";
import { DEMO_STYLES, demoStyleName } from "@/lib/demos/styles";
import type { PanelProperty } from "@/lib/agency/shared";
import {
  combineQuotes,
  finished,
  knownRoom,
  planBatch,
  retryable,
  runSummary,
  type BatchGroup,
  type BatchMode,
  type BatchTask,
  type Quote,
  type RunState,
} from "@/lib/agency/batch-plan";

const STORE = "habita:lote:v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Answers that would repeat for the next versions too: the rest is not sent (the editor's same rule). */
const STOPS = new Set([401, 402, 403, 409, 429, 503]);
const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? "Sin asignar";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const lotePath = (groupId: string) => `/panel/imagenes/lote?grupo=${groupId}`;
const editorPath = (groupId: string) => `/panel/propiedades/${groupId}?volver=${encodeURIComponent(lotePath(groupId))}`;

type Saved = { active?: string; picks?: Record<string, string[]>; rooms?: Record<string, string | null>; style?: string; mode?: BatchMode; scroll?: number };
type RunItem = BatchTask & { state: RunState; error?: string; generationId?: string };
type Total = ReturnType<typeof combineQuotes>;

function readSaved(): Saved {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? "{}") as Saved;
  } catch {
    return {};
  }
}
function writeSaved(s: Saved) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // Without storage the batch still works; it is just not kept across pages.
  }
}

export function PhotoBatch({ initialGroup }: { initialGroup?: string }) {
  const [groups, setGroups] = useState<BatchGroup[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [active, setActive] = useState("");
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [roomOf, setRoomOf] = useState<Record<string, string | null>>({});
  const [style, setStyle] = useState("modern");
  const [mode, setMode] = useState<BatchMode>("furnish");
  const [step, setStep] = useState<"preparar" | "confirmar" | "generar">("preparar");
  const [total, setTotal] = useState<Total | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<RunItem[]>([]);
  const [running, setRunning] = useState(false);
  const [adding, setAdding] = useState("");
  const runRef = useRef<RunItem[]>([]);
  const busy = useRef(false);
  // The request key of each version: kept when the answer never arrived, so a retry is the same request.
  const keys = useRef(new Map<string, string>());
  const restored = useRef(false);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const list = await api<{ items: PanelProperty[] }>("/api/panel/imagenes");
      const details = await Promise.all(list.items.map((g) => api<DemoDetail>(`/api/admin/demos/${g.id}`)));
      const next: BatchGroup[] = details.map((d) => ({
        id: d.demo.id,
        title: d.property.title,
        propertyType: d.settings.propertyType,
        blocked: d.staging?.blocked ?? null,
        photos: d.photos,
      }));
      setGroups(next);
      if (!restored.current) {
        restored.current = true;
        const saved = readSaved();
        const ids = new Set(next.map((g) => g.id));
        const photoIds = new Set(next.flatMap((g) => g.photos.map((p) => p.id)));
        setActive(initialGroup && ids.has(initialGroup) ? initialGroup : saved.active && ids.has(saved.active) ? saved.active : (next[0]?.id ?? ""));
        setPicks(Object.fromEntries(Object.entries(saved.picks ?? {}).filter(([g]) => ids.has(g)).map(([g, ps]) => [g, ps.filter((p) => photoIds.has(p))])));
        const rooms: Record<string, string | null> = {};
        for (const p of next.flatMap((g) => g.photos)) rooms[p.id] = saved.rooms && p.id in saved.rooms ? saved.rooms[p.id] : knownRoom(p);
        setRoomOf(rooms);
        if (saved.style) setStyle(saved.style);
        if (saved.mode) setMode(saved.mode);
        if (saved.scroll) requestAnimationFrame(() => window.scrollTo({ top: saved.scroll }));
      }
    } catch (e) {
      setLoadError(message(e, "No pudimos cargar tus fotos importadas."));
    }
  }, [initialGroup]);
  useEffect(() => {
    void load();
  }, [load]);

  // The batch is kept in this tab while moving to the editor and back; it is not kept once the tab closes.
  useEffect(() => {
    if (restored.current) writeSaved({ active, picks, rooms: roomOf, style, mode, scroll: readSaved().scroll });
  }, [active, picks, roomOf, style, mode]);
  const rememberScroll = () => writeSaved({ ...readSaved(), scroll: window.scrollY });

  // Leaving while versions are still to be sent: the browser asks first.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const plan = useMemo(() => (groups ? planBatch(groups, picks, roomOf, { style, mode }) : null), [groups, picks, roomOf, style, mode]);
  const group = groups?.find((g) => g.id === active) ?? null;
  const chosen = (g: string) => new Set(picks[g] ?? []);
  const selected = (groups ?? []).flatMap((g) => g.photos.filter((p) => chosen(g.id).has(p.id)).map((p) => ({ group: g, photo: p })));
  const types = new Set((groups ?? []).filter((g) => (picks[g.id] ?? []).length).map((g) => g.propertyType));
  const styleOptions = (types.size ? [...types] : (["residential"] as const)).flatMap((t) => DEMO_STYLES[t]);

  const toggle = (groupId: string, photoId: string, on: boolean) =>
    setPicks((all) => {
      const next = new Set(all[groupId] ?? []);
      if (on) next.add(photoId);
      else next.delete(photoId);
      return { ...all, [groupId]: [...next] };
    });

  const updatePhoto = (demoId: string, photo: EditorPhoto | null, photoId: string) =>
    setGroups((all) =>
      all
        ? all.map((g) =>
            g.id !== demoId ? g : { ...g, photos: photo ? g.photos.map((p) => (p.id === photo.id ? photo : p)) : g.photos.filter((p) => p.id !== photoId) },
          )
        : all,
    );

  /** More photos for an existing group: one file per request; the ones that failed are said, the rest kept. */
  async function addPhotos(groupId: string, files: FileList) {
    setError("");
    const list = Array.from(files);
    let failed = 0;
    for (const [i, file] of list.entries()) {
      setAdding(`Sumando foto ${i + 1} de ${list.length}…`);
      const form = new FormData();
      form.append("image", file);
      try {
        await api(`/api/admin/demos/${groupId}/photos`, { method: "POST", body: form });
      } catch {
        failed++;
      }
    }
    try {
      const d = await api<DemoDetail>(`/api/admin/demos/${groupId}`);
      setGroups((all) => (all ? all.map((g) => (g.id === groupId ? { ...g, photos: d.photos } : g)) : all));
      setRoomOf((all) => ({ ...Object.fromEntries(d.photos.map((p) => [p.id, knownRoom(p)])), ...all }));
    } catch {
      // The photos were saved; they show up when the page is loaded again.
    }
    setAdding("");
    if (failed) setError(`${plural(failed, "foto no se pudo sumar", "fotos no se pudieron sumar")}: tienen que ser JPG, PNG o WebP de hasta 3 MB.`);
  }

  /** The server's cost for each group, combined against the one balance that pays them all. */
  async function review() {
    if (!plan?.tasks.length) return;
    setError("");
    setQuoting(true);
    try {
      const byGroup = [...new Set(plan.tasks.map((t) => t.demoId))];
      const quotes = await Promise.all(
        byGroup.map(async (demoId) => ({
          title: groups?.find((g) => g.id === demoId)?.title ?? "Grupo",
          quote: await api<Quote>(`/api/admin/demos/${demoId}/costo`, {
            method: "POST",
            body: JSON.stringify({ photoIds: plan.tasks.filter((t) => t.demoId === demoId).map((t) => t.photoId) }),
          }),
        })),
      );
      setTotal(combineQuotes(quotes));
      setStep("confirmar");
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(message(e, "No pudimos calcular el costo. Probá de nuevo."));
    } finally {
      setQuoting(false);
    }
  }

  const setItem = (i: number, change: Partial<RunItem>) => {
    runRef.current = runRef.current.map((x, j) => (j === i ? { ...x, ...change } : x));
    setRun(runRef.current);
  };

  /** Sends the given versions one at a time and follows each until it finishes. Uncertain ones are never resent by themselves. */
  async function send(indices: number[]) {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    let stopped: string | null = null;
    let done = 0;
    let failed = 0;
    for (const i of indices) {
      const t = runRef.current[i];
      if (stopped) {
        setItem(i, { state: "unsent", error: stopped });
        continue;
      }
      const k = `${t.photoId}:${t.style}`;
      const key = keys.current.get(k) ?? crypto.randomUUID();
      keys.current.set(k, key);
      setItem(i, { state: "sending", error: undefined });
      try {
        await api(`/api/admin/demos/${t.demoId}/photos/${t.photoId}`, {
          method: "POST",
          body: JSON.stringify({ key, room: t.room, mode: t.mode, style: t.style }),
        });
      } catch (e) {
        failed++;
        if (e instanceof ApiError) {
          // The server answered: that attempt is over, and a retry is a new one.
          keys.current.delete(k);
          setItem(i, { state: "failed", error: e.message });
          if (STOPS.has(e.status)) stopped = `No se envió: ${e.message}`;
        } else {
          setItem(i, { state: "uncertain", error: "No recibimos respuesta: puede que se haya enviado. Reintentar la confirma sin duplicarla." });
          stopped = "No se envió para no duplicar trabajo mientras hay una versión sin confirmar.";
        }
        continue;
      }
      setItem(i, { state: "generating" });
      try {
        let latest: EditorPhoto | null = null;
        do {
          if (latest) await sleep(4000);
          latest = (await api<{ photo: EditorPhoto | null }>(`/api/admin/demos/${t.demoId}/photos/${t.photoId}`)).photo;
          updatePhoto(t.demoId, latest, t.photoId);
        } while (latest && isLive(latest, t.style));
        keys.current.delete(k);
        const outcome = finished(latest, t.style);
        const newest = latest?.generations.find((g) => g.style === t.style);
        setItem(i, { state: outcome, generationId: outcome === "ready" ? newest?.id : undefined, error: outcome === "failed" ? "El resto se conserva." : undefined });
        if (outcome === "ready") done++;
        else failed++;
      } catch {
        failed++;
        setItem(i, { state: "lost", error: "Se envió, pero no pudimos seguir su avance. Revisala en el editor." });
      }
    }
    busy.current = false;
    setRunning(false);
    track("property_ai_generation_completed", { versions: done + failed, failed, status: failed ? "partial" : "ok", mode: "batch" });
  }

  function generate() {
    if (!plan?.tasks.length || !total || total.blocked) return;
    runRef.current = plan.tasks.map((t) => ({ ...t, state: "waiting" as RunState }));
    setRun(runRef.current);
    setStep("generar");
    window.scrollTo({ top: 0 });
    track("property_ai_generation_started", { photos: plan.tasks.length, versions: plan.tasks.length, credits: total.newPhotos, mode: "batch" });
    void send(runRef.current.map((_, i) => i));
  }

  if (loadError)
    return (
      <div className="inline-error ap-retry-row" role="alert">
        <span>{loadError}</span>
        <button type="button" className="button button-small button-outline" onClick={() => void load()}>
          Reintentar
        </button>
      </div>
    );
  if (!groups || !plan) return <p role="status">Cargando tus fotos importadas…</p>;
  if (!groups.length)
    return (
      <div className="ap-entry">
        <h2>Todavía no importaste fotos</h2>
        <p className="ap-entry-sub">Traé fotos desde un enlace o desde tu dispositivo para ambientarlas.</p>
        <Link href="/panel/imagenes" className="button button-primary">
          Importar imágenes
        </Link>
      </div>
    );

  const photoCount = groups.reduce((n, g) => n + g.photos.length, 0);
  const summary = runSummary(run.map((r) => r.state));
  const titleOf = (demoId: string) => groups.find((g) => g.id === demoId)?.title ?? "Grupo";
  const firstReady = run.find((r) => r.state === "ready");

  return (
    <div className="ap-lote">
      <div className="ap-lote-head">
        <div>
          <h1>Fotos importadas</h1>
          <p className="dm-help">
            {plural(photoCount, "foto", "fotos")} · {plural(groups.length, "propiedad o grupo", "propiedades o grupos")}
          </p>
        </div>
        <Link href="/panel/imagenes" className="button button-outline">
          Importar más
        </Link>
      </div>
      <ol className="ap-img-steps" aria-label="Pasos">
        <li className="is-done">1 · Importar</li>
        <li className={step === "preparar" ? "is-on" : "is-done"} aria-current={step === "preparar" ? "step" : undefined}>
          2 · Preparar
        </li>
        <li className={step !== "preparar" ? "is-on" : ""} aria-current={step !== "preparar" ? "step" : undefined}>
          3 · Revisar
        </li>
      </ol>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      {step === "preparar" && (
        <div className="ap-lote-grid">
          <nav className="ap-lote-groups" aria-label="Propiedades y grupos">
            <h2>Propiedades</h2>
            <label className="ap-lote-select">
              <span>Propiedad o grupo</span>
              <select value={active} onChange={(e) => setActive(e.target.value)}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title} ({(picks[g.id] ?? []).length} de {g.photos.length})
                  </option>
                ))}
              </select>
            </label>
            <ul>
              {groups.map((g) => (
                <li key={g.id}>
                  <button type="button" className={g.id === active ? "is-on" : ""} aria-current={g.id === active ? "true" : undefined} onClick={() => setActive(g.id)}>
                    <span>{g.title}</span>
                    <small>
                      {(picks[g.id] ?? []).length ? `${(picks[g.id] ?? []).length} de ` : ""}
                      {g.photos.length}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section className="ap-lote-photos" aria-labelledby="ap-lote-photos-title">
            <div className="ap-img-group-head">
              <h2 id="ap-lote-photos-title">Elegí las fotos que querés ambientar</h2>
              {group && (
                <span className="ap-img-row">
                  <label className="button button-small button-outline ap-lote-add">
                    {adding || "+ Sumar fotos"}
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      disabled={Boolean(adding)}
                      onChange={(e) => {
                        if (e.target.files?.length) void addPhotos(group.id, e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button type="button" className="text-link" onClick={() => setPicks((all) => ({ ...all, [group.id]: group.photos.map((p) => p.id) }))}>
                    Elegir todas
                  </button>{" "}
                  |{" "}
                  <button type="button" className="text-link" onClick={() => setPicks((all) => ({ ...all, [group.id]: [] }))}>
                    Ninguna
                  </button>
                </span>
              )}
            </div>
            {group && !group.photos.length && <p className="ap-empty">Este grupo no tiene fotos todavía.</p>}
            <ul className="ap-lote-cards">
              {group?.photos.map((p, i) => {
                const on = chosen(group.id).has(p.id);
                const ready = Object.keys(p.shown).length;
                const room = roomOf[p.id] ?? null;
                return (
                  <li key={p.id} className={on ? "is-on" : ""}>
                    <label className="ap-lote-pick">
                      <input type="checkbox" checked={on} onChange={(e) => toggle(group.id, p.id, e.target.checked)} />
                      <img src={adminPhotoUrl(p.id, null, 480)} alt={`Foto ${i + 1} de ${group.title}`} loading="lazy" />
                      <span className="ap-img-sr-text">{on ? "Elegida para ambientar" : "Elegir para ambientar"}</span>
                    </label>
                    <label className="ap-lote-room">
                      <span>Ambiente</span>
                      <select
                        value={room ?? ""}
                        aria-invalid={on && !room ? true : undefined}
                        onChange={(e) => setRoomOf((all) => ({ ...all, [p.id]: e.target.value || null }))}
                      >
                        <option value="">Sin asignar</option>
                        {rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {on && !room && <small className="ap-lote-ask">Elegí el ambiente para ambientarla.</small>}
                    <small className="ap-lote-meta">
                      {isLive(p) ? "Creando una versión…" : ready ? plural(ready, "versión lista", "versiones listas") : "Sin versiones"}
                      {!p.visible && " · oculta en la ficha"}
                    </small>
                    <Link href={editorPath(group.id)} className="text-link ap-lote-adjust" onClick={rememberScroll}>
                      Ajustar en el editor
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <aside className="ap-lote-apply" id="ap-lote-apply" aria-labelledby="ap-lote-apply-title">
            <h2 id="ap-lote-apply-title">Aplicar a las elegidas</h2>
            <label>
              <span>Acción</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as BatchMode)}>
                {modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Estilo</span>
              <select value={style} onChange={(e) => setStyle(e.target.value)}>
                {styleOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="ap-lote-chosen" role="status">
              <strong>
                {plural(selected.length, "foto seleccionada", "fotos seleccionadas")}
                {selected.length ? ` de ${plural(new Set(selected.map((s) => s.group.id)).size, "propiedad", "propiedades")}` : ""}
              </strong>
              {selected.length > 0 && (
                <ul>
                  {selected.slice(0, 8).map(({ group: g, photo: p }) => (
                    <li key={p.id}>
                      <img src={adminPhotoUrl(p.id, null, 160)} alt="" />
                      <button type="button" aria-label={`Quitar de la tanda una foto de ${g.title}`} onClick={() => toggle(g.id, p.id, false)}>
                        <X size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                  {selected.length > 8 && <li className="ap-lote-more">+{selected.length - 8}</li>}
                </ul>
              )}
            </div>
            {plan.missingRoom.length > 0 && (
              <p className="ap-img-warn">
                Falta el ambiente de {plural(plan.missingRoom.length, "foto", "fotos")}. Asignalo o quitala de la tanda.
              </p>
            )}
            {[...plan.incompatible, ...plan.blocked].map((x) => (
              <p key={x.demoId} className="ap-img-warn">
                <strong>{x.title}:</strong> {x.reason} Esas fotos quedan afuera.
              </p>
            ))}
            {plan.skipped.exists + plan.skipped.running + plan.skipped.uncertain > 0 && (
              <p className="dm-help">
                {[
                  plan.skipped.exists && `${plural(plan.skipped.exists, "ya tiene", "ya tienen")} ese estilo`,
                  plan.skipped.running && `${plural(plan.skipped.running, "se está creando", "se están creando")}`,
                  plan.skipped.uncertain && `${plural(plan.skipped.uncertain, "está", "están")} en revisión técnica`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                : no se vuelven a crear.
              </p>
            )}
            <p className="dm-help">Elegir para ambientar no cambia qué fotos muestra la ficha, ni su portada, ni la versión elegida.</p>
            <button
              type="button"
              className="button button-primary"
              disabled={!plan.tasks.length || plan.missingRoom.length > 0 || quoting}
              onClick={() => void review()}
            >
              {quoting ? "Calculando el costo…" : "Revisar y generar →"}
            </button>
          </aside>
          <div className="ap-lote-mobilebar">
            <p>
              <strong>{plural(selected.length, "foto", "fotos")}</strong>
              {plan.missingRoom.length > 0 && ` · faltan ${plan.missingRoom.length} ambientes`}
            </p>
            <span className="ap-img-row">
              <a href="#ap-lote-apply" className="button button-small button-outline">
                Acción y estilo
              </a>
              <button
                type="button"
                className="button button-small button-primary"
                disabled={!plan.tasks.length || plan.missingRoom.length > 0 || quoting}
                onClick={() => void review()}
              >
                Revisar y generar
              </button>
            </span>
          </div>
        </div>
      )}

      {step === "confirmar" && total && (
        <section className="ap-lote-confirm" aria-labelledby="ap-lote-confirm-title">
          <button type="button" className="text-link" onClick={() => setStep("preparar")}>
            ← Volver a las fotos
          </button>
          <h2 id="ap-lote-confirm-title">Revisar generación</h2>
          <p className="dm-help">Verificá el alcance antes de generar las versiones.</p>
          <div className="ap-lote-thumbs">
            {plan.tasks.slice(0, 6).map((t) => (
              <img key={t.photoId} src={adminPhotoUrl(t.photoId, null, 240)} alt="" />
            ))}
            <p>
              <strong>
                {plural(plan.tasks.length, "foto", "fotos")} · 1 estilo · {plural(plan.tasks.length, "versión", "versiones")}
              </strong>
              <small>{plural(plan.groups, "propiedad o grupo", "propiedades o grupos")}</small>
            </p>
          </div>
          <dl className="ap-lote-facts">
            <div>
              <dt>Acción</dt>
              <dd>{modes.find((m) => m.id === mode)?.name}</dd>
            </div>
            <div>
              <dt>Estilo</dt>
              <dd>{demoStyleName(style)}</dd>
            </div>
            <div>
              <dt>Paga</dt>
              <dd>{total.payer === "agency" ? "Saldo de tu inmobiliaria" : "El equipo de habita (no usa créditos de la inmobiliaria)"}</dd>
            </div>
          </dl>
          {total.payer === "agency" && (
            <div className="ap-lote-cost">
              <strong>
                {total.newPhotos
                  ? `Se ${total.newPhotos === 1 ? "usará" : "usarán"} ${plural(total.newPhotos, "crédito", "créditos")}`
                  : "No usa créditos: esas fotos ya están pagas y su cobertura sigue vigente"}
              </strong>
              {total.credits !== null && (
                <small>
                  Saldo disponible: {total.credits}
                  {total.after !== null && total.after >= 0 ? ` · Saldo después: ${total.after}` : ""}
                </small>
              )}
            </div>
          )}
          {(plan.incompatible.length > 0 || plan.blocked.length > 0 || plan.skipped.exists + plan.skipped.running + plan.skipped.uncertain > 0) && (
            <p className="dm-help">
              No se incluyen:{" "}
              {[
                ...plan.incompatible.map((x) => `${x.title} (estilo no disponible)`),
                ...plan.blocked.map((x) => `${x.title} (no se puede generar desde esta cuenta)`),
                plan.skipped.exists ? plural(plan.skipped.exists, "foto que ya tiene ese estilo", "fotos que ya tienen ese estilo") : "",
                plan.skipped.running ? plural(plan.skipped.running, "foto en curso", "fotos en curso") : "",
                plan.skipped.uncertain ? plural(plan.skipped.uncertain, "foto en revisión técnica", "fotos en revisión técnica") : "",
              ]
                .filter(Boolean)
                .join(", ")}
              .
            </p>
          )}
          {total.blocked && (
            <div className="inline-error" role="alert">
              <p>
                <strong>No se puede generar:</strong> {total.blocked}
              </p>
              <p>
                Podés seguir organizando las fotos o descargar las versiones que ya están listas desde el editor.{" "}
                {total.payer === "agency" && <Link href="/panel/creditos">Ver créditos</Link>}
              </p>
            </div>
          )}
          <ul className="ap-lote-notes">
            <li>Los originales se conservan. No se publica ninguna ficha.</li>
            <li>Mantené esta pestaña abierta hasta que se envíen todas: las que todavía no se enviaron no siguen si la cerrás.</li>
          </ul>
          <div className="ap-img-row">
            <button type="button" className="button button-outline" onClick={() => setStep("preparar")}>
              Volver a ajustar
            </button>
            <button type="button" className="button button-primary" disabled={Boolean(total.blocked)} onClick={generate}>
              Generar {plural(plan.tasks.length, "versión", "versiones")}
            </button>
          </div>
        </section>
      )}

      {step === "generar" && (
        <section className="ap-lote-run" aria-labelledby="ap-lote-run-title">
          <h2 id="ap-lote-run-title">{summary.finished ? "Tus versiones" : "Creando tus versiones"}</h2>
          <p className="dm-help" role="status" aria-live="polite">
            {plural(summary.ready, "lista", "listas")} · {summary.attention} {summary.attention === 1 ? "requiere" : "requieren"} atención
            {summary.pending ? ` · ${summary.pending} en curso` : ""}
          </p>
          <ul className="ap-img-list">
            {run.map((r, i) => (
              <li key={`${r.photoId}:${r.style}`} className={`is-${r.state === "ready" ? "done" : retryable(r.state) || r.state === "review" || r.state === "lost" ? "error" : "working"}`}>
                <span className="ap-img-thumb" aria-hidden="true">
                  <img src={adminPhotoUrl(r.photoId, null, 160)} alt="" />
                </span>
                {r.generationId && (
                  <span className="ap-img-thumb" aria-hidden="true">
                    <img src={adminGenerationUrl(r.generationId, 160)} alt="" />
                  </span>
                )}
                <span className="ap-img-info">
                  <strong>
                    {titleOf(r.demoId)} · {roomName(r.room)}
                  </strong>
                  <small>1 versión · {demoStyleName(r.style)}</small>
                  <span className="ap-img-state">
                    {
                      {
                        waiting: "En espera",
                        sending: "Enviando…",
                        generating: "Generando…",
                        ready: "Lista para revisar",
                        failed: "No se pudo generar",
                        review: "En revisión técnica",
                        uncertain: "Sin respuesta",
                        lost: "Enviada: seguila en el editor",
                        unsent: "Sin enviar",
                      }[r.state]
                    }
                    {r.error ? `. ${r.error}` : ""}
                  </span>
                </span>
                <span className="ap-img-actions">
                  {retryable(r.state) && (
                    <button type="button" className="button button-small button-outline" disabled={running} onClick={() => void send([i])}>
                      Reintentar
                    </button>
                  )}
                  {(r.state === "ready" || r.state === "review" || r.state === "lost") && (
                    <Link href={editorPath(r.demoId)} className="button button-small" onClick={rememberScroll}>
                      Revisar
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="dm-help">
            {summary.allReady
              ? "Todas las versiones están listas. Ver una versión no publica nada."
              : summary.finished
                ? "Los resultados listos siguen disponibles. Podés reintentar los que fallaron."
                : "Las versiones se crean de a una. Mantené esta pestaña abierta hasta que se envíen todas."}
          </p>
          <div className="ap-img-row">
            <button type="button" className="button button-outline" disabled={running} onClick={() => setStep("preparar")}>
              Volver al lote
            </button>
            {firstReady && (
              <Link href={editorPath(firstReady.demoId)} className="button button-primary" onClick={rememberScroll}>
                Revisar resultado listo →
              </Link>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

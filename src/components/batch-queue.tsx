"use client";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  ImagePlus,
  Info,
  LoaderCircle,
  RotateCcw,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import { rooms, type ModeId, type RoomId, type StyleId } from "@/lib/catalog";
import { downloadDesign, optimizePhoto, thumbnail } from "@/lib/images";
import { disclosureFor, labelRequired } from "@/lib/disclosure";
import { waitForJob } from "@/lib/jobs-client";
import { trackPhotoUploaded } from "@/lib/ads";
import { metaTrack } from "@/lib/meta";
/** Photos per batch: a whole listing, while the previews stay light in memory. */
export const MAX_BATCH = 20;
export type BatchItem = {
  id: string;
  /** Request key: retries of the same send replay the same job. */
  key: string;
  file: File;
  preview: string;
  name: string;
  room: RoomId;
  /** 'later': still rendering after the wait; it ends up in the projects. */
  status: "waiting" | "sending" | "running" | "done" | "failed" | "later";
  message?: string;
  result?: string;
  jobId?: string;
  projectId?: string;
};
type Settings = { style: StyleId; mode: ModeId; notes: string };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Answers that would refuse every other photo too: no photos left, an
// expired plan, a signed-out or blocked account, the daily cap, a full
// account. Only a photo sitting in the trash is that photo's own problem.
const stops = (status: number, message: string) =>
  [401, 402, 403, 429, 503].includes(status) ||
  (status === 409 && !/papelera/.test(message));
/**
 * Paid accounts can drop several photos and get one design of each. They are
 * sent one at a time: an account renders one batch at a time, so each photo
 * waits for the previous one instead of being refused.
 */
export function useBatch(onProgress: (finished: boolean) => void) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [preparing, setPreparing] = useState(0);
  const latest = useRef(items);
  function change(update: (list: BatchItem[]) => BatchItem[]) {
    latest.current = update(latest.current);
    setItems(latest.current);
  }
  function patch(id: string, values: Partial<BatchItem>) {
    change((list) =>
      list.map((item) => (item.id === id ? { ...item, ...values } : item)),
    );
  }
  useEffect(() => {
    if (!running) return;
    // Photos not sent yet are lost on leaving; sent ones finish on the server.
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    // A phone that locks its screen pauses the page, and the queue with it.
    // The browser drops the lock whenever the page is hidden: ask again.
    let lock: WakeLockSentinel | null = null;
    let active = true;
    const keepAwake = () => {
      if (document.visibilityState !== "visible" || !navigator.wakeLock) return;
      navigator.wakeLock
        .request("screen")
        .then((sentinel) => {
          if (active) lock = sentinel;
          else void sentinel.release();
        })
        .catch(() => {});
    };
    keepAwake();
    document.addEventListener("visibilitychange", keepAwake);
    return () => {
      active = false;
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", keepAwake);
      void lock?.release().catch(() => {});
    };
  }, [running]);
  useEffect(
    () => () =>
      latest.current.forEach((item) => URL.revokeObjectURL(item.preview)),
    [],
  );
  /** Reads the photos one by one and returns what could not be added. */
  async function add(files: File[], room: RoomId) {
    const problems: string[] = [];
    const space = MAX_BATCH - latest.current.length;
    if (files.length > space)
      problems.push(`Podés cargar hasta ${MAX_BATCH} fotos por tanda.`);
    const accepted = files.slice(0, Math.max(0, space));
    setPreparing((n) => n + accepted.length);
    for (const file of accepted) {
      try {
        const photo = await optimizePhoto(file);
        const preview = URL.createObjectURL(
          await thumbnail(photo.file).catch(() => photo.file),
        );
        change((list) => [
          ...list,
          {
            id: crypto.randomUUID(),
            key: crypto.randomUUID(),
            file: photo.file,
            preview,
            name: file.name.replace(/\.[^.]+$/, "") || "Foto",
            room,
            status: "waiting",
          },
        ]);
      } catch (e) {
        problems.push(
          `${file.name}: ${e instanceof Error ? e.message : "No pudimos abrirla."}`,
        );
      } finally {
        setPreparing((n) => n - 1);
      }
    }
    return problems;
  }
  function remove(id: string) {
    const item = latest.current.find((i) => i.id === id);
    if (!item || item.status === "sending" || item.status === "running") return;
    URL.revokeObjectURL(item.preview);
    change((list) => list.filter((i) => i.id !== id));
  }
  function clear() {
    if (running) return;
    latest.current.forEach((item) => URL.revokeObjectURL(item.preview));
    change(() => []);
  }
  function setRoom(id: string, room: RoomId) {
    patch(id, { room });
  }
  /** A failed photo goes back to the queue as a new request. */
  function retry(id: string) {
    patch(id, {
      status: "waiting",
      key: crypto.randomUUID(),
      message: undefined,
    });
  }
  async function send(item: BatchItem, settings: Settings) {
    patch(item.id, { status: "sending", message: undefined });
    let response: Response | null;
    let batch: {
      id?: string;
      ids?: string[];
      projectId?: string;
      error?: string;
    };
    for (let waits = 0, retries = 0; ; ) {
      const data = new FormData();
      data.set("image", item.file);
      data.set("room", item.room);
      data.set("style", settings.style);
      data.set("mode", settings.mode);
      data.set("notes", settings.notes);
      data.set("requestKey", item.key);
      data.set("batchSize", "1");
      data.set("variant", "1");
      try {
        response = await fetch("/api/jobs", { method: "POST", body: data });
        batch = await response.json().catch(() => ({}));
      } catch {
        // A dropped connection may have reached the server: the same
        // request key returns the job it created instead of a second one.
        response = null;
        batch = {};
      }
      // Another design of this account is still rendering (from another
      // tab, or one that outlived its wait here): take turns with it.
      const busy =
        response?.status === 409 && /en curso/.test(batch.error || "");
      if (busy && waits++ < 60) {
        patch(item.id, { message: "Esperando que termine otro diseño…" });
        await pause(10000);
        continue;
      }
      if ((!response || response.status >= 500) && retries++ < 3) {
        patch(item.id, { message: "Reintentando la conexión…" });
        await pause(5000);
        continue;
      }
      break;
    }
    if (!response?.ok) {
      const message =
        batch.error || "No pudimos enviar esta foto. Probá de nuevo.";
      if (response && stops(response.status, message)) {
        // The photo was not reserved: it waits with the rest to resume.
        patch(item.id, { status: "waiting", message: undefined });
        return message;
      }
      patch(item.id, { status: "failed", message });
      return null;
    }
    trackPhotoUploaded();
    metaTrack("amoblaia_foto_subida", {
      ambiente: item.room,
      estilo: settings.style,
    });
    const jobId = batch.ids?.[0] || batch.id;
    if (!jobId) {
      patch(item.id, {
        status: "later",
        message: "Revisala en Mis proyectos.",
      });
      return null;
    }
    patch(item.id, {
      status: "running",
      message: undefined,
      jobId,
      projectId: batch.projectId,
    });
    try {
      const job = await waitForJob(jobId);
      if (!job)
        patch(item.id, {
          status: "later",
          message: "Sigue en proceso. Va a aparecer en Mis proyectos.",
        });
      else if (job.status === "succeeded" && job.result)
        patch(item.id, {
          status: "done",
          result: job.result,
          projectId: job.projectId || batch.projectId,
        });
      else if (job.status === "failed")
        patch(item.id, { status: "failed", message: job.error });
      else patch(item.id, { status: "later", message: job.error });
    } catch (e) {
      patch(item.id, {
        status: "later",
        message:
          e instanceof Error
            ? e.message
            : "Sigue en proceso. Va a aparecer en Mis proyectos.",
      });
    }
    return null;
  }
  /**
   * Sends the queued photos in order. Returns why it stopped early, if it
   * did; the photos not sent stay queued, so starting again resumes.
   */
  async function start(settings: Settings) {
    if (running) return null;
    setRunning(true);
    try {
      let next: BatchItem | undefined;
      while ((next = latest.current.find((i) => i.status === "waiting"))) {
        const stop = await send(next, settings);
        if (stop) return stop;
        onProgress(false);
      }
      return null;
    } finally {
      setRunning(false);
      onProgress(true);
    }
  }
  /** Result links expire after an hour: a failed download asks for a new one. */
  async function download(item: BatchItem, label: string | null) {
    const name = `${item.name}-${item.room}`;
    try {
      if (!item.result) throw new Error("NO_RESULT");
      await downloadDesign(item.result, name, label);
    } catch {
      const fresh = item.jobId
        ? await fetch(`/api/jobs/${encodeURIComponent(item.jobId)}`, {
            cache: "no-store",
          })
            .then((r) => r.json())
            .catch(() => null)
        : null;
      if (!fresh?.result)
        throw new Error(
          "No pudimos descargar esta foto. Abrila desde Mis proyectos.",
        );
      patch(item.id, { result: fresh.result });
      await downloadDesign(fresh.result, name, label);
    }
  }
  const count = (status: BatchItem["status"]) =>
    items.filter((i) => i.status === status).length;
  return {
    items,
    running,
    preparing,
    waiting: count("waiting"),
    done: count("done"),
    add,
    remove,
    clear,
    setRoom,
    retry,
    start,
    download,
  };
}
export type Batch = ReturnType<typeof useBatch>;
const labels: Record<BatchItem["status"], string> = {
  waiting: "En espera",
  sending: "Enviando…",
  running: "Creando…",
  done: "Listo",
  failed: "No se pudo crear",
  later: "En proceso",
};
export function BatchList({
  batch,
  onAddPhotos,
  onFiles,
  label,
  onLabelChange,
  mode,
  onError,
}: {
  batch: Batch;
  onAddPhotos: () => void;
  onFiles: (files: File[]) => void;
  label: boolean;
  onLabelChange: (value: boolean) => void;
  mode: ModeId;
  onError: (message: string) => void;
}) {
  // Staged images always carry their disclosure; only retouching may skip it.
  const required = labelRequired(mode);
  const labelText = required || label ? disclosureFor(mode) : null;
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const total = batch.items.length;
  const finished = batch.items.filter(
    (i) => !["waiting", "sending", "running"].includes(i.status),
  ).length;
  async function downloadAll() {
    setDownloading(true);
    try {
      for (const item of batch.items.filter((i) => i.status === "done")) {
        await batch.download(item, labelText);
        // Browsers drop downloads fired back to back.
        await pause(400);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "No pudimos descargar.");
    } finally {
      setDownloading(false);
    }
  }
  return (
    <div
      className={`batch ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="batch-toolbar">
        <p role="status">
          {batch.running || finished ? (
            <>
              {batch.running && <LoaderCircle className="spin" size={15} />}
              {batch.done} de {total} fotos listas
            </>
          ) : (
            `${total} ${total === 1 ? "foto" : "fotos"} en la tanda`
          )}
          {batch.preparing > 0 && ` · Preparando ${batch.preparing}…`}
        </p>
        <div>
          <button
            className="subtle-button"
            onClick={onAddPhotos}
            disabled={total >= MAX_BATCH || batch.preparing > 0}
          >
            <ImagePlus size={14} /> Agregar fotos
          </button>
          <button
            className="subtle-button"
            onClick={batch.clear}
            disabled={batch.running}
          >
            <RotateCcw size={14} /> Empezar de nuevo
          </button>
        </div>
      </div>
      <ul className="batch-grid">
        {batch.items.map((item) => (
          <li key={item.id} className={`batch-item ${item.status}`}>
            <div className="batch-thumb">
              <img
                src={item.result || item.preview}
                alt={item.name}
                decoding="async"
              />
              <span className="batch-status">
                {item.status === "done" ? (
                  <Check size={12} />
                ) : ["sending", "running"].includes(item.status) ? (
                  <LoaderCircle className="spin" size={12} />
                ) : item.status === "failed" ? (
                  <Info size={12} />
                ) : null}
                {labels[item.status]}
              </span>
              {["waiting", "failed"].includes(item.status) && (
                <button
                  className="batch-remove icon-button"
                  aria-label={`Quitar ${item.name}`}
                  onClick={() => batch.remove(item.id)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="batch-info">
              <strong title={item.name}>{item.name}</strong>
              {["waiting", "failed"].includes(item.status) && !batch.running ? (
                <select
                  className="studio-select"
                  aria-label={`Ambiente de ${item.name}`}
                  value={item.room}
                  onChange={(e) =>
                    batch.setRoom(item.id, e.target.value as RoomId)
                  }
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span>{rooms.find((r) => r.id === item.room)?.name}</span>
              )}
              {item.message && <p>{item.message}</p>}
              {item.status === "done" && (
                <div className="batch-actions">
                  <button
                    className="button button-dark"
                    onClick={() =>
                      batch
                        .download(item, labelText)
                        .catch((e) =>
                          onError(
                            e instanceof Error
                              ? e.message
                              : "No pudimos descargar.",
                          ),
                        )
                    }
                  >
                    <Download size={14} /> JPG
                  </button>
                  {item.projectId && (
                    <a
                      className="button button-outline"
                      href={`/estudio?project=${encodeURIComponent(item.projectId)}`}
                      target="_blank"
                      rel="noopener"
                    >
                      Abrir <ArrowUpRight size={14} />
                    </a>
                  )}
                </div>
              )}
              {item.status === "failed" && !batch.running && (
                <button
                  className="subtle-button"
                  onClick={() => batch.retry(item.id)}
                >
                  <RotateCcw size={13} /> Volver a intentar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {batch.done > 0 && (
        <div className="batch-footer">
          <button
            className="button button-dark"
            onClick={downloadAll}
            disabled={downloading}
          >
            {downloading ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Download size={16} />
            )}{" "}
            Descargar{" "}
            {batch.done === 1 ? "el diseño" : `los ${batch.done} diseños`}
          </button>
          {required ? (
            <p className="checkbox-label">
              Cada imagen incluye el rótulo «{disclosureFor(mode)}».
            </p>
          ) : (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={label}
                onChange={(e) => onLabelChange(e.target.checked)}
              />{" "}
              Incluir rótulo «{disclosureFor(mode)}»
            </label>
          )}
        </div>
      )}
      {batch.running && (
        <p className="batch-hint">
          Mantené esta página abierta hasta que terminen. Cada foto lista queda
          guardada en Mis proyectos.
        </p>
      )}
    </div>
  );
}

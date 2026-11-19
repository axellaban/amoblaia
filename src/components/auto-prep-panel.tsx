"use client";
// «Preparar demo completa», en el editor del equipo: trae las fotos de la publicación, elige mirando
// cada imagen el mejor living, comedor y dormitorio, pone la mejor de portada, lanza Nórdico y
// Minimalista y publica cuando las 6 versiones están listas. Quien prepara (o la extensión) solo
// revisa el antes y el después. La tanda usa la misma cola del editor: una versión por vez.
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "./admin-demos";
import { AUTO_STYLES, prepSteps } from "@/lib/demos/auto-prep-logic";
import { cellState, type Task } from "@/lib/demos/editor-logic";
import type { DemoDetail } from "@/lib/demos/shared";
import { demoStyleName } from "@/lib/demos/styles";

type Queue = { busy: boolean; request: (tasks: Task[], opts?: { fresh?: boolean; quoted?: boolean }) => Promise<boolean> };
type Choice = { picks: { photoId: string; room: string; mode: "furnish" | "redesign" }[]; cover: string | null; styles: string[]; byImage: boolean };
type PhotosResult = { total: number; added: number; already: number; failed: number; reasons: string[] };
type Phase = "fotos" | "elegir" | "versiones" | "publicar";
const PHASES: { key: Phase; label: string }[] = [
  { key: "fotos", label: "Importar las fotos de la publicación" },
  { key: "elegir", label: "Elegir living, comedor y dormitorio, y la portada" },
  { key: "versiones", label: `Crear ${AUTO_STYLES.map(demoStyleName).join(" y ")}` },
  { key: "publicar", label: "Publicar cuando estén listas" },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Lo más que se espera a la tanda antes de dejarla seguir sola y avisar. */
const WAIT_MS = 30 * 60_000;

export function AutoPrepPanel({
  base,
  detail,
  staging,
  apply,
  addStyles,
  disabled,
}: {
  base: string;
  detail: DemoDetail;
  staging: Queue;
  apply: (d: DemoDetail) => void;
  /** Los estilos de la tanda quedan como estilos de la propiedad (columnas del editor). */
  addStyles: (styles: string[]) => void;
  disabled: boolean;
}) {
  const [phase, setPhase] = useState<Phase | null>(null);
  const [done, setDone] = useState<Set<Phase>>(new Set());
  const [notes, setNotes] = useState<Partial<Record<Phase, string>>>({});
  const [error, setError] = useState("");
  const [failedAt, setFailedAt] = useState<Phase | null>(null);
  const [result, setResult] = useState("");
  const queueBusy = useRef(staging.busy);
  queueBusy.current = staging.busy;
  const published = detail.demo.status === "published";
  const versions = detail.photos.reduce((n, p) => n + Object.keys(p.shown).length, 0);
  const steps = prepSteps({
    photos: detail.photos.length,
    photosTotal: null,
    stagedPhotos: detail.photos.filter((p) => Object.keys(p.shown).length).length,
    versions,
    published,
    preloads: 0,
  }).filter((s) => s.key !== "precargas");

  const note = (p: Phase, text: string) => setNotes((n) => ({ ...n, [p]: text }));
  const finish = (p: Phase) => setDone((d) => new Set(d).add(p));
  const reload = async () => {
    const d = await api<DemoDetail>(base);
    apply(d);
    return d;
  };

  async function run() {
    setError("");
    setFailedAt(null);
    setResult("");
    let current: Phase = "fotos";
    const step = (p: Phase) => {
      current = p;
      setPhase(p);
    };
    setDone(new Set());
    setNotes({});
    try {
      // 1. Fotos: the same reader as «Completar desde la publicación», with retries, on the server.
      step("fotos");
      let d = detail;
      if (d.property.listing_url) {
        const r = await api<PhotosResult>(`${base}/preparar`, { method: "POST", body: JSON.stringify({ step: "fotos" }) });
        note(
          "fotos",
          [`${r.added + r.already} de ${r.total} fotos`, r.added ? `${r.added} nuevas` : "", r.failed ? `${r.failed} no se pudieron descargar${r.reasons[0] ? ` (${r.reasons[0]})` : ""}` : ""]
            .filter(Boolean)
            .join(" · "),
        );
        d = await reload();
      } else note("fotos", `${d.photos.length} fotos (sin publicación para leer)`);
      if (!d.photos.length) throw new Error("La propiedad no tiene fotos: no se pudo importar ninguna de la publicación.");
      finish("fotos");

      // 2. Qué se ambienta, mirando cada imagen.
      step("elegir");
      const choice = await api<Choice>(`${base}/preparar`, { method: "POST", body: JSON.stringify({ step: "elegir" }) });
      d = await reload();
      const name = (id: string) => {
        const i = d.photos.findIndex((p) => p.id === id);
        return i >= 0 ? `foto ${i + 1}` : "foto";
      };
      const roomName: Record<string, string> = { living: "living", dining: "comedor", bedroom: "dormitorio" };
      note(
        "elegir",
        `${choice.picks.map((p) => `${roomName[p.room] ?? p.room} (${name(p.photoId)}, ${p.mode === "redesign" ? "rediseñar" : "amoblar"})`).join(", ")}${choice.byImage ? "" : " · sin clasificador: por orden de las fotos"}`,
      );
      finish("elegir");

      // 3. La tanda: cada foto elegida en los dos estilos, por la cola del editor.
      step("versiones");
      addStyles([...AUTO_STYLES]);
      const tasks: Task[] = choice.picks.flatMap((p) => AUTO_STYLES.map((style) => ({ photoId: p.photoId, style, room: p.room, mode: p.mode })));
      await staging.request(tasks);
      const started = Date.now();
      const states = () => tasks.map((t) => {
        const photo = d.photos.find((p) => p.id === t.photoId);
        return photo ? cellState(photo, t.style, false).kind : "none";
      });
      for (;;) {
        await sleep(5000);
        d = await reload();
        const s = states();
        const ready = s.filter((k) => k === "ready").length;
        note("versiones", `${ready} de ${tasks.length} listas`);
        const pending = s.some((k) => k === "running" || k === "queued") || queueBusy.current;
        if (!pending && (ready === tasks.length || s.every((k) => k !== "none"))) break;
        if (!pending && s.some((k) => k === "none") && Date.now() - started > 60_000) break;
        if (Date.now() - started > WAIT_MS) throw new Error("La tanda sigue en curso: dejala terminar y volvé a tocar «Preparar demo completa» para publicar.");
      }
      const final = states();
      const missing = final.filter((k) => k !== "ready").length;
      if (missing) throw new Error(`${missing} de ${tasks.length} versiones no se pudieron crear: regeneralas desde cada foto y volvé a tocar «Preparar demo completa» (lo hecho no se repite).`);
      finish("versiones");

      // 4. Publicar.
      step("publicar");
      if (d.demo.status !== "published") apply(await api<DemoDetail>(base, { method: "PATCH", body: JSON.stringify({ action: "publish" }) }));
      note("publicar", "Publicada. La vista previa del enlace ya quedó generada.");
      finish("publicar");
      setResult("Demo lista y publicada. Revisá el antes y el después de cada foto antes de enviarla.");
    } catch (e) {
      setFailedAt(current);
      setError(e instanceof Error ? e.message : "No pudimos preparar la demo.");
    } finally {
      setPhase(null);
    }
  }

  return (
    <section className="account-panel ap-auto" aria-labelledby="ap-auto-title">
      <div className="ap-auto-head">
        <div>
          <h2 id="ap-auto-title">Preparar demo completa</h2>
          <p className="dm-help">
            Trae las fotos de la publicación, elige mirando cada imagen el mejor living, comedor y dormitorio, pone la mejor de portada, crea{" "}
            {AUTO_STYLES.map(demoStyleName).join(" y ")} y publica cuando están listas. Lo ya hecho no se repite. Solo queda revisar el antes y el después.
          </p>
        </div>
        <button type="button" className="button button-primary" disabled={disabled || phase !== null} onClick={() => void run()}>
          {phase ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />} {phase ? "Preparando…" : "Preparar demo completa"}
        </button>
      </div>
      <ol className="ap-auto-steps" aria-label="Avance de la demo">
        {steps.map((s) => (
          <li key={s.key} className={s.ok ? "is-ok" : ""}>
            {s.ok ? <Check size={14} aria-hidden="true" /> : <span className="ap-auto-dot" aria-hidden="true" />} {s.label}: {s.note}
          </li>
        ))}
      </ol>
      {(phase || done.size > 0 || error) && (
        <ol className="ap-auto-run" aria-live="polite">
          {PHASES.map((p) => (
            <li key={p.key} className={done.has(p.key) ? "is-ok" : phase === p.key ? "is-now" : ""}>
              {done.has(p.key) ? <Check size={14} aria-hidden="true" /> : phase === p.key ? <Loader2 size={14} className="spin" aria-hidden="true" /> : failedAt === p.key ? <X size={14} aria-hidden="true" /> : <span className="ap-auto-dot" aria-hidden="true" />}{" "}
              {p.label}
              {notes[p.key] && <small> · {notes[p.key]}</small>}
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="inline-notice" role="status">
          {result}
        </p>
      )}
    </section>
  );
}

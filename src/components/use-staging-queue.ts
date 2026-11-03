"use client";
// One controller for every staging the editor starts, one photo or a batch:
// the server's quote first (who pays, credits, coverage), one confirmation,
// then the versions one at a time (the account admits one live generation).
// The queue of versions not sent yet lives in this tab: closing it keeps only
// the version already on the server, which the editor keeps following.
import { useCallback, useRef, useState } from "react";
import { ApiError, api } from "./admin-demos";
import { track, trackMilestone } from "@/lib/analytics";
import { cellState, isLive, taskKey, type Task } from "@/lib/demos/editor-logic";
import type { DemoDetail, EditorPhoto } from "@/lib/demos/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Answers that would repeat for the next versions too: the rest of the queue is not sent. */
const STOPS = new Set([401, 402, 403, 409, 429, 503]);

type Quote = { payer: string; credits: number | null; newPhotos: number; blocked: string | null };
export type QueueReport = { tone: "error" | "notice"; text: string };

export function useStagingQueue(opts: {
  base: string;
  detail: DemoDetail | null;
  poll: (photoId: string) => Promise<EditorPhoto | null>;
  report: (r: QueueReport) => void;
  trackAgency: boolean;
}) {
  const { base, detail, poll, report, trackAgency } = opts;
  const queueRef = useRef<Task[]>([]);
  const [queue, setQueue] = useState<Task[]>([]);
  const [current, setCurrentState] = useState<Task | null>(null);
  const currentRef = useRef<Task | null>(null);
  const setCurrent = (t: Task | null) => {
    currentRef.current = t;
    setCurrentState(t);
  };
  const [starting, setStarting] = useState(false);
  const running = useRef(false);
  // Also set synchronously: a double click is ignored before the quote starts.
  const startingRef = useRef(false);
  // The request key of each attempt: kept when the answer never arrived (the
  // retry is the same attempt, so it is never reserved twice); a deliberate
  // new version gets a new key.
  const keys = useRef(new Map<string, string>());
  const detailRef = useRef(detail);
  detailRef.current = detail;

  const waiting = new Set([...queue, ...(current ? [current] : [])].map(taskKey));

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let failures = 0;
    let done = 0;
    while (queueRef.current.length) {
      const task = queueRef.current.shift()!;
      setQueue([...queueRef.current]);
      setCurrent(task);
      const k = taskKey(task);
      const photo = detailRef.current?.photos.find((p) => p.id === task.photoId);
      if (!photo) continue;
      const key = keys.current.get(k) ?? crypto.randomUUID();
      keys.current.set(k, key);
      try {
        await api(`${base}/photos/${task.photoId}`, {
          method: "POST",
          body: JSON.stringify({ key, room: task.room ?? photo.room, mode: task.mode ?? photo.mode, style: task.style }),
        });
        let latest = await poll(task.photoId);
        while (latest && isLive(latest, task.style)) {
          await sleep(4000);
          latest = await poll(task.photoId);
        }
        keys.current.delete(k);
        // The newest attempt in that style is this one (generations come newest first).
        const newest = latest?.generations.find((g) => g.style === task.style);
        if (newest?.status === "succeeded") done++;
        else failures++;
      } catch (e) {
        failures++;
        // The server answered: that attempt is over. No answer: the same key is kept for the retry.
        if (e instanceof ApiError) keys.current.delete(k);
        const left = queueRef.current.length;
        const stop = !(e instanceof ApiError) || STOPS.has(e.status);
        if (stop && left) {
          queueRef.current = [];
          setQueue([]);
        }
        report({
          tone: "error",
          text: `${e instanceof Error ? e.message : "No pudimos crear la versión."}${stop && left ? ` ${left} ${left === 1 ? "versión quedó" : "versiones quedaron"} sin enviar.` : ""}`,
        });
        if (stop) break;
      }
    }
    setCurrent(null);
    running.current = false;
    if (trackAgency) track("property_ai_generation_completed", { versions: done + failures, failed: failures, status: failures ? "partial" : "ok" });
    if (trackAgency && done) trackMilestone("first_generation_completed", { versions: done, source: "panel" });
    if (done && !failures) report({ tone: "notice", text: `${done} ${done === 1 ? "versión lista" : "versiones listas"}. Revisalas antes de publicar.` });
  }, [base, poll, report, trackAgency]);

  /**
   * Adds versions to the queue. fresh: a deliberate new version even if one
   * exists (regenerate). Otherwise existing, running, waiting and uncertain
   * results are skipped. quoted: the cost was already shown and confirmed
   * (the "Crear otra versión" dialog), so it is not asked again. Resolves
   * true only when the versions were accepted into the queue: the caller
   * keeps its selection until then.
   */
  const request = useCallback(
    async (tasks: Task[], { fresh = false, quoted = false }: { fresh?: boolean; quoted?: boolean } = {}) => {
      const d = detailRef.current;
      if (!d || startingRef.current) return false;
      startingRef.current = true;
      setStarting(true);
      try {
        if (d.staging?.blocked) {
          report({ tone: "error", text: d.staging.blocked });
          return false;
        }
        const inQueue = new Set([...queueRef.current, ...(currentRef.current ? [currentRef.current] : [])].map(taskKey));
        let uncertain = 0;
        const todo = tasks.filter((t) => {
          const photo = d.photos.find((p) => p.id === t.photoId);
          if (!photo || inQueue.has(taskKey(t))) return false;
          const state = cellState(photo, t.style, false);
          if (state.kind === "uncertain") {
            uncertain++;
            return false;
          }
          if (state.kind === "running" || state.kind === "queued" || (state.kind === "ready" && state.running)) return false;
          return fresh || state.kind !== "ready";
        });
        if (!todo.length) {
          report({
            tone: uncertain ? "error" : "notice",
            text: uncertain
              ? "Hay resultados en revisión técnica: descartalos o esperá a que se resuelvan antes de crear otros."
              : "No hay versiones nuevas para crear: las elegidas ya existen o se están creando.",
          });
          return false;
        }
        const photoIds = [...new Set(todo.map((t) => t.photoId))];
        if (d.staging?.payer === "agency" && !quoted) {
          // What it costs, from the server, before anything starts.
          let quote: Quote;
          try {
            quote = await api<Quote>(`${base}/costo`, { method: "POST", body: JSON.stringify({ photoIds }) });
          } catch (e) {
            report({ tone: "error", text: e instanceof Error ? e.message : "No pudimos calcular el costo. Probá de nuevo." });
            return false;
          }
          if (quote.blocked) {
            report({ tone: "error", text: `${quote.blocked} Podés ver el saldo en «Créditos».` });
            return false;
          }
          const n = quote.newPhotos;
          const ok = window.confirm(
            [
              `Vas a crear ${todo.length} ${todo.length === 1 ? "versión" : "versiones"} de ${photoIds.length} ${photoIds.length === 1 ? "foto" : "fotos"}.`,
              n
                ? `Usa ${n} ${n === 1 ? "crédito" : "créditos"} del saldo de la inmobiliaria (uno por foto que se ambienta por primera vez). Quedarían ${(quote.credits ?? 0) - n}.`
                : "No usa créditos: esas fotos ya están pagas y su cobertura sigue vigente.",
              "¿Continuar?",
            ].join("\n"),
          );
          if (!ok) return false;
          if (trackAgency) track("property_ai_generation_started", { photos: photoIds.length, versions: todo.length, credits: n });
          if (trackAgency) trackMilestone("first_generation_started", { versions: todo.length, source: "panel" });
        }
        if (fresh) for (const t of todo) keys.current.delete(taskKey(t));
        queueRef.current.push(...todo);
        setQueue([...queueRef.current]);
        if (uncertain)
          report({ tone: "notice", text: `${uncertain} ${uncertain === 1 ? "versión quedó" : "versiones quedaron"} afuera por estar en revisión técnica.` });
        void drain();
        return true;
      } finally {
        startingRef.current = false;
        setStarting(false);
      }
    },
    [base, drain, report, trackAgency],
  );

  /** Takes versions not sent yet out of the queue (the one being created keeps going). */
  const cancelPending = useCallback(() => {
    const left = queueRef.current.length;
    queueRef.current = [];
    setQueue([]);
    return left;
  }, []);

  return { queue, current, waiting, starting, busy: Boolean(current) || queue.length > 0, request, cancelPending };
}

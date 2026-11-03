"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ChevronsLeftRight } from "lucide-react";
import type { EventProperties } from "@/lib/analytics";
import { reportSlider, SliderGesture } from "@/lib/interaction-tracking";
/** Set once this browser has been shown how the comparison works. */
const TAUGHT_KEY = "habita:comparison-taught";
const SWEEP_MS = 1300;
/** Anything the visitor does ends the lesson. */
const STOP_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
/** Also kept in memory: with blocked storage the lesson still shows once per visit. */
let taughtThisVisit = false;

export function Comparison({
  before,
  after,
  alt = "Ambiente con virtual staging",
  initial = 45,
  compact = false,
  beforeAlt = "Ambiente original antes del diseño",
  beforeLabel = "Antes",
  afterLabel,
  afterFilter,
  onPositionChange,
  onAfterError,
  analytics,
  teach = false,
}: {
  before: string;
  after: string;
  alt?: string;
  initial?: number;
  compact?: boolean;
  beforeAlt?: string;
  beforeLabel?: string;
  /** Replaces "Después con IA". */
  afterLabel?: string;
  /** A CSS filter on the "after" photo only: the preview of an edit. */
  afterFilter?: string;
  /** Lets a gallery remember where the line was for each photo. */
  onPositionChange?: (position: number) => void;
  /** The "after" image did not load. */
  onAfterError?: () => void;
  /** Which photo and style this is: with it, each completed gesture is one comparison_slider_used. */
  analytics?: EventProperties;
  /**
   * The first time this browser sees a comparison: a discreet «Deslizá para
   * comparar» and one short sweep of the line (none with reduced motion).
   * Any interaction stops it.
   */
  teach?: boolean;
}) {
  const [position, setPosition] = useState(initial);
  const [hint, setHint] = useState(false);
  // Stops the lesson: the sweep (if running) and the hint.
  const stopTeaching = useRef<() => void>(() => undefined);
  const report = useRef(onPositionChange);
  report.current = onPositionChange;
  useEffect(() => {
    report.current?.(position);
  }, [position]);
  const box = useRef<HTMLDivElement>(null);
  // The gesture in progress, summarized when it ends: never one event per movement.
  const gesture = useRef<SliderGesture | null>(null);
  const keysDone = useRef<number | undefined>(undefined);
  const where = useRef(position);
  where.current = position;
  const context = useRef(analytics);
  context.current = analytics;
  const finish = () => {
    window.clearTimeout(keysDone.current);
    const g = gesture.current;
    gesture.current = null;
    const summary = g?.end();
    if (summary && context.current) reportSlider(summary, context.current);
  };
  const begin = (input: SliderGesture["input"]) => {
    if (!context.current) return;
    if (gesture.current && gesture.current.input !== input) finish();
    gesture.current ??= new SliderGesture(input, where.current);
  };
  useEffect(() => {
    if (!teach || taughtThisVisit) return;
    taughtThisVisit = true;
    try {
      if (localStorage.getItem(TAUGHT_KEY)) return;
      localStorage.setItem(TAUGHT_KEY, "1");
    } catch {
      // Blocked storage: shown on this visit only.
    }
    setHint(true);
    let frame = 0;
    let timer = 0;
    let hide = 0;
    const stop = () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.clearTimeout(hide);
      setHint(false);
      for (const type of STOP_EVENTS) window.removeEventListener(type, stop, true);
    };
    stopTeaching.current = stop;
    for (const type of STOP_EVENTS) window.addEventListener(type, stop, { capture: true, passive: true });
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      // One sweep: a little to each side and back where it was.
      const from = where.current;
      const amp = Math.min(14, from, 100 - from);
      timer = window.setTimeout(() => {
        const t0 = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - t0) / SWEEP_MS);
          setPosition(from + amp * Math.sin(t * 2 * Math.PI) * (1 - t * 0.15));
          if (t < 1) frame = window.requestAnimationFrame(step);
          else setPosition(from);
        };
        frame = window.requestAnimationFrame(step);
      }, 700);
    }
    // The hint leaves by itself after a few seconds.
    hide = window.setTimeout(stop, reduced ? 5000 : 700 + SWEEP_MS + 2500);
    return stop;
    // Once per mount: the lesson is for the first comparison seen.
  }, [teach]);
  // Leaving the page or the photo mid-gesture still reports it.
  useEffect(() => {
    window.addEventListener("pagehide", finish);
    return () => {
      window.removeEventListener("pagehide", finish);
      finish();
    };
  }, []);
  // Where the pointer went down, and whether it is dragging the line: a
  // touch only does once it moves sideways, so vertical swipes just scroll.
  const start = useRef<{ x: number; y: number; dragging: boolean } | null>(
    null,
  );
  const follow = (x: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r?.width) return;
    const next = Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100));
    gesture.current?.move(next);
    setPosition(next);
  };
  // The whole photo is the handle, not just the knob (on phones the range
  // input only moves from its thumb). touch-action: pan-y keeps vertical
  // swipes scrolling the page; the browser cancels those pointers.
  const down = (e: PointerEvent<HTMLDivElement>) => {
    stopTeaching.current();
    if (e.button !== 0) return;
    const mouse = e.pointerType === "mouse";
    start.current = { x: e.clientX, y: e.clientY, dragging: mouse };
    begin(e.pointerType === "touch" || e.pointerType === "pen" ? e.pointerType : "mouse");
    // Touch is already captured by the browser.
    if (mouse) {
      e.currentTarget.setPointerCapture(e.pointerId);
      follow(e.clientX);
    }
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = Math.abs(e.clientX - s.x),
      dy = Math.abs(e.clientY - s.y);
    if (!s.dragging && dx > 4 && dx > dy) s.dragging = true;
    if (s.dragging) follow(e.clientX);
  };
  // A sideways drag belongs to the slider. Left to the browser it becomes a
  // fling, and the next tap anywhere only stops it instead of clicking.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let x = 0,
      y = 0;
    const touchStart = (e: TouchEvent) => {
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
    };
    // Same threshold as the drag, so a jittery vertical swipe still scrolls.
    const touchMove = (e: TouchEvent) => {
      const dx = Math.abs(e.touches[0].clientX - x),
        dy = Math.abs(e.touches[0].clientY - y);
      if (e.cancelable && dx > 4 && dx > dy) e.preventDefault();
    };
    el.addEventListener("touchstart", touchStart, { passive: true });
    el.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchmove", touchMove);
    };
  }, []);
  // A tap moves the line there.
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (
      s &&
      !s.dragging &&
      Math.abs(e.clientX - s.x) < 6 &&
      Math.abs(e.clientY - s.y) < 6
    )
      follow(e.clientX);
    start.current = null;
    finish();
  };
  return (
    <div
      ref={box}
      className={`comparison ${compact ? "comparison-compact" : ""}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        start.current = null;
        finish();
      }}
    >
      <img src={after} alt={alt} draggable={false} onError={onAfterError} style={afterFilter ? { filter: afterFilter } : undefined} />
      <div
        className="comparison-before"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img src={before} alt={beforeAlt} draggable={false} />
      </div>
      {/* Each label leaves when its side is almost out of view. */}
      <div className={`comparison-label before-label ${position < 18 ? "is-hidden" : ""}`}>{beforeLabel}</div>
      <div className={`comparison-label after-label ${position > 82 ? "is-hidden" : ""}`}>
        {afterLabel ?? (
          <>
            Después <span>con IA</span>
          </>
        )}
      </div>
      <div className="comparison-line" style={{ left: `${position}%` }}>
        <span>
          <ChevronsLeftRight size={21} />
        </span>
      </div>
      {hint && (
        <div className="comparison-hint" aria-hidden="true">
          <ChevronsLeftRight size={16} /> Deslizá para comparar
        </div>
      )}
      {/* Kept for the keyboard: arrows move the line. */}
      <input
        type="range"
        min="0"
        max="100"
        value={position}
        onChange={(e) => {
          const next = Number(e.target.value);
          gesture.current?.move(next);
          setPosition(next);
        }}
        // Arrow keys: one gesture until they stop for a moment or the focus leaves.
        onKeyDown={() => {
          begin("keyboard");
          window.clearTimeout(keysDone.current);
          keysDone.current = window.setTimeout(finish, 1200);
        }}
        onBlur={() => gesture.current?.input === "keyboard" && finish()}
        aria-label="Comparar antes y después"
        className="comparison-range"
      />
    </div>
  );
}

"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";

// A short animated picture, like a GIF, over the example photos: the CSS loop
// (hb-loop-* in globals.css) runs only while it is on screen, stops with its
// button (WCAG 2.2.2) and, with reduced motion, is a still frame without the
// button. Used by the home's cards and by the panel's «Inicio».

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return reduced;
}

export function Loop({
  className,
  label,
  children,
  controls,
}: {
  className: string;
  /** What the picture shows; without it the picture is decorative. */
  label?: string;
  children: ReactNode | ((running: boolean) => ReactNode);
  /** Buttons over the photo, outside the animated picture. */
  controls?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const running = visible && !paused && !reduced;
  return (
    <div ref={ref} className={`hb-loop ${className} ${running ? "is-running" : ""}`}>
      <div className="hb-loop-stage" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
        {typeof children === "function" ? children(running) : children}
      </div>
      {controls}
      <button
        type="button"
        className="hb-loop-toggle"
        onClick={() => setPaused(!paused)}
        aria-label={paused ? "Reanudar la animación" : "Pausar la animación"}
      >
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
    </div>
  );
}

/** A muted clip that plays while its Loop runs. */
export function LoopVideo({ running, poster, sources }: { running: boolean; poster: string; sources: { src: string; type: string }[] }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (running) v.play().catch(() => {});
    else v.pause();
  }, [running]);
  return (
    <video ref={ref} poster={poster} muted loop playsInline preload="none">
      {sources.map((s) => (
        <source key={s.src} src={s.src} type={s.type} />
      ))}
    </video>
  );
}

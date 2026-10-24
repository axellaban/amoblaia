"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ChevronsLeftRight } from "lucide-react";
export function Comparison({
  before,
  after,
  alt = "Ambiente con virtual staging",
  initial = 45,
  compact = false,
}: {
  before: string;
  after: string;
  alt?: string;
  initial?: number;
  compact?: boolean;
}) {
  const [position, setPosition] = useState(initial);
  const box = useRef<HTMLDivElement>(null);
  // Where the pointer went down, and whether it is dragging the line: a
  // touch only does once it moves sideways, so vertical swipes just scroll.
  const start = useRef<{ x: number; y: number; dragging: boolean } | null>(
    null,
  );
  const follow = (x: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r?.width)
      setPosition(Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100)));
  };
  // The whole photo is the handle, not just the knob (on phones the range
  // input only moves from its thumb). touch-action: pan-y keeps vertical
  // swipes scrolling the page; the browser cancels those pointers.
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const mouse = e.pointerType === "mouse";
    start.current = { x: e.clientX, y: e.clientY, dragging: mouse };
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
  };
  return (
    <div
      ref={box}
      className={`comparison ${compact ? "comparison-compact" : ""}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => (start.current = null)}
    >
      <img src={after} alt={alt} draggable={false} />
      <div
        className="comparison-before"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img
          src={before}
          alt="Ambiente original antes del diseño"
          draggable={false}
        />
      </div>
      <div className="comparison-label before-label">Antes</div>
      <div className="comparison-label after-label">
        Después <span>con IA</span>
      </div>
      <div className="comparison-line" style={{ left: `${position}%` }}>
        <span>
          <ChevronsLeftRight size={21} />
        </span>
      </div>
      {/* Kept for the keyboard: arrows move the line. */}
      <input
        type="range"
        min="0"
        max="100"
        value={position}
        onChange={(e) => setPosition(Number(e.target.value))}
        aria-label="Comparar antes y después"
        className="comparison-range"
      />
    </div>
  );
}

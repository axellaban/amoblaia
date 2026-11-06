"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

/**
 * Drag and drop to reorder a list of thumbnails, with a mouse or a finger.
 *
 * - Mouse: press and move a few pixels.
 * - Touch: press and hold (a short vibration says it is picked up), then move. A quick swipe still
 *   scrolls the strip or the page, as before.
 * - Keyboard: Alt + arrows on a focused thumbnail moves it one place.
 *
 * While dragging, the list shows the new order live; it is saved (onSort) only when released.
 * The click that follows a drag is swallowed, so dropping never opens or ticks a photo.
 */
export function useSortable({ ids, onSort, disabled = false }: { ids: string[]; onSort: (next: string[]) => void; disabled?: boolean }) {
  const [preview, setPreview] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ src: string; w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const live = useRef({ ids, onSort, preview: null as string[] | null });
  live.current.ids = ids;
  live.current.onSort = onSort;
  const gesture = useRef<{
    id: string;
    pointerId: number;
    touch: boolean;
    x0: number;
    y0: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
    active: boolean;
    timer: number;
    frame: number;
    el: HTMLElement;
    cleanup: () => void;
  } | null>(null);
  const suppressUntil = useRef(0);

  const placeGhost = () => {
    const g = gesture.current;
    if (g && ghostRef.current) ghostRef.current.style.transform = `translate(${g.x - g.dx}px, ${g.y - g.dy}px)`;
  };

  /** Where the pointer is: before or after the thumbnail under it (or the nearest one). */
  const retarget = () => {
    const g = gesture.current;
    const box = containerRef.current;
    const current = live.current.preview;
    if (!g?.active || !box || !current) return;
    let best: { id: string; rect: DOMRect; d: number } | null = null;
    for (const el of box.querySelectorAll<HTMLElement>("[data-sort-id]")) {
      const rect = el.getBoundingClientRect();
      const inside = g.x >= rect.left && g.x <= rect.right && g.y >= rect.top && g.y <= rect.bottom;
      const d = inside ? -1 : Math.hypot(g.x - (rect.left + rect.width / 2), g.y - (rect.top + rect.height / 2));
      if (!best || d < best.d) best = { id: el.dataset.sortId!, rect, d };
    }
    if (!best || best.id === g.id) return;
    const rest = current.filter((x) => x !== g.id);
    const at = rest.indexOf(best.id);
    if (at < 0) return;
    const after = g.x > best.rect.left + best.rect.width / 2;
    const next = [...rest.slice(0, at + (after ? 1 : 0)), g.id, ...rest.slice(at + (after ? 1 : 0))];
    if (next.join() === current.join()) return;
    live.current.preview = next;
    setPreview(next);
  };

  /** Near an edge, the strip (sideways) or the page (up and down) scrolls by itself. */
  const autoScroll = () => {
    const g = gesture.current;
    if (!g?.active) return;
    const box = containerRef.current;
    let moved = false;
    if (box && box.scrollWidth > box.clientWidth) {
      const r = box.getBoundingClientRect();
      const step = g.x < r.left + 40 ? -10 : g.x > r.right - 40 ? 10 : 0;
      const before = box.scrollLeft;
      if (step) box.scrollLeft += step;
      moved = box.scrollLeft !== before;
    }
    const down = g.y < 60 ? -12 : g.y > window.innerHeight - 60 ? 12 : 0;
    if (down) {
      const before = window.scrollY;
      window.scrollBy(0, down);
      moved = moved || window.scrollY !== before;
    }
    if (moved) retarget();
    g.frame = requestAnimationFrame(autoScroll);
  };

  const activate = () => {
    const g = gesture.current;
    if (!g || g.active) return;
    g.active = true;
    const rect = g.el.getBoundingClientRect();
    g.dx = g.x - rect.left;
    g.dy = g.y - rect.top;
    const img = g.el.querySelector("img");
    setGhost({ src: img?.currentSrc || img?.src || "", w: rect.width, h: rect.height });
    live.current.preview = [...live.current.ids];
    setPreview(live.current.preview);
    setDragId(g.id);
    if (g.touch) navigator.vibrate?.(15);
    g.frame = requestAnimationFrame(autoScroll);
  };

  const finish = (commit: boolean) => {
    const g = gesture.current;
    if (!g) return;
    window.clearTimeout(g.timer);
    cancelAnimationFrame(g.frame);
    g.cleanup();
    gesture.current = null;
    if (g.active) {
      suppressUntil.current = Date.now() + 400;
      const next = live.current.preview;
      if (commit && next && next.join() !== live.current.ids.join()) live.current.onSort(next);
    }
    live.current.preview = null;
    setPreview(null);
    setDragId(null);
    setGhost(null);
  };

  useEffect(() => () => finish(false), []);
  useEffect(() => {
    if (ghost) placeGhost();
  }, [ghost]);

  const onPointerDown = (e: PointerEvent<HTMLElement>, id: string) => {
      if (disabled || gesture.current || (e.pointerType === "mouse" && e.button !== 0)) return;
      const touch = e.pointerType !== "mouse";
      const move = (ev: globalThis.PointerEvent) => {
        const g = gesture.current;
        if (!g || ev.pointerId !== g.pointerId) return;
        g.x = ev.clientX;
        g.y = ev.clientY;
        if (!g.active) {
          const far = Math.hypot(g.x - g.x0, g.y - g.y0) > (touch ? 10 : 5);
          // A finger that moves before the hold is a scroll; a mouse that moves is a drag.
          if (far && touch) finish(false);
          else if (far) activate();
          return;
        }
        placeGhost();
        retarget();
      };
      const up = (ev: globalThis.PointerEvent) => ev.pointerId === gesture.current?.pointerId && finish(ev.type === "pointerup");
      // Once picked up, the finger moves the photo, not the page.
      const touchMove = (ev: TouchEvent) => gesture.current?.active && ev.cancelable && ev.preventDefault();
      const menu = (ev: Event) => gesture.current && ev.preventDefault();
      const key = (ev: globalThis.KeyboardEvent) => ev.key === "Escape" && finish(false);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      window.addEventListener("touchmove", touchMove, { passive: false });
      window.addEventListener("contextmenu", menu);
      window.addEventListener("keydown", key);
      gesture.current = {
        id,
        pointerId: e.pointerId,
        touch,
        x0: e.clientX,
        y0: e.clientY,
        x: e.clientX,
        y: e.clientY,
        dx: 0,
        dy: 0,
        active: false,
        timer: touch ? window.setTimeout(activate, 350) : 0,
        frame: 0,
        el: e.currentTarget,
        cleanup: () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          window.removeEventListener("touchmove", touchMove);
          window.removeEventListener("contextmenu", menu);
          window.removeEventListener("keydown", key);
        },
      };
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, id: string) => {
    if (disabled || !e.altKey) return;
    const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    const list = live.current.ids;
    const from = list.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= list.length) return;
    const next = [...list];
    [next[from], next[to]] = [next[to], next[from]];
    onSort(next);
  };

  return {
    /** The order to render: the live preview while dragging, else `ids`. */
    order: preview ?? ids,
    dragId,
    containerRef: (el: HTMLElement | null) => {
      containerRef.current = el;
    },
    /** Spread on each draggable element (the thumbnail's button or label). */
    item: (id: string) => ({
      "data-sort-id": id,
      "data-dragging": dragId === id ? "true" : undefined,
      onPointerDown: (e: PointerEvent<HTMLElement>) => onPointerDown(e, id),
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKeyDown(e, id),
      onClickCapture: (e: MouseEvent<HTMLElement>) => {
        if (Date.now() < suppressUntil.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      onDragStart: (e: DragEvent) => e.preventDefault(),
    }),
    /** The photo that follows the pointer while dragging. */
    ghost: ghost
      ? createPortal(
          <div ref={ghostRef} className="pw-drag-ghost" style={{ width: ghost.w, height: ghost.h }} aria-hidden="true">
            {ghost.src && <img src={ghost.src} alt="" />}
          </div>,
          document.body,
        )
      : null,
  };
}

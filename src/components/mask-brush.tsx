"use client";
// The brush for "Quitar objetos": paint over the photo what to remove. The
// canvas sits exactly over the photo and keeps its pixel size, so the mask
// matches the photo; export gives a PNG, transparent where it was painted.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type BrushHandle = {
  /** The painted area as a PNG (transparent where to remove), or null when nothing is painted. */
  exportPng: () => string | null;
  undo: () => void;
  clear: () => void;
};

const MAX_UNDO = 20;

export const MaskBrush = forwardRef<BrushHandle, { image: HTMLImageElement; size: number; onChange: (painted: boolean) => void }>(function MaskBrush(
  { image, size, onChange },
  ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const undos = useRef<ImageData[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });

  // The photo's own box, inside the figure, so the canvas covers exactly the picture.
  useEffect(() => {
    const place = () => {
      const parent = canvas.current?.parentElement;
      if (!parent) return;
      const ir = image.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      setBox({ left: ir.left - pr.left, top: ir.top - pr.top, width: ir.width, height: ir.height });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(image);
    return () => observer.disconnect();
  }, [image]);

  // The canvas keeps the photo's natural size; a new photo starts with nothing painted.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !image.naturalWidth) return;
    c.width = image.naturalWidth;
    c.height = image.naturalHeight;
    undos.current = [];
    onChange(false);
  }, [image, image.naturalWidth, image.naturalHeight, onChange]);

  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const scale = c.width / r.width;
    return { x: (e.clientX - r.left) * scale, y: (e.clientY - r.top) * scale, scale };
  };

  const ctx = () => canvas.current?.getContext("2d") ?? null;

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const c = ctx();
    if (!c || !canvas.current) return;
    canvas.current.setPointerCapture(e.pointerId);
    undos.current = [...undos.current.slice(-(MAX_UNDO - 1)), c.getImageData(0, 0, canvas.current.width, canvas.current.height)];
    const p = point(e);
    last.current = { x: p.x, y: p.y };
    // A tap paints a dot.
    c.beginPath();
    c.arc(p.x, p.y, (size * p.scale) / 2, 0, Math.PI * 2);
    c.fillStyle = "#e5483b";
    c.fill();
    onChange(true);
  };

  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const c = ctx();
    if (!c) return;
    const p = point(e);
    c.beginPath();
    c.moveTo(last.current.x, last.current.y);
    c.lineTo(p.x, p.y);
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = "#e5483b";
    c.lineWidth = size * p.scale;
    c.stroke();
    last.current = { x: p.x, y: p.y };
  };

  const up = () => {
    last.current = null;
  };

  useImperativeHandle(ref, () => ({
    exportPng: () => {
      const c = canvas.current;
      const painted = ctx();
      if (!c || !painted || !undos.current.length) return null;
      const src = painted.getImageData(0, 0, c.width, c.height);
      const out = document.createElement("canvas");
      out.width = c.width;
      out.height = c.height;
      const octx = out.getContext("2d");
      if (!octx) return null;
      const mask = octx.createImageData(c.width, c.height);
      for (let i = 0; i < src.data.length; i += 4) {
        // Black; transparent where something was painted: the area the model may change.
        mask.data[i + 3] = src.data[i + 3] > 0 ? 0 : 255;
      }
      octx.putImageData(mask, 0, 0);
      return out.toDataURL("image/png");
    },
    undo: () => {
      const c = ctx();
      const previous = undos.current.pop();
      if (!c || !previous) return;
      c.putImageData(previous, 0, 0);
      onChange(undos.current.length > 0);
    },
    clear: () => {
      const c = ctx();
      if (c && canvas.current) c.clearRect(0, 0, canvas.current.width, canvas.current.height);
      undos.current = [];
      onChange(false);
    },
  }));

  return (
    <canvas
      ref={canvas}
      className="pw-brush"
      aria-label="Pintá lo que querés quitar de la foto"
      role="img"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  );
});

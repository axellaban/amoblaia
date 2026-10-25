import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Browser } from "./Browser";
import { Cursor } from "./Cursor";
import { useFormat, windowRect } from "./layout";
import type { Timeline } from "./timeline";
import type { Format, Point } from "./types";

export type Overlay = (f: number, tl: Timeline) => React.ReactNode;

/** Transformación de la página dentro de la ventana en el cuadro f. */
export function pageTransform(tl: Timeline, f: number, format: Format) {
  const win = windowRect(format);
  const { cur } = tl.shotsAt(f);
  const shot = tl.shot(cur.id);
  const cam = tl.cameraAt(f, format);
  const s = win.baseScale * cam.z;
  const vw = win.w;
  const vh = win.h - win.bar;
  const clampT = (t: number, page: number, view: number) =>
    page * s <= view ? (view - page * s) / 2 : Math.min(0, Math.max(view - page * s, t));
  return { win, shot, s, tx: clampT(vw / 2 - cam.x * s, shot.w, vw), ty: clampT(vh / 2 - cam.y * s, shot.h, vh) };
}

/** Pasa de coordenadas CSS de la página a coordenadas del video. */
export function pageToVideo(tl: Timeline, f: number, format: Format, x: number, y: number) {
  const { win, s, tx, ty } = pageTransform(tl, f, format);
  return { x: win.x + tx + x * s, y: win.y + win.bar + ty + y * s, s };
}

/** Lugares del marco del navegador a los que puede ir el cursor. */
export function uiPoint(format: Format, id: string): Point {
  const win = windowRect(format);
  if (id === "ext") return { x: win.x + win.w - win.bar * 0.95, y: win.y + win.bar / 2 };
  throw new Error(`No existe el lugar ${id}`);
}

/**
 * La web real dentro de una ventana de navegador, con cámara, cursor y clics.
 * Las capas `overlays` se dibujan en coordenadas CSS de la página (se mueven con la cámara);
 * las `hud`, en coordenadas del video.
 */
export const Walkthrough: React.FC<{
  tl: Timeline;
  url: string | ((shotId: string) => string);
  accent: string;
  overlays?: Overlay[];
  hud?: Overlay[];
  enter?: number;
  clickSound?: boolean;
  extensionIcon?: string;
  extensionBadge?: (f: number) => React.ReactNode;
}> = ({ tl, url, accent, overlays = [], hud = [], enter = 1, clickSound = true, extensionIcon, extensionBadge }) => {
  const f = useCurrentFrame();
  const format = useFormat();
  const { win, shot, s, tx, ty } = pageTransform(tl, f, format);
  const { cur, prev, alpha } = tl.shotsAt(f);
  const since = tl.sinceClick(f);
  const u = typeof url === "function" ? url(cur.id) : url;
  const cursor = tl.cursorIn(f, (k) => (k.ui ? uiPoint(format, k.ui) : pageToVideo(tl, f, format, k.x, k.y)));
  const enterT = `perspective(2400px) translateY(${(1 - enter) * 120}px) rotateX(${(1 - enter) * 14}deg) scale(${0.92 + enter * 0.08})`;

  const layer = (id: string, opacity: number) => {
    const sh = tl.shot(id);
    const dy = tl.offsetAt(id, f);
    return (
      <Img
        key={id}
        src={staticFile(`${tl.dir}/${sh.src}`)}
        style={{ position: "absolute", left: 0, top: dy, width: sh.w, height: sh.h, opacity }}
      />
    );
  };

  return (
    <AbsoluteFill>
      <Browser
        w={win.w}
        h={win.h}
        bar={win.bar}
        url={u}
        extensionIcon={extensionIcon}
        extensionBadge={extensionBadge?.(f)}
        style={{ left: win.x, top: win.y, transform: enterT, opacity: Math.min(1, enter * 1.6) }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: shot.w,
            height: shot.h,
            transformOrigin: "0 0",
            transform: `translate(${tx}px, ${ty}px) scale(${s})`,
          }}
        >
          {prev && layer(prev.id, 1)}
          {layer(cur.id, alpha)}
          {overlays.map((o, i) => (
            <React.Fragment key={i}>{o(f, tl)}</React.Fragment>
          ))}
        </div>
      </Browser>
      {hud.map((o, i) => (
        <React.Fragment key={i}>{o(f, tl)}</React.Fragment>
      ))}
      {cursor && enter > 0.98 && <Cursor x={cursor.x} y={cursor.y} since={since} accent={accent} size={26 * Math.max(1, s * 0.95)} />}
      {clickSound &&
        tl.clicks.map((c) => (
          <Sequence key={c} from={c} durationInFrames={15} layout="none">
            <Audio src={staticFile("sfx/click.wav")} volume={0.55} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
};

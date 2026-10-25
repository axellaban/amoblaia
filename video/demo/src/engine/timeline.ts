import type { Box, Format, Point, Shot, ShotsFile } from "./types";
import { center } from "./types";
import { inOut, lerp, prog } from "./ease";

type Zoom = number | { landscape: number; portrait: number };
type CamKey = { f: number; d: number; x: number; y: number; z: Zoom; portrait?: Point };
/** `ui`: un lugar del marco del navegador (por ejemplo, el ícono de la extensión) en vez de la página. */
type CurKey = { f: number; d: number; x: number; y: number; arc: number; ui?: string };
type ShotKey = { f: number; id: string; fade: number };
type Target = string | Point | Box;

/**
 * Guion de un recorrido por la web: se escribe en orden («mostrá esta captura, mové el cursor
 * a este botón, clic») y cada paso corre el reloj. La cámara corre en paralelo.
 */
export class Timeline {
  now = 0;
  shotKeys: ShotKey[] = [];
  camKeys: CamKey[] = [];
  curKeys: CurKey[] = [];
  clicks: number[] = [];
  marks: Record<string, number> = {};
  current = "";
  shifts: { id: string; f: number; d: number; from: number; to: number }[] = [];

  constructor(
    public data: ShotsFile,
    public dir: string,
  ) {}

  shot(id: string): Shot {
    const s = this.data.shots[id];
    if (!s) throw new Error(`No existe la captura ${id}`);
    return s;
  }

  /** "captura.caja", "caja" (de la captura actual), un punto o una caja. */
  resolve(t: Target): Point {
    if (typeof t !== "string") return "w" in t ? center(t) : t;
    return center(this.box(t));
  }

  box(ref: string): Box {
    const [a, b] = ref.includes(".") ? ref.split(".") : [this.current, ref];
    const box = this.shot(a).boxes[b];
    if (!box) throw new Error(`No existe la caja ${ref}`);
    return box;
  }

  show(id: string, fade = 10) {
    this.shot(id);
    this.shotKeys.push({ f: this.now, id, fade });
    this.current = id;
    return this;
  }

  wait(frames: number) {
    this.now += frames;
    return this;
  }

  at(frame: number) {
    this.now = frame;
    return this;
  }

  mark(name: string) {
    this.marks[name] = this.now;
    return this;
  }

  /** Mueve la cámara (no corre el reloj). El destino puede ser distinto en vertical. */
  camera(t: Target | { landscape: Target; portrait: Target }, z: Zoom = 1, d = 30, at = this.now) {
    const both = typeof t === "object" && "landscape" in t;
    const p = this.resolve(both ? t.landscape : t);
    const portrait = both ? this.resolve(t.portrait) : undefined;
    this.camKeys.push({ f: at, d, x: p.x, y: p.y, z, portrait });
    return this;
  }

  /** Pone el cursor en un lugar sin animar. */
  place(t: Target, dx = 0, dy = 0) {
    const p = this.resolve(t);
    this.curKeys.push({ f: this.now, d: 0, x: p.x + dx, y: p.y + dy, arc: 0 });
    return this;
  }

  /** Mueve el cursor y corre el reloj lo que dura el movimiento. */
  move(t: Target, d = 24, { dx = 0, dy = 0, arc = 0.12 } = {}) {
    const p = this.resolve(t);
    this.curKeys.push({ f: this.now, d, x: p.x + dx, y: p.y + dy, arc });
    this.now += d;
    return this;
  }

  /** Mueve el cursor a un elemento del marco del navegador (ver `uiPoint` en Walkthrough). */
  moveUi(id: string, d = 24, arc = 0.12) {
    this.curKeys.push({ f: this.now, d, x: 0, y: 0, arc, ui: id });
    this.now += d;
    return this;
  }

  click(after = 8) {
    this.clicks.push(this.now);
    this.now += after;
    return this;
  }

  /** Desplaza verticalmente una captura (para alinear dos estados con la cámara). */
  shift(id: string, from: number, to: number, d = 30, at = this.now) {
    this.shifts.push({ id, f: at, d, from, to });
    return this;
  }

  // --- Evaluación por cuadro ---

  offsetAt(id: string, f: number) {
    let v = 0;
    for (const k of this.shifts) {
      if (k.id !== id) continue;
      if (f < k.f) {
        v = v || k.from;
        break;
      }
      v = lerp(k.from, k.to, prog(f, k.f, k.f + k.d, inOut));
    }
    return v;
  }

  shotsAt(f: number) {
    let i = -1;
    for (let k = 0; k < this.shotKeys.length; k++) if (this.shotKeys[k].f <= f) i = k;
    if (i < 0) i = 0;
    const cur = this.shotKeys[i];
    const prev = i > 0 ? this.shotKeys[i - 1] : null;
    const alpha = cur.fade ? prog(f, cur.f, cur.f + cur.fade) : 1;
    return { cur, prev: alpha < 1 ? prev : null, alpha };
  }

  cameraAt(f: number, format: Format) {
    const zOf = (z: Zoom) => (typeof z === "number" ? z : z[format]);
    const pt = (k: CamKey) => (format === "portrait" && k.portrait ? k.portrait : { x: k.x, y: k.y });
    const first = this.camKeys[0];
    const s = this.shot(this.shotsAt(f).cur.id);
    let v = first ? { ...pt(first), z: zOf(first.z) } : { x: s.w / 2, y: 450, z: 1 };
    for (const k of this.camKeys) {
      if (f < k.f) break;
      const t = prog(f, k.f, k.f + k.d, inOut);
      const p = pt(k);
      v = { x: lerp(v.x, p.x, t), y: lerp(v.y, p.y, t), z: lerp(v.z, zOf(k.z), t) };
    }
    return v;
  }

  /** Posición del cursor en coordenadas de la página (ignora los destinos del marco). */
  cursorAt(f: number) {
    return this.cursorIn(f, (k) => (k.ui ? null : { x: k.x, y: k.y }));
  }

  /** Posición del cursor en coordenadas del video; `map` convierte cada destino en el cuadro f. */
  cursorIn(f: number, map: (k: { x: number; y: number; ui?: string }) => Point | null) {
    const keys = this.curKeys.filter((k) => map(k));
    const first = keys[0];
    if (!first) return null;
    const p0 = map(first)!;
    let v = { x: p0.x, y: p0.y };
    for (const k of keys) {
      if (f < k.f) break;
      const t = prog(f, k.f, k.f + k.d, inOut);
      const from = v;
      const to = map(k)!;
      const nx = lerp(from.x, to.x, t);
      const ny = lerp(from.y, to.y, t);
      // Pequeño arco perpendicular para que el movimiento parezca de una mano.
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const bend = Math.sin(Math.PI * t) * k.arc;
      v = { x: nx - dy * bend, y: ny + dx * bend };
      if (t >= 1) v = { x: to.x, y: to.y };
    }
    return v;
  }

  /** Cuadros desde el último clic (para la animación de presión y la onda). */
  sinceClick(f: number) {
    let best = Infinity;
    for (const c of this.clicks) if (c <= f) best = Math.min(best, f - c);
    return best;
  }
}

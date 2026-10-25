import data from "../../public/amoblaia/shots.json";
import styleOptions from "../../public/amoblaia/style-options.json";
import { Timeline } from "../engine/timeline";
import type { ShotsFile } from "../engine/types";

export const NOTES = "Tonos cálidos, sofá de lino y plantas";
export const STYLES = styleOptions.map((o) => o.label);
export const STYLE_PICK = STYLES.indexOf("Nórdico");
export const CPS = 20;

/** Recorrido por la web real de amoblaIA (cuadros a 30 fps). */
export function buildWalk() {
  const tl = new Timeline(data as ShotsFile, "amoblaia");
  const style = tl.box("studio-uploaded.style");
  const row = (i: number) => ({ x: style.x + 70, y: style.y + style.h + 6 + 6 + 34 * i + 17 });

  // Home → «Subí una imagen gratis»
  tl.show("home", 0);
  tl.camera({ x: 720, y: 450 }, { landscape: 1, portrait: 1 }, 1, 0);
  tl.camera({ landscape: { x: 600, y: 400 }, portrait: "home.cta" }, { landscape: 1.2, portrait: 1.05 }, 36, 8);
  tl.place({ x: 1250, y: 760 });
  tl.wait(14).move("home.cta", 26, { dx: 60 }).click(10).mark("toStudio");

  // Estudio: arrastrar la foto
  tl.show("studio-empty", 6);
  tl.camera("studio-empty.dropzone", { landscape: 1, portrait: 0.92 }, 26);
  tl.wait(10).place({ x: 1460, y: 960 }).mark("dragStart");
  tl.move("studio-empty.dropzone", 36, { arc: 0.06, dy: 40 }).mark("hover").wait(12).mark("drop");
  tl.show("studio-uploaded", 10).wait(18);

  // Ambiente y estilo
  tl.mark("options");
  tl.camera({ x: 300, y: 560 }, { landscape: 1.5, portrait: 1.25 }, 30);
  tl.move("studio-uploaded.style", 24).click(0).mark("ddOpen").wait(16);
  tl.move(row(STYLE_PICK), 14, { arc: 0.02 }).wait(6).click(0).mark("ddClose");
  tl.show("studio-style", 4).wait(16);

  // Un toque personal
  tl.move("studio-style.notes", 18, { dx: -60 }).click(6).mark("typeStart");
  tl.wait(Math.ceil((NOTES.length / CPS) * 30) + 10).mark("typeEnd");
  tl.show("studio-notes", 0).wait(8);

  // Generar
  tl.camera({ x: 300, y: 700 }, { landscape: 1.5, portrait: 1.25 }, 22);
  tl.move("studio-notes.generate", 22).click(4).mark("gen");
  tl.camera("studio-uploaded.photo", { landscape: 1.28, portrait: 1.12 }, 32);
  tl.wait(96).mark("genDone");

  // Resultado (alineado con la foto subida y después la cámara se abre)
  const up = tl.box("studio-uploaded.photo");
  const res = tl.box("studio-result.photo");
  const dy = up.y - res.y;
  tl.shift("studio-result", dy, dy, 1, 0);
  tl.show("studio-result", 4).wait(24);
  tl.shift("studio-result", dy, 0, 34);
  tl.camera({ x: res.x + res.w / 2, y: res.y + res.h / 2 + 60 }, { landscape: 1.08, portrait: 1.0 }, 34);
  tl.wait(20).move("studio-result.compare", 26).wait(4).click(10).mark("end");
  return tl;
}

// Captura el recorrido real del estudio de amoblaIA (producción, modo demo: no llama a la IA).
// Uso: node capture/amoblaia.mjs [--base=https://amoblaia.vercel.app]
import path from "node:path";
import fs from "node:fs";
import { openBrowser, Recorder, blockWrites, hide } from "./lib.mjs";

const base = (process.argv.find((a) => a.startsWith("--base="))?.slice(7)) || "https://amoblaia.vercel.app";
const out = path.resolve("public/amoblaia");
const rec = new Recorder(out);
const { browser, context } = await openBrowser();
// Nada de generar, registrar invitados ni guardar trabajos: sólo navegación.
await blockWrites(context, [/\/api\/(guest|jobs|generate|projects|session|newsletter|contact)/]);
const page = await context.newPage();

// 1. Home
await page.goto(base + "/", { waitUntil: "load" });
await page.waitForTimeout(2500);
await hide(page, ["[class*=cookie]", "[class*=toast]"]);
await rec.shot(page, "home", {
  cta: page.getByRole("button", { name: /Subí una imagen/ }).or(page.getByRole("link", { name: /Subí una imagen/ })),
  hero: ".hero img, main img",
});

// 2. Estudio vacío
await page.goto(base + "/estudio", { waitUntil: "load" });
await page.waitForTimeout(2500);
await rec.shot(page, "studio-empty", {
  dropzone: ".dropzone",
  upload: page.getByRole("button", { name: /Subir mi foto/ }),
  room: "select.studio-select >> nth=0",
  style: "select[data-tour=style]",
  notes: "textarea",
  generate: "[data-tour=generate] button, button[type=submit]",
  stage: ".canvas-stage",
});

// 3. Foto subida (queda sólo en el navegador; no se genera nada)
const photo = path.resolve("capture/assets/depto-palermo.jpg");
await page.locator('input[type=file]').setInputFiles(photo);
await page.waitForTimeout(3000);
const styleOptions = await page.$$eval("select[data-tour=style] option", (os) => os.map((o) => ({ value: o.value, label: o.textContent.trim(), disabled: o.disabled })));
const roomOptions = await page.$$eval("select.studio-select >> nth=0", () => []).catch(() => []);
const boxesUploaded = {
  room: "select.studio-select >> nth=0",
  style: "select[data-tour=style]",
  notes: "textarea",
  generate: "[data-tour=generate] button, button[type=submit]",
  stage: ".canvas-stage",
  photo: ".canvas-stage img",
  styleHint: ".staging-selects + p, .style-hint",
};
await rec.shot(page, "studio-uploaded", boxesUploaded);

// 4. Estilo nórdico + toque personal
await page.selectOption("select[data-tour=style]", "scandinavian");
await page.waitForTimeout(400);
await rec.shot(page, "studio-style", boxesUploaded);
await page.locator("textarea").fill("Tonos cálidos, sofá de lino y plantas");
await page.waitForTimeout(400);
await rec.shot(page, "studio-notes", boxesUploaded);

// 5. Resultado: el ejemplo precargado del mismo living (imagen real del motor, sin gastar).
//    Se usa el modo demo y se ajustan los textos que dicen «Ejemplo» para que el recorrido siga
//    la misma foto.
// Contexto nuevo: el borrador de la foto subida queda en IndexedDB y no queremos recuperarlo.
const ctx2 = (await openBrowser()).context;
await blockWrites(ctx2, [/\/api\/(guest|jobs|generate|projects|session|newsletter|contact)/]);
const page2 = await ctx2.newPage();
await page2.goto(base + "/estudio", { waitUntil: "load" });
await page2.waitForTimeout(2500);
await page2.getByRole("button", { name: /Living/ }).first().click();
await page2.waitForTimeout(1200);
await page2.selectOption("select[data-tour=style]", "scandinavian");
await page2.getByRole("button", { name: /Ver transformación/ }).click();
await page2.waitForTimeout(2500);
await page2.evaluate(() => {
  const ta = document.querySelector("textarea");
  if (ta) { ta.value = "Tonos cálidos, sofá de lino y plantas"; ta.disabled = false; }
  for (const e of document.querySelectorAll("span, small")) if (e.children.length === 0 && /^0\/500$/.test(e.textContent.trim())) e.textContent = ta.value.length + "/500";
  document.querySelectorAll(".photo-name").forEach((e) => (e.textContent = "depto-palermo.jpg"));
  for (const b of document.querySelectorAll("button")) {
    if (/Ver transformación/.test(b.textContent)) b.lastChild.textContent = "Crear 3 diseños gratis";
  }
  for (const p of document.querySelectorAll("p, small, span")) {
    if (/Ejemplo precargado/.test(p.textContent) && p.children.length === 0) p.textContent = "Te quedan 22 diseños gratis";
  }
});
await hide(page2, ["[role=status]", ".toast", ".notice", "[class*=notice]"]);
await page2.waitForTimeout(400);
await rec.shot(page2, "studio-result", {
  stage: ".canvas-stage",
  photo: ".canvas-stage img",
  compare: page2.getByRole("button", { name: /Comparar/ }),
  download: page2.getByRole("button", { name: /Descargar/ }).or(page2.getByRole("link", { name: /Descargar/ })),
  beforeAfter: page2.getByRole("button", { name: /Antes y después/ }),
  generate: "[data-tour=generate] button, button[type=submit]",
});

rec.save({ base, styleOptions });
fs.writeFileSync(path.join(out, "style-options.json"), JSON.stringify(styleOptions, null, 2));
await browser.close();

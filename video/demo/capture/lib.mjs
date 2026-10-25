// Utilidades para capturar la interfaz real: capturas a 2x y cajas de los elementos (en px CSS),
// que después usa Remotion para mover el cursor y la cámara.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    // En los entornos de Claude Code está instalado de forma global.
    const { execSync } = require("node:child_process");
    const root = execSync("npm root -g").toString().trim();
    return require(path.join(root, "playwright"));
  }
}

export async function openBrowser({ width = 1440, height = 900, scale = 2 } = {}) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  );
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
  });
  return { browser, context };
}

export class Recorder {
  constructor(outDir) {
    this.outDir = outDir;
    this.shots = {};
    fs.mkdirSync(outDir, { recursive: true });
  }
  /** Guarda una captura y las cajas de los selectores pedidos. */
  async shot(page, id, boxes = {}, { fullPage = false, clip } = {}) {
    await page.waitForTimeout(300);
    const file = `${id}.png`;
    await page.screenshot({ path: path.join(this.outDir, file), fullPage, clip, animations: "disabled", caret: "hide" });
    const vp = page.viewportSize();
    const size = fullPage
      ? await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }))
      : clip
        ? { w: clip.width, h: clip.height }
        : { w: vp.width, h: vp.height };
    const scroll = fullPage ? { x: 0, y: 0 } : await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    const out = {};
    for (const [name, sel] of Object.entries(boxes)) {
      const loc = typeof sel === "string" ? page.locator(sel).first() : sel.first();
      const b = await loc.boundingBox({ timeout: 1500 }).catch(() => null);
      if (!b) {
        console.warn(`  ! ${id}: no encontré ${name}`);
        continue;
      }
      // boundingBox es relativo al viewport; en capturas de página completa sumamos el scroll.
      const ox = fullPage ? await page.evaluate(() => scrollX) : 0;
      const oy = fullPage ? await page.evaluate(() => scrollY) : 0;
      out[name] = { x: Math.round(b.x + ox - (clip?.x ?? 0)), y: Math.round(b.y + oy - (clip?.y ?? 0)), w: Math.round(b.width), h: Math.round(b.height) };
    }
    this.shots[id] = { src: file, w: size.w, h: size.h, scroll, boxes: out };
    console.log(`  ✓ ${id} (${Object.keys(out).length} cajas)`);
    return this.shots[id];
  }
  save(extra = {}) {
    fs.writeFileSync(path.join(this.outDir, "shots.json"), JSON.stringify({ ...extra, shots: this.shots }, null, 2));
  }
}

/** Corta toda llamada que pueda generar costo o escribir datos. */
export async function blockWrites(context, patterns) {
  await context.route("**/*", (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() !== "GET" && req.method() !== "HEAD" && patterns.some((p) => p.test(url))) {
      console.log(`  ⛔ bloqueado ${req.method()} ${url}`);
      return route.abort();
    }
    return route.continue();
  });
}

/** Saca de la vista lo que no va en el video (banners de cookies, widgets de chat, toasts). */
export async function hide(page, selectors) {
  await page.addStyleTag({ content: selectors.map((s) => `${s}{display:none!important}`).join("\n") });
}

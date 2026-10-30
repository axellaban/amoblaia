import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// The real stylesheet on fixed markup that mirrors the components: checks the
// layout on a phone without needing the team's session or a database.
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const photo =
  "data:image/svg+xml;utf8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#c9b79c"/><rect y="380" width="800" height="220" fill="#8d7a5f"/></svg>');
const page$ = (body: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;

// Mirrors the row of src/components/admin-demos.tsx (DemoList).
const demoRow = `
<div class="adm-shell"><div class="adm-content"><div class="account-page container dm-page"><ul class="dm-list"><li class="dm-row">
  <a class="dm-thumb" href="#"><img src="${photo}" alt=""></a>
  <div class="dm-row-main">
    <a class="dm-agency" href="#">Selecto Propiedades</a>
    <strong>En venta. Exclusivo semipiso de 3 ambientes con cochera y baulera. Chauvin</strong>
    <span class="dm-meta">26 fotos · 2 ambientadas · creada el 29/10/2026</span>
  </div>
  <span class="dm-status is-live">Publicada</span>
  <div class="dm-links">
    <span class="dm-link-group"><span class="dm-who">Inmobiliaria</span><button class="dm-text">Ver</button><button class="dm-text">Copiar enlace</button></span>
    <span class="dm-sep" aria-hidden="true">·</span>
    <span class="dm-link-group"><span class="dm-who">Comprador</span><button class="dm-text">Ver</button><button class="dm-text">Copiar enlace</button></span>
    <span class="dm-sep" aria-hidden="true">·</span>
    <span class="dm-link-group"><a class="dm-text dm-text-wa" href="#">Enviar por WhatsApp</a></span>
  </div>
  <div class="dm-bottom">
    <div class="dm-facts">
      <div class="dm-credits"><span class="dm-credits-label">Créditos reservados</span><div class="dm-credits-nums"><b>10</b><button class="dm-text">Cargar</button></div></div>
      <div class="dm-activity"><span class="dm-activity-label">Actividad</span><strong>3 · Generó imagen</strong><span class="dm-activity-dots"><i class="on"></i><i class="on"></i><i class="on"></i><i></i><i></i></span><span class="dm-activity-foot">2 personas · última hace 5 min</span></div>
    </div>
    <div class="dm-actions"><a class="dm-text" href="#">Editar</a><span class="dm-sep">·</span><button class="dm-text">Despublicar</button><span class="dm-sep">·</span><button class="dm-text dm-danger">Eliminar</button></div>
  </div>
</li></ul></div></div></div>`;

// Mirrors the stage of src/components/demo-view.tsx while a style is generated.
const generating = `
<div class="dv2-page" style="padding:12px"><div class="dv2-stage">
  <div class="dv2-frame" style="--ratio:1.3333">
    <img class="dv2-photo" src="${photo}" alt="">
    <div class="dv2-generating" role="status"><svg class="dv2-spin" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
      <strong>Generando Moderno…</strong><span>12 s · suele tardar entre 30 y 60 segundos</span>
      <small>Podés seguir mirando las otras fotos: te la mostramos apenas esté.</small></div>
  </div>
</div></div>`;

test.describe("en el celular", () => {
  test("la fila de la lista de demos no aplasta el título", async ({ page }, info) => {
    test.skip(!info.project.use.isMobile, "solo en celular");
    await page.setContent(page$(demoRow));
    const row = page.locator(".dm-row");
    const title = page.locator(".dm-row-main strong");
    const rowBox = (await row.boundingBox())!;
    const titleBox = (await title.boundingBox())!;
    // The title takes the row's width next to the photo, not a word per line.
    expect(titleBox.width).toBeGreaterThan(rowBox.width * 0.55);
    expect(titleBox.height).toBeLessThan(110);
    // Links and credits sit under the title, inside the row.
    for (const sel of [".dm-links", ".dm-bottom"]) {
      const box = (await page.locator(sel).boundingBox())!;
      expect(box.y).toBeGreaterThan(titleBox.y);
      expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
    }
    // Every link is big enough for a thumb.
    for (const h of await page.locator(".dm-links .dm-text, .dm-actions .dm-text").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
      expect(h).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/lista-demos-${info.project.name}.png`, fullPage: true });
  });

  test("la espera al generar se ve sobre la foto", async ({ page }, info) => {
    await page.setContent(page$(generating));
    const overlay = page.locator(".dv2-generating");
    await expect(overlay).toBeVisible();
    const frame = (await page.locator(".dv2-frame").boundingBox())!;
    const box = (await overlay.boundingBox())!;
    expect(Math.abs(box.width - frame.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - frame.height)).toBeLessThanOrEqual(1);
    expect(await page.locator(".dv2-spin").evaluate((el) => getComputedStyle(el).animationName)).toBe("dv2-spin");
    await page.screenshot({ path: `test-results/generando-${info.project.name}.png` });
  });
});

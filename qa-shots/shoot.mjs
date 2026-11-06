import { chromium } from "playwright";
const b = await chromium.launch();
const shots = [
  ["precios", "desktop", 1440, 900], ["precios", "mobile", 390, 844], ["precios-abierto", "desktop", 1440, 900], ["precios-abierto", "mobile", 390, 844],
  ["panel", "desktop", 1440, 900], ["panel", "mobile", 390, 844], ["precios", "tablet", 820, 1180],
];
const report = [];
for (const [name, dev, w, h] of shots) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dev === "desktop" ? 1 : 2 });
  await p.goto(`file://${process.cwd()}/qa-shots/out/${name}.html`);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `qa-shots/out/${name}-${dev}.png`, fullPage: true });
  await p.screenshot({ path: `qa-shots/out/${name}-${dev}-fold.png` });
  const m = await p.evaluate(() => {
    const g = document.querySelector(".hb-packs-grid")?.getBoundingClientRect();
    const cta = document.querySelector(".hb-buy-cta")?.getBoundingClientRect();
    const wide = [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map(e => `${e.tagName}.${[...e.classList].join('.')} r=${Math.round(e.getBoundingClientRect().right)}`);
    return { wide, scrollW: document.documentElement.scrollWidth, innerW: innerWidth, packsBottom: g && Math.round(g.bottom), ctaBottom: cta && Math.round(cta.bottom), font: getComputedStyle(document.body).fontFamily };
  });
  report.push({ name, dev, ...m });
}
console.log(JSON.stringify(report, null, 1));
await b.close();

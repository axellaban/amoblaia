import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire("/vercel/pw/package.json");
const { chromium } = require("playwright");
const req2 = createRequire("/vercel/amoblaia/package.json");
const APP = "http://localhost:3000", MOCK = "http://127.0.0.1:54321";
const token = "tok_IntegrationShowcase_000001";
const ids = { reviewed: "00000000-0000-4000-8000-0000000000c1", pending: "00000000-0000-4000-8000-0000000000c2", foreign: "00000000-0000-4000-8000-0000000000c7" };
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); if (!ok) failed++; };
const get = (p) => fetch(APP + p, { redirect: "manual" });
const pub = await (await fetch(MOCK + "/__public")).json();
const [livingRoom] = pub.rooms;
// Shared page
let r = await get(`/ficha/${token}`);
let html = await r.text();
check("ficha opens without session", r.status === 200, String(r.status));
check("ficha shows title and real photo first", html.includes("Depto 3 ambientes en Güemes") && html.includes("Estado actual") && html.includes("Explorá este ambiente amoblado"));
check("ficha has no private data", !/0000000000a1|Calle Privada|original\.jpg|dormitorio\.jpg|industrial\.jpg/.test(html));
check("ficha lists only reviewed styles", !html.includes(ids.pending) && !html.includes("Industrial"));
check("ficha not framable", r.headers.get("x-frame-options") === "DENY" && r.headers.get("content-security-policy") === "frame-ancestors 'none'");
check("ficha noindex", (r.headers.get("x-robots-tag") || "").includes("noindex"));
check("ficha without amoblaIA nav/pixel", !html.includes("Navegación principal") && !html.includes("fbevents"));
// Embed
r = await get(`/embed/ficha/${token}`);
html = await r.text();
check("embed opens", r.status === 200);
check("embed framable only here", !r.headers.get("x-frame-options") && r.headers.get("content-security-policy") === "frame-ancestors *");
check("embed without site chrome", !html.includes("Navegación principal") && !html.includes("Newsletter"));
r = await get(`/estudio`);
check("rest of app stays DENY", r.headers.get("x-frame-options") === "DENY");
// Images
const img = async (ref) => { const x = await get(`/ficha/${token}/imagen/${ref}`); return [x.status, x.headers.get("content-type"), (await x.arrayBuffer()).byteLength]; };
let s = await img(`o-${livingRoom.id}`);
check("original image served", s[0] === 200 && s[1] === "image/jpeg", s.join(" "));
s = await img(`p-${ids.reviewed}`);
check("reviewed proposal served", s[0] === 200 && s[1] === "image/jpeg", s.join(" "));
check("unreviewed proposal blocked", (await img(`p-${ids.pending}`))[0] === 404);
check("other account's proposal blocked", (await img(`p-${ids.foreign}`))[0] === 404);
check("project id is not a room id", (await img(`o-00000000-0000-4000-8000-0000000000b1`))[0] === 404);
check("logo absent -> 404", (await img("logo"))[0] === 404);
check("unknown token -> 404", (await get(`/ficha/tok_DoesNotExist_00000000000`)).status === 404);
// Private APIs need a session
for (const [m, p] of [["GET", "/api/fichas"], ["PATCH", `/api/proposals/${ids.reviewed}`], ["POST", "/api/fichas"]]) {
  const x = await fetch(APP + p, { method: m, headers: { Origin: APP, "Content-Type": "application/json" }, body: m === "GET" ? undefined : "{}" });
  check(`${m} ${p} requires an account`, x.status === 401 || x.status === 403, String(x.status));
}
// Iframe on a different origin, with the real embed code
const { embedCode } = await import("/vercel/amoblaia/.verify/shared.mjs");
const code = embedCode(APP, token, "Depto 3 ambientes en Güemes");
const parent = http.createServer((q, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(q.url.startsWith("/blocked")
    ? `<h1>Sitio inmobiliaria</h1><iframe id="b" src="${APP}/ficha/${token}" style="width:600px;height:400px"></iframe>`
    : `<!doctype html><meta charset="utf-8"><h1>Sitio de la inmobiliaria</h1><p>Propiedad destacada</p>${code}`);
}).listen(4000);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto("http://127.0.0.1:4000/");
const frame = page.frameLocator("iframe");
await frame.getByText("Explorá este ambiente amoblado").waitFor({ timeout: 20000 });
const h1 = await page.$eval("iframe", (f) => f.getBoundingClientRect().height);
await frame.getByText("Explorá este ambiente amoblado").click();
await frame.getByRole("radio", { name: "Nórdico" }).click();
await frame.getByText("Propuesta de ambientación virtual · Nórdico").waitFor();
const loaded = await frame.locator(".pc-panel img").evaluateAll((imgs) => imgs.map((i) => i.complete && i.naturalWidth > 0));
check("iframe renders original and proposal", loaded.length === 2 && loaded.every(Boolean), JSON.stringify(loaded));
const label = await frame.locator(".pc-panel.is-proposal .disclosure-pill").textContent();
check("iframe shows disclosure", label === "Ambientación virtual · Mobiliario agregado digitalmente");
const wa = await frame.locator(".sc-contact a").first().getAttribute("href");
const text = new URL(wa).searchParams.get("text");
check("WhatsApp context", wa.startsWith("https://wa.me/5492235551234") && text.includes("Depto 3 ambientes en Güemes") && text.includes("Nórdico") && text.includes("Living comedor") && text.includes(`${APP}/ficha/${token}`), text.replace(/\n/g, " | "));
await page.waitForTimeout(800);
const h2 = await page.$eval("iframe", (f) => f.getBoundingClientRect().height);
check("iframe height follows content", h2 !== 760 && h2 > 320, `${h1} -> ${h2}`);
await page.screenshot({ path: "/tmp/iframe.png" });
const blocked = await browser.newPage();
const errors = [];
blocked.on("console", (m) => errors.push(m.text()));
await blocked.goto("http://127.0.0.1:4000/blocked");
await blocked.waitForTimeout(2000);
const blockedText = await blocked.frames()[1]?.evaluate(() => document.body?.innerText || "").catch(() => "");
check("shared page refuses to be framed", !String(blockedText).includes("Güemes"), errors.slice(0, 1).join(" ").slice(0, 120));
// Turning the link off
await fetch(MOCK + "/__active?value=false");
check("off: ficha 404", (await get(`/ficha/${token}`)).status === 404);
const off = await get(`/embed/ficha/${token}`);
check("off: embed 404", off.status === 404 && (await off.text()).includes("no está disponible"));
check("off: images 404", (await img(`p-${ids.reviewed}`))[0] === 404 && (await img(`o-${livingRoom.id}`))[0] === 404);
await page.reload();
await page.waitForTimeout(1500);
const offText = await page.frames()[1].evaluate(() => document.body.innerText);
check("off: open iframe shows unavailable on reload", offText.includes("no está disponible"));
await fetch(MOCK + "/__active?value=true");
check("on again", (await get(`/ficha/${token}`)).status === 200);
await browser.close();
parent.close();
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);

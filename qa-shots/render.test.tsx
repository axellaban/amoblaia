// QA only (rama descartable): renderiza las dos variantes de precios con el catálogo real y globals.css.
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { it, vi } from "vitest";
vi.mock("posthog-js", () => ({ default: { __loaded: false } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/panel/creditos", useRouter: () => ({ push() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { PricingPlans } from "@/components/pricing";
import { PanelNav } from "@/components/panel-shell";
import type { Product } from "@/lib/commerce/catalog";
import { Coins } from "lucide-react";

const pack = (sku: string, photos: number, price: number): Product => ({ sku, name: `${photos} créditos`, kind: "pack", photos, versions: 3, price_cents: price, active: true, valid_days: 365 });
const catalog = [pack("pack-10", 10, 990000), pack("pack-25", 25, 1990000), pack("pack-50", 50, 3490000), pack("pack-100", 100, 5990000)];
const page = (body: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap">
<style>:root{--font-manrope:'Manrope'}</style><link rel="stylesheet" href="globals.css"></head><body>${body}</body></html>`;

it("renders", () => {
  mkdirSync("qa-shots/out", { recursive: true });
  copyFileSync("src/app/globals.css", "qa-shots/out/globals.css");
  const pub = renderToStaticMarkup(<PricingPlans products={catalog} enabled={false} />);
  writeFileSync("qa-shots/out/precios.html", page(`<main>${pub}</main>`));
  writeFileSync("qa-shots/out/precios-abierto.html", page(`<main>${pub.replace(/<details /g, "<details open ")}</main>`));
  const plans = renderToStaticMarkup(<PricingPlans products={catalog} enabled surface="panel" email="x@y.com" />);
  const panel = renderToStaticMarkup(
    <main>
      <PanelNav section="creditos" agencyName="Inmobiliaria Demo" role="owner" credits={7} />
      <div className="account-page container ap-page">
        <div className="ap-head"><div><span className="eyebrow">Créditos IA de Inmobiliaria Demo</span><h1>Tus créditos</h1></div></div>
        <p className="ap-balance"><span className="ap-balance-icon" aria-hidden="true"><Coins size={24} /></span><span><small>Tu saldo actual</small><strong>7 créditos disponibles</strong></span></p>
        <div className="ap-plans" dangerouslySetInnerHTML={{ __html: plans }} />
        <section className="account-panel"><h2>Quién paga</h2><p>Las ambientaciones de las propiedades de Inmobiliaria Demo usan un solo saldo: el de la cuenta dueña de la inmobiliaria (tu cuenta). Lo que compres con esta cuenta suma a ese saldo.</p></section>
      </div>
    </main>,
  );
  writeFileSync("qa-shots/out/panel.html", page(panel));
});

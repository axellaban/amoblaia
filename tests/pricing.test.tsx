import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({ default: { __loaded: false } }));

import { PricingPlans } from "@/components/pricing";
import type { Product } from "@/lib/commerce/catalog";
import { UX_VERSIONS } from "@/lib/ux-context";

const pack = (sku: string, photos: number, price: number): Product => ({
  sku,
  name: `${photos} créditos`,
  kind: "pack",
  photos,
  versions: 3,
  price_cents: price,
  active: true,
  valid_days: 365,
});
const catalog = [pack("pack-10", 10, 990000), pack("pack-25", 25, 1990000), pack("pack-50", 50, 3490000), pack("pack-100", 100, 5990000)];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ids = (html: string) => [...html.matchAll(/data-cta="([^"]+)"/g)].map((m) => m[1]);

describe("the public pricing (/precios)", () => {
  const html = renderToStaticMarkup(<PricingPlans products={catalog} enabled={false} />);
  const t = text(html);

  it("shows the free plan next to the four packs, with total, price per credit and saving", () => {
    expect(t).toContain("Precios simples. Sin suscripción.");
    expect(t).toContain("Plan Gratis");
    expect(t).toContain("Empezar gratis");
    expect(html.match(/class="hb-pack[ "]/g)).toHaveLength(4);
    for (const price of ["$9.900", "$19.900", "$34.900", "$59.900"]) expect(t).toContain(price);
    for (const unit of ["$990 por crédito", "$796 por crédito", "$698 por crédito", "$599 por crédito"]) expect(t).toContain(unit);
  });

  it("computes the savings from the catalog against the 10-credit pack", () => {
    expect(t).toContain("Ahorrás 20%");
    expect(t).toContain("Ahorrás 29%");
    expect(t).toContain("Ahorrás 39%");
    // Other prices, other savings: nothing is fixed in the page.
    const other = text(renderToStaticMarkup(<PricingPlans products={[pack("pack-10", 10, 1000000), pack("pack-25", 25, 2000000)]} enabled={false} />));
    expect(other).toContain("Ahorrás 20%");
    expect(other).not.toContain("Ahorrás 29%");
  });

  it("marks the 25-credit pack as recommended and starts with it selected", () => {
    const recommended = html.match(/<label class="hb-pack[^"]*is-recommended[^"]*">[\s\S]*?<\/label>/)?.[0] ?? "";
    expect(recommended).toContain("Recomendado");
    expect(recommended).toContain('value="pack-25"');
    expect(recommended).toContain("is-selected");
    expect(html.match(/is-selected/g)).toHaveLength(1);
  });

  it("keeps «Empezar gratis» and «Comprar créditos» as separate actions, the purchase carrying the chosen pack", () => {
    expect(ids(html)).toEqual(expect.arrayContaining(["pricing_start_free", "pricing_buy_credits"]));
    expect(html).toMatch(/data-cta="pricing_buy_credits"[^>]*data-cta-plan="pack-25"/);
    expect(t).toContain("Créditos válidos por 12 meses");
  });

  it("shows the impact figures with their sources, says what they are, and adds the calculator", () => {
    for (const figure of ["+19%", "3×", "95%"]) expect(t).toContain(figure);
    for (const source of ["RESA · 2023", "Lemon &amp; Lime · 2025", "Matterport · Real Estate"]) expect(html).toContain(source);
    expect(t).toContain("No son resultados medidos de habita");
    expect(t).toContain("¿Cuánto podrías ganar con una mejor venta?");
    expect(t).toContain("+US$ 7.500");
    expect(t).toContain("+US$ 225");
    expect(html).toContain('href="https://matterport.com/industries/real-estate"');
    expect(html).toMatch(/rel="noopener noreferrer"/);
  });

  it("folds how credits work, what is included and the FAQ, each once, and keeps the anchors", () => {
    expect(html.match(/<details/g)).toHaveLength(3);
    expect(html).toContain('id="como-funcionan-los-creditos"');
    expect(html).toContain('id="precios"');
    expect(t.match(/¿Qué es un crédito\?/g)).toHaveLength(1);
    expect(t).toContain("Copiar link de precios");
    expect(t).toContain("Enviar por WhatsApp");
  });
});

describe("the panel's pricing (/panel/creditos)", () => {
  const html = renderToStaticMarkup(<PricingPlans products={catalog} enabled surface="panel" email="duenio@inmobiliaria.com" balance={3} />);
  const t = text(html);

  it("offers the packs and the purchase, never «Empezar gratis»", () => {
    expect(t).not.toContain("Empezar gratis");
    expect(t).not.toContain("Plan Gratis");
    expect(ids(html)).not.toContain("pricing_start_free");
    expect(html.match(/class="hb-pack[ "]/g)).toHaveLength(4);
    expect(t).toContain("Comprar créditos");
    const buy = html.match(/<button[^>]*data-cta="pricing_buy_credits"[^>]*>/)?.[0];
    expect(buy).toBeTruthy();
    expect(buy).not.toContain("disabled");
  });

  it("leaves the balance to the panel (the agency's, not the signed-in account's)", () => {
    expect(t).not.toContain("Tenés 3");
  });

  it("keeps the note for accounts with an older plan", () => {
    const legacy = text(renderToStaticMarkup(<PricingPlans products={catalog} enabled surface="panel" email="a@b.com" currentSku="basic-month" />));
    expect(legacy).toContain("Tenés un plan activo");
  });
});

describe("an agency's demo", () => {
  it("still starts with the invitation, for free or buying", () => {
    const html = renderToStaticMarkup(<PricingPlans products={catalog} enabled={false} signupHref="/panel/empezar?codigo=x" />);
    expect(html).toContain('href="/panel/empezar?codigo=x"');
    expect(html).toMatch(/data-cta="pricing_buy_credits"[^>]*data-cta-destination="signup_invitation"/);
  });
});

describe("pricing UX version", () => {
  it("is v2 after the redesign", () => {
    expect(UX_VERSIONS.pricing).toBe(2);
  });
});

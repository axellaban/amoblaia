import { expect, test } from "@playwright/test";
import { blockTracking, collectErrors, expectNoSideScroll, realErrors } from "./support";

// A published demo of the team (DEMO_TOKEN) and, optionally, its private invitation (DEMO_CODE).
// Only reads: no form is sent, so the invitation is never used.
const TOKEN = process.env.DEMO_TOKEN || "";
const CODE = process.env.DEMO_CODE || "";
// The pixel error on invitation pages is checked in app-shell.e2e.ts; here it would only repeat.
const withoutPixel = (errors: string[]) => realErrors(errors).filter((e) => !/fbq/.test(e));

test.describe("demo comercial", () => {
  test.skip(!TOKEN, "Definí DEMO_TOKEN para probar una demo publicada");

  test("enlace del comprador: fotos, flechas y estilos", async ({ page }) => {
    await blockTracking(page);
    const errors = collectErrors(page);
    await page.goto(`/demo/${TOKEN}`, { waitUntil: "load" });
    await expect(page.locator(".dv2-page")).toBeVisible();
    const counter = page.locator(".dv2-counter");
    await expect(counter).toHaveText(/^1 \/ \d+$/);
    const next = page.getByRole("button", { name: "Foto siguiente" });
    if (await next.isVisible()) {
      await next.click();
      await expect(counter).toHaveText(/^2 \/ \d+$/);
      await page.getByRole("button", { name: "Foto anterior" }).click();
      await expect(counter).toHaveText(/^1 \/ \d+$/);
    }
    await expectNoSideScroll(page);
    expect(withoutPixel(errors)).toEqual([]);
  });

  test("presentación con invitación: entra al alta sin perder la demo y vuelve", async ({ page }) => {
    test.skip(!CODE, "Definí DEMO_CODE para probar la invitación");
    await blockTracking(page);
    const errors = collectErrors(page);
    await page.goto(`/demo/${TOKEN}?presentacion=1&codigo=${encodeURIComponent(CODE)}`, { waitUntil: "load" });
    const owner = page.locator(".dv2-owner");
    if (!(await owner.isVisible())) {
      // The invitation was used or replaced: the demo says so instead of promising a panel.
      await expect(page.getByText("ya no está disponible").first()).toBeVisible();
      return;
    }
    await expect(owner.getByText("Modo demostración").first()).toBeVisible();
    await expectNoSideScroll(page);
    await owner.locator(".dv2-owner-nav a", { hasText: "Imágenes" }).click();
    await page.waitForURL(/\/panel\/empezar\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("codigo"), "el código viaja al alta").toBe(CODE);
    expect(url.searchParams.get("demo"), "la demo viaja al alta").toBe(TOKEN);
    await expect(page.locator("h1").first()).toBeVisible();
    await expectNoSideScroll(page);
    const email = page.locator('input[type="email"]');
    if (await email.isVisible()) {
      await expect(email).toHaveAttribute("autocomplete", "email");
      await expect(page.locator('input[autocomplete="new-password"], input[autocomplete="current-password"]')).toBeVisible();
      await expect(page.getByRole("button", { name: /Entrar/ })).toBeEnabled();
      const back = page.getByRole("link", { name: "Volver a la demo" });
      if (await back.count()) {
        await back.click();
        await page.waitForURL(new RegExp(`/demo/${TOKEN}\\?`));
        expect(new URL(page.url()).searchParams.get("presentacion")).toBe("1");
      }
    }
    expect(withoutPixel(errors)).toEqual([]);
  });
});

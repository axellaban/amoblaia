import { expect, test } from "@playwright/test";
import { blockTracking, collectErrors, expectNoSideScroll, realErrors } from "./support";

// Public pages of both funnels: they load, fit a phone and throw nothing.
const PAGES = ["/", "/precios", "/galeria", "/estudio", "/acceso", "/faq"];

test.describe("páginas públicas", () => {
  for (const path of PAGES)
    test(`${path} carga sin errores`, async ({ page }) => {
      await blockTracking(page);
      const errors = collectErrors(page);
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status(), "status HTTP").toBeLessThan(400);
      await page.waitForLoadState("load");
      await expect(page.locator("h1").first()).toBeVisible();
      await expectNoSideScroll(page);
      expect(realErrors(errors)).toEqual([]);
    });
});

test.describe("Meta Pixel", () => {
  test("una URL con código de invitación no carga el Pixel ni tira errores", async ({ page }) => {
    await blockTracking(page);
    const errors = collectErrors(page);
    await page.goto("/precios?codigo=e2eCodigoDePruebaNoValido123", { waitUntil: "load" });
    await page.waitForTimeout(1500);
    expect(errors.filter((e) => /fbq/.test(e)), "errores de fbq").toEqual([]);
    expect(await page.evaluate(() => typeof (window as { fbq?: unknown }).fbq)).toBe("undefined");
  });
  test("sin código el Pixel queda listo", async ({ page }) => {
    test.skip(!process.env.E2E_PIXEL, "solo con un build que tenga Pixel (E2E_PIXEL=1)");
    await blockTracking(page);
    await page.goto("/precios", { waitUntil: "load" });
    await expect.poll(() => page.evaluate(() => typeof (window as { fbq?: unknown }).fbq)).toBe("function");
  });
});

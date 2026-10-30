import { expect, type Page } from "@playwright/test";

/** Nothing a test does reaches analytics, ads or the team's demo activity list. */
export async function blockTracking(page: Page) {
  await page.route(/\/ingest\//, (r) => r.abort());
  await page.route(/\/api\/demo\/[^/]+\/actividad/, (r) => r.fulfill({ status: 204, body: "" }));
  await page.route(/\/api\/meta-capi/, (r) => r.fulfill({ status: 204, body: "" }));
  await page.route(/connect\.facebook\.net|facebook\.com\/tr|googletagmanager|google-analytics|googleadservices|doubleclick/, (r) => r.abort());
}

/** Errors the page throws or logs while the test runs. */
export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

// Requests the test itself blocked, and third-party noise documented in docs/QA_FUNNEL_2026-10-29.md.
const NOISE = [/Failed to load resource/, /net::ERR_/, /FedCM/, /GSI_LOGGER/, /Java object is gone/];
export const realErrors = (errors: string[]) => errors.filter((e) => !NOISE.some((n) => n.test(e)));

/** The page fits the screen: nothing scrolls sideways on a phone. */
export async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(1);
}

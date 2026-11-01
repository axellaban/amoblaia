// The second strategy for pages the direct request cannot read (403/503,
// bot checks, timeouts or pages drawn by JavaScript): an external rendering
// service, behind one interface so the vendor can be changed.
//
// None is active until one is chosen and approved (cost and terms): with
// SCRAPER_PROVIDER unset the importer reports the block and offers the manual
// fallback instead of pretending the page was read. A provider is only given
// URLs that already passed checkUrl, never used to get past logins, captchas
// or paywalls, and only for sites the agency publishes and authorizes.
import "server-only";

export type RenderResult = { html: string; finalUrl: string; status: number };

export interface RenderProvider {
  /** Short name for diagnostics ("scrapingbee"…); never includes credentials. */
  readonly id: string;
  render(url: URL, options: { timeoutMs: number }): Promise<RenderResult>;
}

/** Providers implemented in code, by the name SCRAPER_PROVIDER takes. Empty until one is approved. */
const PROVIDERS: Record<string, () => RenderProvider | null> = {};

/** The configured provider, or null (also when the name is unknown or its credentials are missing). */
export function renderProvider(env: Record<string, string | undefined> = process.env): RenderProvider | null {
  const name = env.SCRAPER_PROVIDER?.trim().toLowerCase();
  if (!name) return null;
  return PROVIDERS[name]?.() ?? null;
}

/** For tests and for a future adapter: registers one by name. */
export function registerRenderProvider(name: string, make: () => RenderProvider | null) {
  PROVIDERS[name.toLowerCase()] = make;
}

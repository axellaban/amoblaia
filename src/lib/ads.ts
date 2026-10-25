// Google Ads measurement. The tag only loads on the production deployment
// (see the root layout), so previews and local runs never report conversions.
export const GOOGLE_ADS_ID = "AW-18500028132";

// "amoblaIA | Foto subida": a photo of the visitor's own reached the server
// and a generation started. Demo examples never count.
const PHOTO_UPLOADED = `${GOOGLE_ADS_ID}/4ytSCNWLsqYdEOSNwPVE`;

// "amoblaIA | Foto descargada": a click on a button that saves a design
// (JPG, before/after, share sheet or the batch download).
const PHOTO_DOWNLOADED = `${GOOGLE_ADS_ID}/jPd2CKfU1KkdEOSNwPVE`;

// Ad click identifiers the tag reads from the landing URL.
const CLICK_IDS = ["gclid", "gbraid", "wbraid"];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function conversion(sendTo: string) {
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function")
      window.gtag("event", "conversion", { send_to: sendTo });
  } catch {
    /* Tracking is best effort: blocked or missing tags never break the app. */
  }
}

export function trackPhotoUploaded() {
  conversion(PHOTO_UPLOADED);
}

/** Call it synchronously from the click handler, before the download starts. */
export function trackPhotoDownload() {
  conversion(PHOTO_DOWNLOADED);
}

/**
 * Carries the ad click identifiers of `search` over to an internal path, so
 * a redirect that fires before the tag stores its cookie keeps the click.
 */
export function withClickIds(path: string, search: string | URLSearchParams) {
  const from = new URLSearchParams(search);
  const [base, hash = ""] = path.split("#", 2);
  const url = new URL(base, "https://amoblaia.invalid");
  for (const key of CLICK_IDS) {
    const value = from.get(key);
    if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}${hash ? `#${hash}` : ""}`;
}

/** Client-side redirect that keeps the ad click identifiers of this page. */
export function redirectKeepingClick(path: string) {
  window.location.assign(withClickIds(path, window.location.search));
}

// Google Ads measurement. The tag only loads on the production deployment
// (see the root layout), so previews and local runs never report conversions.
export const GOOGLE_ADS_ID = "AW-18500028132";

// "amoblaIA | Foto subida": a photo of the visitor's own reached the server
// and a generation started. Demo examples never count.
const PHOTO_UPLOADED = `${GOOGLE_ADS_ID}/4ytSCNWLsqYdEOSNwPVE`;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackPhotoUploaded() {
  if (typeof window === "undefined") return;
  window.gtag?.("event", "conversion", { send_to: PHOTO_UPLOADED });
}

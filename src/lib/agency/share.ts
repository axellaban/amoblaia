// Sharing a property from the browser, reporting what really happened:
// shared (native share resolved, or the link copied), cancelled, or failed.
// Opening WhatsApp only opens it: it is not counted as sent.
import { track } from "@/lib/analytics";

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/** Native share when available; otherwise (or if it fails) the clipboard. */
export async function shareLink(link: string, title: string, propertyId: string): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url: link });
      track("property_shared", { property_id: propertyId, channel: "native" });
      return "shared";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        track("property_share_cancelled", { property_id: propertyId, channel: "native" });
        return "cancelled";
      }
      // Not allowed here (permissions, insecure context): fall back to copying.
    }
  }
  return copyLink(link, propertyId);
}

/** Copies the link; "copied" only once the clipboard confirmed it. */
export async function copyLink(link: string, propertyId: string): Promise<ShareOutcome> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("NO_CLIPBOARD");
    await navigator.clipboard.writeText(link);
    track("property_shared", { property_id: propertyId, channel: "clipboard" });
    return "copied";
  } catch {
    track("property_share_failed", { property_id: propertyId, channel: "clipboard" });
    return "failed";
  }
}

/** The WhatsApp app or site opens with the link prepared; whether it is sent is not known. */
export function whatsappOpened(propertyId: string) {
  track("property_share_opened", { property_id: propertyId, channel: "whatsapp" });
}

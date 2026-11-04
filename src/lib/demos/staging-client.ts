import { internalHint } from "@/lib/internal/client";
import { visitorId } from "./activity-client";

/**
 * Asks the server to generate one style of a demo photo with the agency's gift
 * credits. `code` is the agency's invitation (the server checks it belongs to
 * this demo's agency). The key identifies this try, so a repeated request never
 * spends twice. Returns the gift credits left, or the server's message when the
 * try was refused.
 */
export async function requestPublicStaging(
  token: string,
  photoId: string,
  style: string,
  code: string,
): Promise<{ ok: true; remaining: number | null } | { ok: false; error: string }> {
  try {
    const r = await fetch(`/api/demo/${encodeURIComponent(token)}/generar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitor: visitorId(), key: crypto.randomUUID(), photo: photoId, style, code, internal: internalHint() }),
    });
    const payload = (await r.json().catch(() => ({}))) as { error?: string; remaining?: unknown };
    if (r.ok) return { ok: true, remaining: typeof payload.remaining === "number" ? payload.remaining : null };
    return { ok: false, error: payload.error || "No pudimos generar esta versión. Probá de nuevo." };
  } catch {
    return { ok: false, error: "No pudimos conectarnos. Revisá la conexión y probá de nuevo." };
  }
}

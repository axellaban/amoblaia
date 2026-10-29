import { visitorId } from "./activity-client";

/**
 * Asks the server to generate one style of a demo photo with the agency's gift
 * credits. The key identifies this try, so a repeated request never spends twice.
 * Returns the server's message when the try was refused.
 */
export async function requestPublicStaging(token: string, photoId: string, style: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  try {
    const r = await fetch(`/api/demo/${encodeURIComponent(token)}/generar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitor: visitorId(), key: crypto.randomUUID(), photo: photoId, style }),
    });
    if (r.ok) return { ok: true };
    const payload = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: payload.error || "No pudimos generar esta versión. Probá de nuevo.", status: r.status };
  } catch {
    return { ok: false, error: "No pudimos conectarnos. Revisá la conexión y probá de nuevo.", status: 0 };
  }
}

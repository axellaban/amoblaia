/** The browser's visitor id: random, kept locally, never personal data. Best effort: storage may be blocked. */
const VISITOR_KEY = "habita_visitante";

export function visitorId() {
  try {
    const saved = localStorage.getItem(VISITOR_KEY);
    if (saved && /^[A-Za-z0-9-]{8,64}$/.test(saved)) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, fresh);
    return fresh;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

const viewed = new Set<string>();

/**
 * True only the first time a demo is shown in this page load. The page
 * refreshes its data while an image is generated (router.refresh every few
 * seconds), which re-ran the view effect and counted the visit again.
 */
export function firstViewOf(key: string) {
  if (viewed.has(key)) return false;
  viewed.add(key);
  return true;
}

/**
 * Reports one step of the visitor on a demo to the team's list. Fire and
 * forget: a failed report never shows anything to the visitor.
 */
export function reportDemoActivity(token: string, kind: "visita" | "interaccion" | "descarga" | "generacion") {
  fetch(`/api/demo/${encodeURIComponent(token)}/actividad`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor: visitorId(), kind }),
    keepalive: true,
  }).catch(() => undefined);
}

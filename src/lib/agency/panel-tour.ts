// The panel's welcome tour (src/components/panel-tour.tsx): its version and
// who it starts by itself for. Client-safe and pure.

/** Raise it when the tour's steps change enough to show it again; it travels on every tour event. */
export const TOUR_VERSION = 1;

/** "New": joined this agency's panel at most this many days ago. Older accounts open it from «Ayuda». */
export const NEW_MEMBER_DAYS = 14;

/** Window event that starts the tour again (the panel's «Ayuda → Volver a ver el recorrido» on the home). */
export const PANEL_TOUR_EVENT = "habita:panel-tour";
/** The home's query that starts it when «Volver a ver el recorrido» is chosen on another page. */
export const PANEL_TOUR_QUERY = "recorrido";
/** Window event that opens (detail true) or closes (false) the panel's mobile menu, for the tour's steps in it. */
export const PANEL_MENU_EVENT = "habita:panel-menu";

/**
 * Whether the tour starts by itself: an account of the agency (never the
 * team's support view), that has not seen it yet and joined recently.
 */
export function tourEligible({
  seenAt,
  joinedAt,
  support = false,
  now = Date.now(),
}: {
  seenAt: string | null | undefined;
  joinedAt: string | null | undefined;
  support?: boolean;
  now?: number;
}) {
  if (support || seenAt || !joinedAt) return false;
  const joined = Date.parse(joinedAt);
  if (!Number.isFinite(joined)) return false;
  return now - joined <= NEW_MEMBER_DAYS * 24 * 60 * 60 * 1000;
}

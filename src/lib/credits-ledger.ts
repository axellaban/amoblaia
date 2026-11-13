/** What each credit movement reads as in the agency's panel («Últimos movimientos»). */
const REASONS: Record<string, string> = {
  photo_reserved: "Foto ambientada",
  video_reserved: "Video",
  video_refund: "Devolución de video",
  technical_failure: "Devolución por falla técnica",
  payment: "Compra",
  free_monthly: "Créditos gratis del mes",
  annual_period: "Plan anual",
  // Welcome credits and the team's grants share this reason.
  admin_adjustment: "Créditos de habita",
  trial: "Prueba",
};

/** Never the internal code: a reason without a label reads as a plain movement. */
export const ledgerLabel = (reason: string) => REASONS[reason] ?? "Movimiento de créditos";

/** A movement only shows when it moved credits (`free_results_enabled` is a 0 marker). */
export const visibleMovement = (m: { delta: number }) => m.delta !== 0;

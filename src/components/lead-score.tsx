import { classLabel } from "@/lib/leads/score";

/**
 * The Lead Engagement Score as a small badge: the number and its class.
 * Engagement observed, never a probability of buying. `null` is "no
 * external activity" (only the team, or nobody yet).
 */
export function LeadBadge({ score, classification, partial = false, compact = false }: { score: number | null; classification: string | null; partial?: boolean; compact?: boolean }) {
  if (score === null || !classification)
    return (
      <span className="ld-badge is-none" title="Sin visitas externas: las del equipo no cuentan">
        {compact ? "—" : "Sin actividad externa"}
      </span>
    );
  const label = classLabel(classification);
  return (
    <span
      className={`ld-badge is-${classification}`}
      title={`Lead score ${score}/100 · ${label}${partial ? " · histórico parcial" : ""}. Mide engagement observado, no probabilidad de compra.`}
    >
      <b>{score}</b>
      {!compact && <span>{label}</span>}
      {partial && <i aria-label="histórico parcial">*</i>}
    </span>
  );
}

// Analytics properties of a listing import (spec §8): platform, strategy,
// photos, missing fields, price status and duration. Never the raw URL, the
// page's text or anything typed: only the site's host, as the importer's
// existing events already do.
import type { ImportDiagnostics } from "./types";

export type ImportEventProps = Record<string, string | number | boolean>;

export function importEventProps(d: ImportDiagnostics | undefined, extra: ImportEventProps = {}): ImportEventProps {
  if (!d) return extra;
  return {
    platform: d.platform,
    strategy: d.strategy,
    photos_found: d.photosFound,
    missing_fields: d.missing.join(",") || "none",
    missing_count: d.missing.length,
    price_status: d.priceStatus,
    conflicts: d.conflicts.length,
    ...(d.durationMs !== null ? { duration_ms: d.durationMs } : {}),
    ...extra,
  };
}

/** The error code the importer's API returned ("blocked", "challenge"…) or the HTTP status. */
export const importErrorCode = (status: number | undefined, body: Record<string, unknown> | null | undefined) =>
  typeof body?.code === "string" ? body.code : status ? `http_${status}` : "network";

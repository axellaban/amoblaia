// The preview's snapshot is saved in property_imports.snapshot, whose check
// refused the v2 format and broke every import in production (PR #132).
// These tests hold the code to the check as the migrations define it.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ adminClient: () => ({}) }));
import { legacySnapshotOf, SNAPSHOT_MAX, SNAPSHOT_PATTERN, snapshotOf, storableSnapshot } from "@/lib/agency/imports";
import type { ImportedDemo } from "@/lib/demos/import";
import { snapshotRule } from "./helpers/db-checks";

const listing = (photos: number) =>
  ({
    title: "Venta de Casa 3 ambientes en Miramar",
    location: "Miramar",
    operation: "Venta",
    price: "USD 95.000",
    priceConflict: null,
    description: "Casa luminosa con patio. ".repeat(200),
    images: Array.from({ length: photos }, (_, i) => `https://www.freijo.com.ar/fotos/propiedad-${i}-muy-larga.jpg?v=${i}`),
    map: null,
    mapStatus: "none",
  }) as unknown as ImportedDemo;

describe("property_imports.snapshot", () => {
  const db = snapshotRule();

  it("accepts the v2 snapshot the import saves, also of a listing with many photos", () => {
    for (const photos of [0, 1, 40, 500, 3000]) {
      const s = snapshotOf(listing(photos));
      expect(s).toMatch(/^v2\./);
      expect(db.accepts(s)).toBe(true);
      expect(storableSnapshot(s)).toBe(true);
    }
  });

  it("still accepts the old hex snapshot", () => {
    expect(db.accepts(legacySnapshotOf(listing(3)))).toBe(true);
  });

  it("refuses anything else, like the database", () => {
    for (const bad of ["", "v2.", "v2.a b", "v3.abc", "0".repeat(63), `v2.${"a".repeat(db.max)}`]) {
      expect(db.accepts(bad)).toBe(false);
      expect(storableSnapshot(bad)).toBe(false);
    }
  });

  it("the code's pattern and limit are the migration's", () => {
    expect(SNAPSHOT_PATTERN.source).toBe(db.pattern);
    expect(SNAPSHOT_MAX).toBe(db.max);
  });
});

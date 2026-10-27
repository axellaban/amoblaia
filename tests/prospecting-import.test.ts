import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRows, guessMapping, normalizeWhatsapp, parseCsv, parseDay, parseNumber, preview } from "@/lib/prospecting/import";

// tests/fixtures/prospeccion-sintetica.csv is synthetic: names marked
// FICTICIA, numbers in a reserved-looking range, .test domains.
const csv = readFileSync("tests/fixtures/prospeccion-sintetica.csv", "utf8");

describe("Sheet import", () => {
  const parsed = parseCsv(csv);
  const mapping = guessMapping(parsed.headers);
  const rows = buildRows(parsed, mapping);

  it("parses quotes, escaped quotes and guesses the visible columns", () => {
    expect(parsed.headers).toHaveLength(25);
    expect(mapping).toMatchObject({
      name: "Inmobiliaria",
      score: "Score",
      whatsapp_link: "Abrir WhatsApp",
      phone: "Número sin 0 ni 15",
      phone_confidence: "Confianza número",
      phone_source: "Fuente número",
      status: "Estado",
      sent_date: "Fecha envío",
      pts_contact: "Puntos contacto",
      pts_decision: "Puntos quién decide",
      other_phones: "Otros teléfonos",
    });
    expect(rows[0].notes).toBe('corto v2, "muestra" sintética');
  });

  it("keeps score, its four components and every original cell; does not recompute", () => {
    expect(rows[0]).toMatchObject({ score: 96, score_components: { "Puntos contacto": 35, "Puntos quién decide": 30, "Puntos stock": 25, "Puntos actividad": 6, "Propiedades publicadas": 128 } });
    expect(rows[0].raw["Notas"]).toBe('corto v2, "muestra" sintética');
    expect(rows[3].score).toBeNull();
    expect(rows[3].messages.join(" ")).toMatch(/no es numérico/);
  });

  it("uses the WhatsApp link as is and never adds the 9 silently", () => {
    expect(rows[0].contacts[0]).toMatchObject({ channel: "whatsapp", address: "+5492230000101", needs_review: false });
    expect(rows[1].contacts[0]).toMatchObject({ address: "+5492230000202", needs_review: true });
    expect(normalizeWhatsapp("", "12345")).toMatchObject({ address: null });
  });

  it("a legacy send keeps day precision; a send without date and 'Número incorrecto' are explicit", () => {
    expect(rows[0]).toMatchObject({ legacy_status: "sent", sent_date: "2026-10-10" });
    expect(rows[3]).toMatchObject({ legacy_status: "sent", sent_date: null });
    expect(rows[3].messages.join(" ")).toMatch(/sin fecha válida/);
    expect(rows[2].contacts[0]).toMatchObject({ invalid: true, is_primary: false });
  });

  it("reports errors and repeated rows without dropping them", () => {
    expect(rows[4].error).toMatch(/Falta el nombre/);
    expect(rows[5].error).toMatch(/fila 2/);
  });

  it("proposes duplicates and matches for review, never merging", () => {
    const p = preview(rows, "planilla", [
      { id: "ag-1", name: "Ficticia Dos", website: null, account_id: null, source: null, source_key: null },
      { id: "ag-2", name: "Otra", website: null, account_id: "acc", source: "planilla", source_key: "nombre:ficticia-tres" },
    ]);
    expect(p[1]).toMatchObject({ action: "create", suggestion: { agencyId: "ag-1", reason: "mismo nombre" } });
    expect(p[2].action).toBe("update");
    expect(p[3].duplicates.join(" ")).toMatch(/fila 2 \(mismo dominio web\)/);
    // Generic mailboxes are not a duplicate signal.
    expect(p[1].duplicates).toEqual([]);
  });

  it("recognizes the real sheet's headers (scores with their scale)", () => {
    expect(
      guessMapping(["Score Habita /100", "Pts contacto /20", "Pts decisión /15", "Pts cartera /25", "Pts encaje /40", "Propiedades publicadas (Argenprop)", "Grupo Habita"]),
    ).toEqual({
      score: "Score Habita /100",
      pts_contact: "Pts contacto /20",
      pts_decision: "Pts decisión /15",
      pts_stock: "Pts cartera /25",
      pts_activity: "Pts encaje /40",
      listings: "Propiedades publicadas (Argenprop)",
    });
  });

  it("parses Argentine numbers and dates strictly", () => {
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("88")).toBe(88);
    expect(parseNumber("8 8")).toBeNull();
    expect(parseDay("1/2/26")).toBe("2026-02-01");
    expect(parseDay("31/02/2026")).toBeNull();
  });
});

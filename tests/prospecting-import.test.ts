import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRows, guessMapping, isSentStatus, normalizeWhatsapp, parseCsv, parseDay, parseNumber, parseStatus, preview } from "@/lib/prospecting/import";

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

  it("reads each new «Estado» exactly, ignoring case, accents and the kind of dash", () => {
    for (const [t, v] of [
      ["Pendiente", "pending"],
      ["Contactado", "sent"],
      ["Responde saludo inicial", "replied"],
      ["Neutro", "neutral"],
      ["Interesado", "interested"],
      ["Demo enviada", "demo_sent"],
      ["No interesado", "not_interested"],
      ["No interesado - cuenta con proveedor de IA", "not_interested_ai"],
      ["Sin WhatsApp", "invalid"],
      ["Número incorrecto", "invalid"],
      // Case, accents, spaces and dashes do not matter.
      ["  NO INTERESADO  ", "not_interested"],
      ["no interesado – cuenta con proveedor de ia", "not_interested_ai"],
      ["No interesado-Cuenta con proveedor de IA", "not_interested_ai"],
      ["numero incorrecto", "invalid"],
      ["RESPONDE  SALUDO  INICIAL", "replied"],
      ["", null],
      ["   ", null],
    ] as const)
      expect(parseStatus(t), t).toBe(v);
  });

  it("keeps the old names for the history", () => {
    for (const [t, v] of [
      ["Presentación enviada", "sent"],
      ["Presentacion enviada", "sent"],
      ["Enviado", "sent"],
      ["Esperando respuesta", "sent"],
      ["Respondió saludo", "replied"],
      ["Responde interesado", "interested"],
      ["Responde neutro", "neutral"],
      ["Responde no interesado", "not_interested"],
    ] as const)
      expect(parseStatus(t), t).toBe(v);
  });

  it("never reads a negative or unknown «Estado» as interested", () => {
    // The old patterns: /^no\b/ sent «No interesado» to unknown and /interesad/ counted «Responde no interesado» as interested.
    for (const t of ["No interesado", "Responde no interesado", "No interesado - cuenta con proveedor de IA"]) expect(parseStatus(t)).not.toBe("interested");
    for (const t of ["Interesada", "Demo en preparación", "No contactar", "Saludo", "Enviado ayer"]) expect(parseStatus(t), t).toBe("unknown");
  });

  it("counts every outcome after «Contactado» as sent, and nothing else", () => {
    const sent = ["Contactado", "Responde saludo inicial", "Neutro", "Interesado", "Demo enviada", "No interesado", "No interesado - cuenta con proveedor de IA"];
    for (const t of sent) expect(isSentStatus(parseStatus(t)), t).toBe(true);
    for (const t of ["Pendiente", "Sin WhatsApp", "Número incorrecto", "Demo en preparación", ""]) expect(isSentStatus(parseStatus(t)), t).toBe(false);
  });

  it("rows without a valid date keep their status and record no send", () => {
    const t = parseCsv(
      "Inmobiliaria,Estado,Fecha envío,Número (sin 0 ni 15)\n" +
        "FICTICIA Sin Fecha,Interesado,,2230000301\n" +
        "FICTICIA Fecha Rara,No interesado,mañana,2230000302\n" +
        "FICTICIA Con Fecha,Neutro,04/11/2026,2230000303\n" +
        "FICTICIA Sin WA,Sin WhatsApp,04/11/2026,2230000304\n",
    );
    const [noDate, badDate, dated, noWa] = buildRows(t, guessMapping(t.headers));
    expect(noDate).toMatchObject({ legacy_status: "interested", status_text: "Interesado", sent_date: null });
    expect(noDate.messages.join(" ")).toMatch(/«Interesado» sin fecha válida: no se registra el envío/);
    expect(badDate).toMatchObject({ legacy_status: "not_interested", sent_date: null });
    expect(badDate.messages.join(" ")).toMatch(/Fecha «mañana» no reconocida/);
    expect(dated).toMatchObject({ legacy_status: "neutral", sent_date: "2026-11-04" });
    // «Sin WhatsApp»: the contact is invalid and the row is not a send, even with a date.
    expect(noWa.legacy_status).toBe("invalid");
    expect(isSentStatus(noWa.legacy_status)).toBe(false);
    expect(noWa.contacts[0]).toMatchObject({ invalid: true, invalid_reason: "Planilla: Sin WhatsApp", is_primary: false });
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

  it("splits cells with several emails and keeps same-name branches apart", () => {
    const t = parseCsv(
      "Inmobiliaria,Email,Dirección\nFICTICIA Red,a@ficticia.test / b@ficticia.test,Calle 1\nFICTICIA Red,\"c@ficticia.test, d@ficticia.test\",Calle 2\nFICTICIA Red,,\n",
    );
    const r = buildRows(t, guessMapping(t.headers));
    expect(r[0].contacts.map((c) => c.address)).toEqual(["a@ficticia.test", "b@ficticia.test"]);
    expect(r[0].contacts.map((c) => c.is_primary)).toEqual([true, false]);
    expect(r[1]).toMatchObject({ source_key: "nombre:ficticia-red:dir:calle-2", error: null });
    expect(r[1].messages.join(" ")).toMatch(/fila 2 con otra dirección/);
    expect(r[2].error).toMatch(/Clave repetida/);
  });

  it("only the sheet's explicit 'WhatsApp verificado' counts as verified", () => {
    const t = parseCsv(
      "Inmobiliaria,Número (sin 0 ni 15),Confianza del número\nFICTICIA A,2230000011,WhatsApp verificado\nFICTICIA B,2230000012,Celular 223 (probable WhatsApp)\n",
    );
    const [a, b] = buildRows(t, guessMapping(t.headers));
    expect(a.contacts[0]).toMatchObject({ address: "+5492230000011", verified: true, needs_review: false });
    expect(a.messages).toEqual([]);
    expect(b.contacts[0]).toMatchObject({ verified: false, needs_review: true });
  });

  it("parses Argentine numbers and dates strictly", () => {
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("88")).toBe(88);
    expect(parseNumber("8 8")).toBeNull();
    expect(parseDay("1/2/26")).toBe("2026-02-01");
    expect(parseDay("31/02/2026")).toBeNull();
  });
});

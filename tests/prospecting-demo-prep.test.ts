import { beforeEach, describe, expect, it, vi } from "vitest";

// Lo que Prospectos deja listo para «Crear demo»: la lectura de prueba de cada aviso y, al pasar a
// Interesado, los tres avisos en su panel. La base, el lector y el importador son dobles. Datos sintéticos.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  reads: [] as string[],
  imports: [] as { url: string; key: string; agencyId: string; userId: string | null }[],
  targets: [] as { agencyId: string; properties: number; prepared: boolean }[],
  photoImports: [] as string[],
  photoResult: { total: 8, added: 8, already: 0, failed: 0, reasons: [] as string[], attempts: 1 },
  found: [] as { url: string; title: string | null; photos: number; interiors: number | null }[],
  discoveries: [] as { agencyId: string; want: number; exclude: string[] }[],
}));
vi.mock("@/lib/demos/auto-prep", () => ({
  importListingPhotos: async (demoId: string) => {
    state.photoImports.push(demoId);
    return state.photoResult;
  },
}));
vi.mock("@/lib/agency/preload-discovery", () => ({
  findPreloads: async (agencyId: string, o: { want: number; exclude: string[] }) => {
    state.discoveries.push({ agencyId, want: o.want, exclude: o.exclude });
    return state.found.slice(0, o.want);
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => {
  const query = (table: string) => {
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let patch: Record<string, unknown> | null = null;
    const rows = () => (state.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const q: Record<string, unknown> = {
      select: () => q,
      limit: () => q,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
      update: (p: Record<string, unknown>) => ((patch = p), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (patch) for (const r of rows()) Object.assign(r, structuredClone(patch));
        return resolve({ data: patch ? null : rows(), error: null });
      },
    };
    return q;
  };
  return { adminClient: () => ({ from: query, auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } } }) };
});
vi.mock("@/lib/demos/listing", () => ({
  readListing: async (url: string) => {
    state.reads.push(url);
    if (url.includes("bloqueada")) throw new Error("El sitio bloquea la lectura.");
    return { listingUrl: url, imported: { title: `Ficha ${url.slice(-1)}`, images: url.includes("sin-fotos") ? [] : ["a.jpg", "b.jpg", "c.jpg"] } };
  },
}));
vi.mock("@/lib/agency/import-flow", () => ({
  importListing: async (request: Request, target: { agencyId: string; userId: string | null }) => {
    const body = (await request.json()) as { url: string; key: string };
    state.imports.push({ ...body, ...target });
    if (body.url.includes("ya-esta")) return Response.json({ error: "Esta propiedad ya está en tu panel.", duplicateOf: uuid(77) }, { status: 409 });
    if (body.url.includes("falla")) return Response.json({ error: "No pudimos leer la publicación." }, { status: 422 });
    return Response.json({ id: uuid(60 + state.imports.length), photosTotal: 3 }, { status: 201 });
  },
}));
vi.mock("@/lib/followup/server", () => ({ demoPrepTargets: async () => state.targets }));
import { checkListings, checkPendingListings, prepareDemo, prepareInterested } from "../src/lib/prospecting/demo-prep";
import { prepDue, type Profile } from "../src/lib/prospecting/pool";

const URL1 = "https://ficticia.test/propiedad/1";
const URL2 = "https://ficticia.test/propiedad/2";
const URL3 = "https://ficticia.test/propiedad/3";
const profile = (n: number, values: Record<string, unknown>, o: Record<string, unknown> = {}) => ({ account_id: uuid(n), status: "calificado", profile: values, listing_checks: {}, demo_prep: null, ...o });
type StoredRow = { profile: Record<string, unknown>; listing_checks: Record<string, Record<string, unknown>>; demo_prep: { at: string } & Record<string, unknown> };
const row = (n: number) => state.tables.prospect_profiles.find((r) => r.account_id === uuid(n)) as unknown as StoredRow;

beforeEach(() => {
  state.photoImports = [];
  state.photoResult = { total: 8, added: 8, already: 0, failed: 0, reasons: [], attempts: 1 };
  state.found = [];
  state.discoveries = [];
  state.reads = [];
  state.imports = [];
  state.targets = [];
  state.tables = {
    prospect_profiles: [
      profile(1, { demo_listing_url: URL1, demo_preload_url_2: URL2, demo_preload_url_3: URL3 }),
      profile(2, { demo_listing_url: "https://ficticia.test/bloqueada/1", demo_preload_url_2: "https://ficticia.test/sin-fotos/2" }, { status: "en_cola" }),
      profile(3, {}, { status: "descubierto" }),
    ],
    prospect_accounts: [{ id: uuid(1), agency_id: uuid(101) }, { id: uuid(2), agency_id: uuid(102) }, { id: uuid(3), agency_id: uuid(103) }],
  };
});

describe("lectura de prueba de los avisos", () => {
  it("lee los que faltan, guarda fotos o el motivo y no vuelve a leer los ya leídos", async () => {
    const r = await checkListings(uuid(2));
    expect(r.checked).toBe(2);
    const checks = row(2).listing_checks;
    expect(checks["https://ficticia.test/bloqueada/1"]).toMatchObject({ ok: false, error: "El sitio bloquea la lectura." });
    expect(checks["https://ficticia.test/sin-fotos/2"]).toMatchObject({ ok: false, photos: 0, error: "La publicación no trae fotos." });
    expect((await checkListings(uuid(2))).checked).toBe(0);
    expect((await checkListings(uuid(2), { force: true })).checked).toBe(2);
    expect(state.imports).toEqual([]);
  });

  it("olvida la lectura de un aviso que se reemplazó", async () => {
    await checkListings(uuid(1));
    row(1).profile.demo_preload_url_3 = "https://ficticia.test/propiedad/9";
    await checkListings(uuid(1));
    expect(Object.keys(row(1).listing_checks).sort()).toEqual([URL1, URL2, "https://ficticia.test/propiedad/9"].sort());
  });

  it("la tanda empieza por las que están en la cola y respeta el límite", async () => {
    const r = await checkPendingListings({ limit: 1 });
    expect(r).toEqual({ checked: 2, accounts: 1 });
    expect(state.reads.every((u) => u.includes("bloqueada") || u.includes("sin-fotos"))).toBe(true);
  });
});

describe("preparar la demo al pasar a Interesado", () => {
  it("deja los tres avisos en su panel a nombre del equipo y no repite lo que ya quedó", async () => {
    const prep = await prepareDemo(uuid(1), uuid(101), uuid(900), "Facu");
    expect(prep.items.map((i) => [i.key, i.ok, i.photos])).toEqual([["demo_listing_url", true, 8], ["demo_preload_url_2", true, 3], ["demo_preload_url_3", true, 3]]);
    expect(state.imports.map((i) => [i.url, i.agencyId, i.userId])).toEqual([[URL1, uuid(101), uuid(900)], [URL2, uuid(101), uuid(900)], [URL3, uuid(101), uuid(900)]]);
    expect(row(1).demo_prep).toMatchObject({ attempts: 1, by: "Facu" });
    await prepareDemo(uuid(1), uuid(101), uuid(900), "Facu");
    expect(state.imports.length).toBe(3);
  });

  it("no importa un aviso que la lectura de prueba dio como no importable; una ficha ya en el panel cuenta como lista", async () => {
    state.tables.prospect_profiles.push(profile(4, { demo_listing_url: "https://ficticia.test/ya-esta/1", demo_preload_url_2: "https://ficticia.test/falla/2", demo_preload_url_3: "https://ficticia.test/bloqueada/3" }, {
      listing_checks: { "https://ficticia.test/bloqueada/3": { ok: false, photos: 0, title: null, error: "El sitio bloquea la lectura.", at: "2026-11-18T10:00:00Z" } },
    }));
    const prep = await prepareDemo(uuid(4), uuid(104), uuid(900), "Facu");
    expect(prep.items.map((i) => [i.ok, i.demoId, i.error])).toEqual([
      [true, uuid(77), null],
      [false, null, "No pudimos leer la publicación."],
      [false, null, "No se puede importar: El sitio bloquea la lectura."],
    ]);
    expect(state.imports.map((i) => i.url)).toEqual(["https://ficticia.test/ya-esta/1", "https://ficticia.test/falla/2"]);
    // Cada intento usa claves nuevas: un fallo no queda repetido para siempre.
    const before = state.imports[1].key;
    row(4).demo_prep.at = "2026-11-01T00:00:00Z";
    await prepareDemo(uuid(4), uuid(104), uuid(900), "Facu");
    expect(state.imports.at(-1)!.key).not.toBe(before);
  });

  it("trae las fotos de la propiedad de la demo en el momento, no solo la deja pendiente", async () => {
    const prep = await prepareDemo(uuid(1), uuid(101), uuid(900), "Facu");
    const main = prep.items.find((i) => i.key === "demo_listing_url")!;
    expect(state.photoImports).toEqual([main.demoId]);
    expect(main).toMatchObject({ photos: 8, imported: 8 });
    // Las precargas quedan para que la inmobiliaria las importe con un clic.
    expect(prep.items.filter((i) => i.key !== "demo_listing_url").every((i) => i.imported === undefined)).toBe(true);
  });

  it("si no llegó ninguna foto, vuelve a intentarlo sin volver a importar la ficha", async () => {
    state.photoResult = { total: 8, added: 0, already: 0, failed: 8, reasons: ["La foto ya no está en el sitio (error 404)."], attempts: 3 };
    const first = await prepareDemo(uuid(1), uuid(101), uuid(900), "Facu");
    expect(first.items[0]).toMatchObject({ imported: 0, photoError: "La foto ya no está en el sitio (error 404)." });
    expect(prepDue(row(1).profile as Profile, row(1).demo_prep as never, Date.parse(first.at) + 5 * 60_000)).toBe(false);
    expect(prepDue(row(1).profile as Profile, row(1).demo_prep as never, Date.parse(first.at) + 11 * 60_000)).toBe(true);
    state.photoResult = { total: 8, added: 8, already: 0, failed: 0, reasons: [], attempts: 1 };
    const again = await prepareDemo(uuid(1), uuid(101), uuid(900), "Facu");
    expect(state.imports.length).toBe(3);
    expect(state.photoImports.length).toBe(2);
    expect(again.items[0]).toMatchObject({ imported: 8 });
    expect(prepDue(row(1).profile as Profile, row(1).demo_prep as never, Date.now() + 86_400_000)).toBe(false);
  });

  it("sin precargas elegidas, busca 2 en el sitio de la inmobiliaria, las importa y las anota en Prospectos", async () => {
    state.tables.prospect_profiles.push(profile(5, { demo_listing_url: URL1 }));
    state.found = [
      { url: "https://ficticia.test/propiedad/41", title: "PH", photos: 9, interiors: 3 },
      { url: "https://ficticia.test/propiedad/42", title: "Depto", photos: 6, interiors: 2 },
    ];
    const prep = await prepareDemo(uuid(5), uuid(105), uuid(900), "Facu");
    expect(state.discoveries).toEqual([{ agencyId: uuid(105), want: 2, exclude: [URL1, URL1] }]);
    expect(prep.items.map((i) => [i.key, i.url, i.ok, i.found ?? false])).toEqual([
      ["demo_listing_url", URL1, true, false],
      ["demo_preload_url_2", "https://ficticia.test/propiedad/41", true, true],
      ["demo_preload_url_3", "https://ficticia.test/propiedad/42", true, true],
    ]);
    expect(row(5).profile).toMatchObject({ demo_preload_url_2: "https://ficticia.test/propiedad/41", demo_preload_url_3: "https://ficticia.test/propiedad/42" });
  });

  it("una precarga elegida a mano no se reemplaza por una del sitio", async () => {
    await prepareDemo(uuid(1), uuid(101), uuid(900), "Facu");
    expect(state.discoveries).toEqual([]);
  });

  it("prepara solo las de «Crear demo» sin propiedades cargadas a mano", async () => {
    state.targets = [{ agencyId: uuid(101), properties: 0, prepared: false }, { agencyId: uuid(102), properties: 2, prepared: false }];
    expect(await prepareInterested({ actorId: uuid(900) })).toEqual({ prepared: 1 });
    expect(new Set(state.imports.map((i) => i.agencyId))).toEqual(new Set([uuid(101)]));
    expect(await prepareInterested({ actorId: uuid(900) })).toEqual({ prepared: 0 });
  });

  it("sin un usuario del equipo no importa nada", async () => {
    state.targets = [{ agencyId: uuid(101), properties: 0, prepared: false }];
    expect(await prepareInterested({ actorId: null })).toEqual({ prepared: 0 });
    expect(state.imports).toEqual([]);
  });
});

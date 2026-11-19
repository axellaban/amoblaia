import { beforeEach, describe, expect, it, vi } from "vitest";

// Lo que Prospectos deja listo para «Crear demo»: la lectura de prueba de cada aviso y, al pasar a
// Interesado, los tres avisos en su panel. La base, el lector y el importador son dobles. Datos sintéticos.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  reads: [] as string[],
  imports: [] as { url: string; key: string; agencyId: string; userId: string | null }[],
  targets: [] as { agencyId: string; properties: number; prepared: boolean }[],
  siblings: {} as Record<string, string[]>,
  deleted: [] as string[],
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
      delete: () => {
        let gone = false;
        const drop = () => {
          if (gone) return;
          gone = true;
          const keep = (state.tables[table] ?? []).filter((r) => !filters.every((f) => f(r)));
          for (const r of rows()) state.deleted.push(`${table}:${String(r.id)}`);
          state.tables[table] = keep;
        };
        const d = { eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), d), then: (resolve: (v: unknown) => unknown) => (drop(), resolve({ error: null })) };
        return d;
      },
      insert: async () => ({ error: null }),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (patch) for (const r of rows()) Object.assign(r, structuredClone(patch));
        return resolve({ data: patch ? null : rows(), count: rows().length, error: null });
      },
    };
    return q;
  };
  return { adminClient: () => ({ from: query, auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } } }) };
});
vi.mock("@/lib/demos/listing", () => ({
  readSiblingListings: async (url: string) => state.siblings[url] ?? [],
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
import { assertCreateDemo, checkListings, checkPendingListings, findPendingPreloads, findPreloads, prepareDemo, prepareInterested } from "../src/lib/prospecting/demo-prep";

const URL1 = "https://ficticia.test/propiedad/1";
const URL2 = "https://ficticia.test/propiedad/2";
const URL3 = "https://ficticia.test/propiedad/3";
const profile = (n: number, values: Record<string, unknown>, o: Record<string, unknown> = {}) => ({ account_id: uuid(n), status: "calificado", profile: values, listing_checks: {}, demo_prep: null, ...o });
type StoredRow = { profile: Record<string, unknown>; listing_checks: Record<string, Record<string, unknown>>; demo_prep: { at: string } & Record<string, unknown> };
const row = (n: number) => state.tables.prospect_profiles.find((r) => r.account_id === uuid(n)) as unknown as StoredRow;

beforeEach(() => {
  state.siblings = {};
  state.deleted = [];
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
    expect(prep.items.map((i) => [i.key, i.ok, i.photos])).toEqual([["demo_listing_url", true, 3], ["demo_preload_url_2", true, 3], ["demo_preload_url_3", true, 3]]);
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

describe("precargas que habita. busca sola", () => {
  const ok = (title: string) => ({ ok: true, photos: 3, title, error: null, at: "2026-11-18T10:00:00Z" });
  const MAIN = "https://ficticia.test/propiedad/10";

  it("guarda las que faltan con los primeros avisos del mismo sitio que se importan, y no busca dos veces", async () => {
    state.tables.prospect_profiles.push(profile(5, { demo_listing_url: MAIN }, { status: "en_cola", listing_checks: { [MAIN]: ok("Ficha 0") } }));
    state.siblings[MAIN] = [MAIN, "https://ficticia.test/sin-fotos/11", "https://ficticia.test/propiedad/12", "https://ficticia.test/propiedad/13", "https://ficticia.test/propiedad/14"];
    expect(await findPreloads(uuid(5))).toEqual(["https://ficticia.test/propiedad/12", "https://ficticia.test/propiedad/13"]);
    expect(row(5).profile).toMatchObject({ demo_preload_url_2: "https://ficticia.test/propiedad/12", demo_preload_url_3: "https://ficticia.test/propiedad/13" });
    expect(row(5).listing_checks[MAIN].searched).toBeTruthy();
    expect(state.reads).not.toContain("https://ficticia.test/propiedad/14");
    expect(await findPreloads(uuid(5))).toEqual([]);
    expect(state.imports).toEqual([]);
  });

  it("no busca en portales ni sin un aviso principal que se importe; marca la búsqueda aunque no encuentre", async () => {
    const portal = "https://www.zonaprop.com.ar/propiedades/depto-1.html";
    state.tables.prospect_profiles.push(
      profile(6, { demo_listing_url: portal }, { status: "en_cola", listing_checks: { [portal]: ok("Depto") } }),
      profile(7, { demo_listing_url: MAIN }, { status: "en_cola" }),
      profile(8, { demo_listing_url: "https://ficticia.test/propiedad/20" }, { status: "en_cola", listing_checks: { "https://ficticia.test/propiedad/20": ok("Ficha 0") } }),
    );
    state.siblings[portal] = ["https://www.zonaprop.com.ar/propiedades/otra-2.html"];
    expect(await findPreloads(uuid(6))).toEqual([]);
    expect(await findPreloads(uuid(7))).toEqual([]);
    expect(await findPendingPreloads()).toEqual({ found: 0, accounts: 1 });
    expect(row(8).listing_checks["https://ficticia.test/propiedad/20"].searched).toBeTruthy();
    expect(state.reads).toEqual([]);
  });

  it("al preparar, busca las que faltan y deja las tres en su panel", async () => {
    state.tables.prospect_profiles.push(profile(9, { demo_listing_url: MAIN }, { status: "en_cola", listing_checks: { [MAIN]: ok("Ficha 0") } }));
    state.siblings[MAIN] = ["https://ficticia.test/propiedad/12", "https://ficticia.test/propiedad/13"];
    const prep = await prepareDemo(uuid(9), uuid(109), uuid(900), "Facu");
    expect(prep.items.map((i) => i.key)).toEqual(["demo_listing_url", "demo_preload_url_2", "demo_preload_url_3"]);
    expect(prep.found).toEqual(["https://ficticia.test/propiedad/12", "https://ficticia.test/propiedad/13"]);
  });
});

describe("avisos cambiados y «Dejar en su panel»", () => {
  it("saca de su panel la propiedad de un aviso cambiado si sigue sin fotos ni publicar; si ya tiene fotos, la deja", async () => {
    await prepareDemo(uuid(1), uuid(101), uuid(900), "Facu");
    const [first, second] = row(1).demo_prep.items as unknown as { demoId: string }[];
    state.tables.demos = [
      { id: first.demoId, property_id: "p-1", agency_id: uuid(101), status: "draft" },
      { id: second.demoId, property_id: "p-2", agency_id: uuid(101), status: "draft" },
    ];
    state.tables.demo_photos = [{ id: "f-1", property_id: "p-2" }];
    state.tables.demo_properties = [{ id: "p-1" }, { id: "p-2" }];
    row(1).profile.demo_listing_url = "https://ficticia.test/propiedad/7";
    row(1).profile.demo_preload_url_2 = "https://ficticia.test/propiedad/8";
    const prep = await prepareDemo(uuid(1), uuid(101), uuid(900), "Facu");
    expect(prep.removed).toEqual([URL1]);
    expect(state.deleted).toEqual(["demo_properties:p-1"]);
  });

  it("a mano solo con la tarea «Crear demo» pendiente", async () => {
    state.targets = [{ agencyId: uuid(101), properties: 0, prepared: false }];
    await expect(assertCreateDemo(uuid(101))).resolves.toBeUndefined();
    await expect(assertCreateDemo(uuid(102))).rejects.toThrow(/Todavía no está en «Crear demo»/);
  });
});

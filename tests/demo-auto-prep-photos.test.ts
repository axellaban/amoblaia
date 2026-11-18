import { beforeEach, describe, expect, it, vi } from "vitest";

// Las fotos de la publicación, del lado del servidor: lectura nueva en cada vuelta y reintentos.
// El lector, la descarga, la base y el guardado son dobles. Datos sintéticos.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = vi.hoisted(() => ({
  reads: 0,
  /** Las direcciones de cada lectura: algunas webs las cambian (tokens que vencen). */
  pages: [] as string[][],
  failOnce: new Set<string>(),
  failAlways: new Set<string>(),
  fetched: [] as string[],
  added: [] as { owner: string; ownOnly: boolean }[],
  owner: null as string | null,
  imports: [{ id: "imp-1", pending_images: ["https://web.test/f/1.jpg?t=viejo", "https://web.test/f/2.jpg?t=viejo"] }] as { id: string; pending_images: string[] }[],
  reported: [] as { id: string; done: string[]; failed: string[] }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("sharp", () => ({ default: () => ({}) }));
vi.mock("@/lib/commerce/jobs", () => ({ BUCKET: "test" }));
vi.mock("@/lib/listings/photo-check", () => ({ checkPhoto: async () => undefined }));
vi.mock("@/lib/demos/listing", () => ({
  readListing: async () => ({ imported: { images: state.pages[Math.min(state.reads++, state.pages.length - 1)] } }),
  fetchPublic: async (src: string) => {
    state.fetched.push(src);
    const key = src.split("?")[0];
    if (state.failAlways.has(key)) throw new Error("La foto ya no está en el sitio (error 404).");
    if (state.failOnce.delete(key)) throw new Error("Se cortó la conexión.");
    return { url: src, type: "image/jpeg", body: Buffer.from(key) };
  },
}));
vi.mock("@/lib/demos/server", () => ({
  MAX_PHOTOS_PER_DEMO: 40,
  adminImagePaths: async () => null,
  demoRow: async () => ({ id: uuid(1), agency_id: uuid(2), property_id: uuid(3) }),
  addPhoto: async (_demo: unknown, owner: string, _bytes: Buffer, _name: string, opts: { ownOnly?: boolean }) => {
    state.added.push({ owner, ownOnly: Boolean(opts.ownOnly) });
    return { id: `p${state.added.length}`, reused: false };
  },
}));
vi.mock("@/lib/agency/imports", () => ({
  photoKey: (src: string) => src.split("?")[0],
  reportPhotos: async (_agency: string, id: string, done: string[], failed: string[]) => void state.reported.push({ id, done, failed }),
}));
vi.mock("@/lib/supabase/server", () => {
  const query = (table: string) => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: table === "demo_properties" ? { listing_url: "https://web.test/aviso/1" } : { owner_id: state.owner }, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: table === "property_imports" ? state.imports : [], error: null }),
    };
    return q;
  };
  return { adminClient: () => ({ from: query }) };
});
import { importListingPhotos } from "../src/lib/demos/auto-prep";

beforeEach(() => {
  state.reads = 0;
  state.pages = [["https://web.test/f/1.jpg?t=a", "https://web.test/f/2.jpg?t=a", "https://web.test/f/3.jpg?t=a"]];
  state.failOnce = new Set();
  state.failAlways = new Set();
  state.fetched = [];
  state.added = [];
  state.owner = null;
  state.reported = [];
});

describe("importar las fotos de la publicación", () => {
  it("reintenta las que fallaron con una lectura nueva y deja la importación al día", async () => {
    state.failOnce = new Set(["https://web.test/f/2.jpg"]);
    state.pages.push(["https://web.test/f/1.jpg?t=b", "https://web.test/f/2.jpg?t=b", "https://web.test/f/3.jpg?t=b"]);
    const r = await importListingPhotos(uuid(1), uuid(900), { attempts: 3 });
    expect(r).toMatchObject({ total: 3, added: 3, failed: 0, attempts: 2 });
    // The second round asked only for the missing one, at its new address.
    expect(state.fetched.slice(3)).toEqual(["https://web.test/f/2.jpg?t=b"]);
    // Every listing photo is in: the old pending addresses count as done.
    expect(state.reported).toEqual([{ id: "imp-1", done: ["https://web.test/f/1.jpg?t=viejo", "https://web.test/f/2.jpg?t=viejo"], failed: [] }]);
  });

  it("después de los intentos dice cuántas faltan y por qué", async () => {
    state.failAlways = new Set(["https://web.test/f/3.jpg"]);
    const r = await importListingPhotos(uuid(1), uuid(900), { attempts: 2 });
    expect(r).toMatchObject({ total: 3, added: 2, failed: 1, attempts: 2, reasons: ["La foto ya no está en el sitio (error 404)."] });
  });

  it("con cuenta de la inmobiliaria, las fotos son de su dueño; sin cuenta, del equipo", async () => {
    await importListingPhotos(uuid(1), uuid(900), { attempts: 1 });
    expect(state.added[0]).toEqual({ owner: uuid(900), ownOnly: false });
    state.added = [];
    state.owner = uuid(55);
    await importListingPhotos(uuid(1), uuid(900), { attempts: 1 });
    expect(state.added[0]).toEqual({ owner: uuid(55), ownOnly: true });
  });
});

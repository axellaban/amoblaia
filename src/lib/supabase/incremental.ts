import "server-only";
import { adminClient } from "./server";

/**
 * Lecturas incrementales de tablas que se leen enteras (la cola de Follow-up, las filas de
 * Inmobiliarias, Chapa Labs): la primera vez en cada instancia se trae la tabla completa y
 * después solo las filas con `cursor` (updated_at, recorded_at, calculated_at) posterior a la
 * última carga. Así el egreso de Supabase deja de ser «la tabla entera en cada recarga».
 *
 * Por qué es seguro:
 *  - El cursor lo pone la base (trigger de updated_at o default now() en un insert): ninguna
 *    escritura queda sin marcar. Las tablas sin trigger no se leen así (ver `ready`).
 *  - Se relee con un margen hacia atrás (OVERLAP_MS) por si una transacción confirmó tarde
 *    con un now() anterior; las filas repetidas se pisan por clave.
 *  - Las bajas no traen cursor: después de cada delta se compara la cantidad de filas de la base
 *    (`count`, sin datos) con la del caché. Si no coincide, se relee todo.
 *  - Cada tanto (FULL_EVERY_MS) se relee todo igual, como red de seguridad.
 */

/**
 * Tests share one module instance between cases with different fake data: there, nothing is kept
 * unless the test asks for it (HABITA_TEST_CACHE=1). Read on every call, so a test can switch it.
 */
export const instanceCaching = () => process.env.NODE_ENV !== "test" || process.env.HABITA_TEST_CACHE === "1";

const PAGE = 1000;
const OVERLAP_MS = 2 * 60_000;
const FULL_EVERY_MS = 30 * 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

export type IncrementalSpec<T> = {
  table: string;
  /** Columnas a leer; tienen que incluir la clave y el cursor. */
  columns: string;
  /** Columna timestamptz que la base actualiza en cada insert y update. */
  cursor: keyof T & string;
  /** Columnas que identifican la fila (y ordenan la lectura completa). */
  key: (keyof T & string)[];
  /** Mismo filtro para la lectura completa, el delta y el conteo. */
  filter?: (q: Query) => Query;
  /** Releer todo con esta frecuencia mínima (por defecto, 30 minutos). */
  fullEveryMs?: number;
};

export type IncrementalTable<T> = {
  /** Todas las filas (copias: se pueden modificar sin tocar el caché). */
  read(): Promise<T[]>;
  /** Que la próxima lectura no se sume a una que ya estaba en curso (después de una escritura). */
  touch(): void;
  /** Olvidar el caché: la próxima lectura es completa. */
  reset(): void;
};

export function incrementalTable<T extends Record<string, unknown>>(spec: IncrementalSpec<T>): IncrementalTable<T> {
  const keyOf = (r: T) => spec.key.map((k) => String(r[k] ?? "")).join("|");
  const filtered = (q: Query) => (spec.filter ? spec.filter(q) : q);
  let rows: Map<string, T> | null = null;
  let maxCursor = 0;
  let fullAt = 0;
  let generation = 0;
  let inflight: { generation: number; promise: Promise<T[]> } | null = null;
  let tail: Promise<unknown> = Promise.resolve();

  const stamp = (r: T) => {
    const t = Date.parse(String(r[spec.cursor] ?? ""));
    if (Number.isFinite(t) && t > maxCursor) maxCursor = t;
  };

  async function pages(build: (from: number, to: number) => Query) {
    const out: T[] = [];
    for (let from = 0; from < 200_000; from += PAGE) {
      const { data, error } = await build(from, from + PAGE - 1);
      if (error) throw Object.assign(new Error(`INCREMENTAL_READ_FAILED:${spec.table}`), { cause: error });
      const page = (data ?? []) as T[];
      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out;
  }

  async function full() {
    const list = await pages((from, to) => {
      let q = filtered(adminClient().from(spec.table).select(spec.columns));
      for (const k of spec.key) q = q.order(k, { ascending: true });
      return q.range(from, to);
    });
    const next = new Map<string, T>();
    maxCursor = 0;
    for (const r of list) { next.set(keyOf(r), r); stamp(r); }
    rows = next;
    fullAt = Date.now();
  }

  async function delta() {
    const since = new Date(Math.max(0, maxCursor - OVERLAP_MS)).toISOString();
    const changed = await pages((from, to) => {
      let q = filtered(adminClient().from(spec.table).select(spec.columns)).gte(spec.cursor, since).order(spec.cursor, { ascending: true });
      for (const k of spec.key) q = q.order(k, { ascending: true });
      return q.range(from, to);
    });
    for (const r of changed) { rows!.set(keyOf(r), r); stamp(r); }
    // Deletions leave no cursor behind: compare how many rows there are (a head request, no data).
    const { count, error } = await filtered(adminClient().from(spec.table).select(spec.key[0], { count: "exact", head: true }));
    if (error || typeof count !== "number") throw Object.assign(new Error(`INCREMENTAL_COUNT_FAILED:${spec.table}`), { cause: error });
    if (count !== rows!.size) await full();
  }

  async function sync() {
    try {
      if (!rows || !instanceCaching() || Date.now() - fullAt > (spec.fullEveryMs ?? FULL_EVERY_MS)) await full();
      else await delta();
    } catch (e) {
      rows = null; // A half-applied delta is never trusted: the next read starts over.
      throw e;
    }
    return [...rows!.values()].map((r) => ({ ...r }));
  }

  return {
    read() {
      if (inflight && inflight.generation === generation) return inflight.promise;
      const promise = tail.then(sync);
      tail = promise.catch(() => undefined);
      const entry = { generation, promise };
      inflight = entry;
      promise.then(() => { if (inflight === entry) inflight = null; }, () => { if (inflight === entry) inflight = null; });
      return promise;
    },
    touch() { generation++; },
    reset() { generation++; rows = null; },
  };
}

/** Un valor que casi no cambia, guardado en la instancia durante `ttlMs` (lecturas, nunca escrituras). */
export function ttlValue<T>(load: () => Promise<T>, ttlMs: number) {
  let value: { until: number; data: T } | null = null;
  let pending: Promise<T> | null = null;
  let generation = 0;
  return {
    get(): Promise<T> {
      if (!instanceCaching()) return load();
      if (value && value.until > Date.now()) return Promise.resolve(value.data);
      if (pending) return pending;
      const mine = generation;
      const request = load().then((data) => {
        if (mine === generation) value = { until: Date.now() + ttlMs, data };
        return data;
      }).finally(() => { if (pending === request) pending = null; });
      pending = request;
      return request;
    },
    clear() { generation++; value = null; pending = null; },
  };
}

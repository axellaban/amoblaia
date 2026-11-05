// The checks of the real schema, read from supabase/migrations: the last
// migration that defines a constraint wins, as it does in the database.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "..", "..", "supabase", "migrations");

/** The SQL of the last migration's definition of a check constraint (by name). */
export function lastCheck(name: string) {
  let found: string | null = null;
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(DIR, file), "utf8");
    const named = new RegExp(`constraint\\s+${name}\\s+check\\s*\\(([\\s\\S]*?)\\);`, "gi");
    for (const m of sql.matchAll(named)) found = m[1];
  }
  if (!found) throw new Error(`No migration defines ${name}`);
  return found;
}

/**
 * property_imports.snapshot as the database accepts it: the regex and the
 * size limit of property_imports_snapshot_check, applied like Postgres would.
 */
export function snapshotRule() {
  const sql = lastCheck("property_imports_snapshot_check");
  const pattern = sql.match(/snapshot\s*~\s*'([^']+)'/)?.[1];
  const max = Number(sql.match(/char_length\(snapshot\)\s*<=\s*(\d+)/)?.[1] ?? Infinity);
  if (!pattern) throw new Error("property_imports_snapshot_check has no pattern");
  const re = new RegExp(pattern);
  return { pattern, max, accepts: (s: string) => s.length <= max && re.test(s) };
}

import { adminClient } from "@/lib/supabase/server";

/**
 * A short stamp that changes with any write to the database (SQL:
 * habita_change_stamp). Null before the migration or if it fails, and then
 * callers simply load in full.
 */
export async function changeStamp(): Promise<string | null> {
  try {
    const { data, error } = await adminClient().rpc("habita_change_stamp");
    return !error && typeof data === "string" && data ? data : null;
  } catch {
    return null;
  }
}

export type Unchanged = { unchanged: true; stamp: string };
export type Stamped<T> = T & { stamp: string | null };

/**
 * For the panels' timed reloads, which read megabytes that are usually the
 * same as last time. A request without `?si=` is served as always. With
 * `?si=<stamp it was last given>`, the data is read only if something was
 * written since; otherwise the answer is `{ unchanged: true }`.
 *
 * The stamp returned is the one read BEFORE loading: a write that lands while
 * loading makes the next reload read again, instead of being missed.
 */
export async function unlessUnchanged<T extends object>(request: Request | undefined, load: () => Promise<T>): Promise<T | Stamped<T> | Unchanged> {
  const known = request ? new URL(request.url).searchParams.get("si") : null;
  if (known === null) return load();
  const stamp = await changeStamp();
  if (stamp && stamp === known) return { unchanged: true, stamp };
  return { ...(await load()), stamp };
}

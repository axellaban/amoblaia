import "server-only";
import { adminClient } from "@/lib/supabase/server";
// Team accounts listed in UNLIMITED_EMAILS generate without spending photos.
// Their allowance is an ordinary paid grant that never runs out or expires,
// so reservation, refunds and paid quality work as for any bought photo.
const ALLOWANCE = 1_000_000;
/** Daily share for these accounts: a guard against a runaway client, not a quota. */
export const UNLIMITED_DAILY_LIMIT = 1000;
export function isUnlimited(email?: string | null) {
  return Boolean(
    email &&
    (process.env.UNLIMITED_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .includes(email.toLowerCase()),
  );
}
/**
 * Opens (or reopens) the allowance of a listed account, and closes it once
 * the email leaves the list. Call after amobla_account, which creates the
 * profile the grant belongs to; `changed` says its balance is now stale.
 */
export async function syncUnlimited(user: {
  id: string;
  email?: string | null;
}) {
  const db = adminClient();
  const key = `unlimited:${user.id}`;
  const unlimited = isUnlimited(user.email);
  const { data: grant, error } = await db
    .from("credit_grants")
    .select("id,remaining,expires_at")
    .eq("source_key", key)
    .maybeSingle();
  if (error) throw new Error("UNLIMITED_SYNC_FAILED");
  let change: { id: string; delta: number } | null = null;
  if (!unlimited) {
    if (!grant || grant.expires_at) return { unlimited, changed: false };
    // Expired rather than revoked: a revoked grant would block regenerations
    // of the photos made with it as if the account were under review.
    const closed = await db
      .from("credit_grants")
      .update({ remaining: 0, expires_at: new Date().toISOString() })
      .eq("id", grant.id);
    if (closed.error) throw new Error("UNLIMITED_SYNC_FAILED");
    change = { id: grant.id, delta: -grant.remaining };
  } else if (!grant) {
    const created = await db
      .from("credit_grants")
      .insert({
        user_id: user.id,
        source_key: key,
        total: ALLOWANCE,
        remaining: ALLOWANCE,
      })
      .select("id")
      .single();
    // 23505: a concurrent request opened it first.
    if (created.error?.code === "23505") return { unlimited, changed: true };
    if (created.error || !created.data)
      throw new Error("UNLIMITED_SYNC_FAILED");
    change = { id: created.data.id, delta: ALLOWANCE };
  } else if (grant.expires_at || grant.remaining < ALLOWANCE / 2) {
    const reopened = await db
      .from("credit_grants")
      .update({ remaining: ALLOWANCE, expires_at: null })
      .eq("id", grant.id);
    if (reopened.error) throw new Error("UNLIMITED_SYNC_FAILED");
    change = { id: grant.id, delta: ALLOWANCE - grant.remaining };
  }
  if (change) {
    // The grant is the balance; a missing ledger row only loses the audit line.
    const logged = await db.from("credit_ledger").insert({
      user_id: user.id,
      grant_id: change.id,
      delta: change.delta,
      reason: unlimited ? "unlimited_access" : "unlimited_access_ended",
    });
    if (logged.error) console.error("unlimited_ledger_failed", user.id);
  }
  return { unlimited, changed: Boolean(change) };
}

import "server-only";
import { cookies } from "next/headers";
import { createHmac } from "node:crypto";
import { GUEST_COOKIE, verifyGuestToken } from "@/lib/guest-token";
import { adminClient } from "@/lib/supabase/server";
import { rpc } from "./http";
import { BUCKET } from "./jobs";
export function guestSecret() {
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("GUEST_NOT_CONFIGURED");
  return key;
}
export async function guestId() {
  return verifyGuestToken(
    (await cookies()).get(GUEST_COOKIE)?.value,
    guestSecret(),
  );
}
export function guestFingerprint(request: Request) {
  // Vercel overwrites this header at the edge; do not use client-supplied forwarding headers.
  const ip = process.env.VERCEL
    ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    : "local-development";
  return createHmac("sha256", guestSecret())
    .update(`guest-ip:${ip || "unknown"}`)
    .digest("hex");
}
/** Moves a guest's photos into the account and deletes originals that were
 * merged into an identical photo the account already had. */
export async function claimGuest(guest: string, user: string) {
  // Before the 20261021 migration the RPC returns nothing.
  const orphans = await rpc<string[] | null>("amobla_claim_guest", {
    p_guest: guest,
    p_user: user,
  });
  if (orphans?.length) {
    const { error } = await adminClient().storage.from(BUCKET).remove(orphans);
    if (error) console.error("guest_orphans_not_removed", orphans.length);
  }
}
/**
 * Hands a free trial over to the account that just signed in. It never
 * fails the sign-in: if the claim fails, the guest cookie stays so the next
 * account or library load retries it (the claim is idempotent).
 */
export async function adoptGuest(user: {
  id: string;
  email_confirmed_at?: string | null;
  is_anonymous?: boolean;
}) {
  if (user.is_anonymous || !user.email_confirmed_at) return false;
  const guest = await guestId().catch(() => null);
  const jar = await cookies();
  if (!guest || guest === user.id) {
    if (jar.get(GUEST_COOKIE)) jar.delete(GUEST_COOKIE);
    return true;
  }
  try {
    await claimGuest(guest, user.id);
    jar.delete(GUEST_COOKIE);
    return true;
  } catch {
    console.error("guest_claim_deferred", user.id);
    return false;
  }
}

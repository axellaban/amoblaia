import "server-only";
import { cookies } from "next/headers";
import { createHmac } from "node:crypto";
import { GUEST_COOKIE, verifyGuestToken } from "@/lib/guest-token";
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

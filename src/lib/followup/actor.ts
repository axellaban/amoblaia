import type { User } from "@supabase/supabase-js";

/** The team member's name for {{sdr}} and the evidence: their profile name, else their email before the @. */
export function actorName(user: Pick<User, "email" | "user_metadata">) {
  const meta = user.user_metadata ?? {};
  const named = [meta.full_name, meta.name].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  if (named) return named.trim().split(/\s+/)[0];
  const local = (user.email ?? "").split("@")[0].split(/[._+-]/)[0];
  return local ? local[0].toUpperCase() + local.slice(1) : "El equipo de habita";
}

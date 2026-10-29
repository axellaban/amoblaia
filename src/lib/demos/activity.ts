import "server-only";
import { isAdmin } from "@/lib/commerce/http";
import { adminClient, currentUser } from "@/lib/supabase/server";
import type { DemoActivity } from "./shared";

/** The steps a visitor of the public demo can report (the agency's step 3 comes from its claim). */
export const VISITOR_KINDS = ["visita", "interaccion", "descarga", "generacion"] as const;
export type VisitorKind = (typeof VISITOR_KINDS)[number];

/** The visitor's id is random and kept in the browser: never personal data. */
export const validVisitor = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v);

/**
 * Whether the request comes from a signed-in member of the team. Their own
 * visits to a demo are never counted. Without a session it is simply false.
 */
export async function teamRequest() {
  try {
    return isAdmin((await currentUser())?.email ?? undefined);
  } catch {
    return false;
  }
}

/**
 * Records one step of a demo. Best effort: a failure is logged and never
 * breaks the page or the claim that triggered it.
 */
export async function recordDemoActivity(demoId: string, visitor: string, kind: VisitorKind | "panel") {
  try {
    const { error } = await adminClient().rpc("habita_record_demo_activity", {
      p_demo: demoId,
      p_visitor: visitor,
      p_kind: kind,
    });
    if (error) console.error("demo_activity_failed");
  } catch {
    console.error("demo_activity_failed");
  }
}

/** The agency's account bought credits: step 4 ("suscribió") on each of its demos. Best effort. */
export async function recordAgencyPurchase(userId: string) {
  try {
    const { data } = await adminClient().from("agency_members").select("agency_id").eq("user_id", userId).maybeSingle();
    const agencyId = (data as { agency_id: string } | null)?.agency_id;
    if (!agencyId) return;
    const { error } = await adminClient().rpc("habita_record_agency_purchase", { p_agency: agencyId });
    if (error) console.error("demo_activity_failed");
  } catch {
    console.error("demo_activity_failed");
  }
}

/** The agency took its demos into its own account (step 3 on each). Best effort. */
export async function recordAgencyPanel(agencyId: string) {
  try {
    const { error } = await adminClient().rpc("habita_record_agency_activity", { p_agency: agencyId });
    if (error) console.error("demo_activity_failed");
  } catch {
    console.error("demo_activity_failed");
  }
}

/**
 * The activity summary of these demos, for the team's list. Before the
 * migration is applied the columns do not exist: every demo then reads as
 * without activity, and the rest of the list keeps working.
 */
export async function activityOf(demoIds: string[]) {
  const out = new Map<string, DemoActivity>();
  if (!demoIds.length) return out;
  const { data, error } = await adminClient()
    .from("demos")
    .select("id,activity_level,activity_at,activity_visitors")
    .in("id", demoIds);
  if (error) return out;
  for (const row of (data ?? []) as { id: string; activity_level: number; activity_at: string | null; activity_visitors: number }[])
    out.set(row.id, {
      level: Math.min(5, Math.max(0, row.activity_level)) as DemoActivity["level"],
      at: row.activity_at,
      visitors: row.activity_visitors,
    });
  return out;
}

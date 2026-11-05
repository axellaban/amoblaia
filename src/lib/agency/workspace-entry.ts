import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "@/lib/supabase/server";
import { publishedDemo } from "@/lib/demos/server";
import { INVITE_CODE } from "./demo-invite";
import { panelLinkAgency } from "./panel-link";
import { currentVisit } from "./visit";

/**
 * The agency a person is trying to enter, from where they came: a public
 * demo (its token), a code of the team's links (a used one still names its
 * agency) or the visit started from one. Knowing any of these never grants
 * anything: it only says which space to ask for access to (Journey C).
 */
export type EntrySpace = {
  agency: { id: string; name: string; ownerId: string | null };
  demo: { id: string; token: string; title: string } | null;
  source: "demo" | "link" | "invitation";
};

async function agencyRow(id: string) {
  const { data, error } = await adminClient().from("agencies").select("id,name,owner_id").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const a = data as { id: string; name: string; owner_id: string | null };
  return { id: a.id, name: a.name, ownerId: a.owner_id };
}

/** The agency a team code (one-time invitation or fixed link) belongs to, whether or not it can still be used. */
async function agencyOfCode(code: string): Promise<{ id: string; source: "link" | "invitation" } | null> {
  if (!INVITE_CODE.test(code)) return null;
  const link = await panelLinkAgency(code).catch(() => null);
  if (link) return { id: link.agency.id, source: "link" };
  const { data, error } = await adminClient()
    .from("agency_claims")
    .select("agency_id")
    .eq("code_hash", createHash("sha256").update(code).digest("hex"))
    .maybeSingle();
  if (error || !data) return null;
  return { id: (data as { agency_id: string }).agency_id, source: "invitation" };
}

export async function entrySpace(params: { demoToken?: string | null; code?: string | null }): Promise<EntrySpace | null> {
  if (params.demoToken) {
    const demo = await publishedDemo(params.demoToken).catch(() => null);
    if (demo) {
      const agency = await agencyRow(demo.agencyId);
      if (agency) return { agency, demo: { id: demo.id, token: params.demoToken, title: demo.title }, source: "demo" };
    }
  }
  if (params.code) {
    const hit = await agencyOfCode(params.code);
    const agency = hit ? await agencyRow(hit.id) : null;
    if (agency && hit) return { agency, demo: null, source: hit.source };
  }
  const visit = await currentVisit().catch(() => null);
  if (visit) {
    const agency = await agencyRow(visit.agency.id);
    if (agency) return { agency, demo: null, source: visit.source };
  }
  return null;
}

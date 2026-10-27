import "server-only";
import { notFound } from "next/navigation";
import { HttpError } from "@/lib/commerce/http";
import { requireAdminPage } from "@/lib/demos/admin-page";
import { demoRow } from "@/lib/demos/server";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
import { adminAgency } from "./admin";
import { agencyStage, STAGE_LABEL } from "./stage";

/**
 * Gate of the pages under /admin/inmobiliarias/<id>/…: the team (as on
 * every admin page) and an agency that exists. A failed lookup is an error
 * the page says, never a "not found".
 */
export async function agencyPage(id: string, next: string) {
  await requireAdminPage(next);
  if (!isUuid(id)) notFound();
  try {
    const data = await adminAgency(id);
    const pending = data.claims.find((c) => c.state === "pending");
    const stage = agencyStage({ hasOwner: data.agency.hasOwner, claimedAt: data.agency.claimedAt, liveClaimExpires: pending?.expiresAt ?? null, published: data.counts.published });
    return { ok: true as const, data, stage: STAGE_LABEL[stage] };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    return { ok: false as const };
  }
}

/** A property page inside an agency's edit: it must belong to that agency (else not found). */
export async function agencyPropertyPage(id: string, demoId: string, next: string) {
  await requireAdminPage(next);
  if (!isUuid(id) || !isUuid(demoId)) notFound();
  const demo = await demoRow(demoId).catch((e) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  if (demo.agency_id !== id) notFound();
  const { data, error } = await adminClient().from("agencies").select("name").eq("id", id).maybeSingle();
  if (error) throw new Error("AGENCY_LOOKUP_FAILED");
  if (!data) notFound();
  return { name: (data as { name: string }).name };
}

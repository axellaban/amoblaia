import { requireAdmin, failure, rpc } from "@/lib/commerce/http";
import { createDemo, listDemos, saveAgencyWhatsapp } from "@/lib/demos/server";
import { agencyInput, propertyInput, readJson, whatsappInput } from "@/lib/demos/input";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";

const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await listDemos(), { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

/** Creates the agency (or reuses one), the property and a draft demo. */
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const body = await readJson(request);
    const agencyId = isUuid(body.agencyId) ? body.agencyId : null;
    const property = propertyInput(body.property);
    const agency = agencyId ? null : agencyInput(body.agency);
    // Optional, but asked: without it the demo cannot be sent from the panel.
    const whatsapp = whatsappInput(body.whatsapp);
    // Profiles back the created_by references and the audit trail.
    await rpc("amobla_account", { p_user: actor.id, p_trial: false });
    const id = await createDemo({ actorId: actor.id, agencyId, agency, property });
    let whatsappSaved = false;
    if (whatsapp) {
      const { data } = await adminClient().from("demos").select("agency_id").eq("id", id).single();
      const owner = (data as { agency_id: string } | null)?.agency_id;
      // The demo exists already: a pending migration only leaves the number to load on its screen.
      if (owner) whatsappSaved = await saveAgencyWhatsapp(owner, whatsapp).then(() => true, () => false);
    }
    await adminClient().from("admin_audit").insert({
      actor_id: actor.id,
      action: "demo_create",
      subject_id: id,
      details: { agencyId: agencyId ?? "new" },
    });
    return Response.json({ id, whatsappSaved }, { status: 201, headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

import "server-only";
import { stagingRule, type DemoRead } from "@/lib/agency/server";
import { demoDetail } from "@/lib/demos/server";

/** The team's notes and contact person about an agency are never shown to the agency. */
export function viewOf(detail: Awaited<ReturnType<typeof demoDetail>>, admin: boolean) {
  return admin
    ? detail
    : {
        ...detail,
        demo: { ...detail.demo, agencyWhatsapp: null, agencyContact: null, sentAt: null, messageTemplate: null },
        sendLog: undefined,
        agency: { ...detail.agency, notes: null, contact_name: null },
      };
}

/**
 * What GET /api/admin/demos/<id> answers, for one who may read it: the editor's
 * property. The panel's page renders it on the server too, so a phone does not
 * wait for the editor's code to load before asking for it (UX-005).
 */
export async function demoDetailFor(access: DemoRead) {
  return { ...viewOf(await demoDetail(access.demo.id), access.admin), staging: stagingRule(access), readOnly: access.role === "viewer" };
}

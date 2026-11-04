import { failure, HttpError, requireUser } from "@/lib/commerce/http";
import { panelSummary } from "@/lib/agency/panel";
import { INVITE_CODE } from "@/lib/agency/demo-invite";
import { membershipOf } from "@/lib/agency/server";
import { readJson } from "@/lib/demos/input";
import { claimWithCode } from "@/lib/agency/invitation";
export const runtime = "nodejs";

/**
 * Takes over the agency the team prepared demos for, with the one-time code
 * the team gave it ({ code }). Opening a demo is never enough: without a
 * valid, unused and unexpired code nothing is transferred.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request, 1024);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!INVITE_CODE.test(code)) throw new HttpError(404, "Ese código no es válido o ya se usó. Pedile uno nuevo al equipo de habita.");
    await claimWithCode(user, code);
    const membership = await membershipOf(user.id);
    return Response.json(await panelSummary(membership!), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

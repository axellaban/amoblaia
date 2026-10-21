import { cookies } from "next/headers";
import { requireUser, rpc, failure } from "@/lib/commerce/http";
import { guestId } from "@/lib/commerce/guest";
import { GUEST_COOKIE } from "@/lib/guest-token";
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const guest = await guestId();
    if (guest && guest !== user.id)
      await rpc("amobla_claim_guest", { p_guest: guest, p_user: user.id });
    (await cookies()).delete(GUEST_COOKIE);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

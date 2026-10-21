import { requireUser, failure } from "@/lib/commerce/http";
import { adoptGuest } from "@/lib/commerce/guest";
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    // A failed hand-over keeps the guest cookie and is retried on the next
    // account or library load.
    const claimed = await adoptGuest(user);
    return Response.json(
      { ok: claimed },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

import { failure, HttpError, requireUser } from "@/lib/commerce/http";
import { reconcileCheckout } from "@/lib/commerce/reconcile";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (Number(request.headers.get("content-length") || 0) > 1024)
      throw new HttpError(413, "Solicitud inválida.");
    const { order } = await request.json();
    if (typeof order !== "string" || !/^[0-9a-f-]{36}$/i.test(order))
      throw new HttpError(400, "Compra inválida.");
    return Response.json(await reconcileCheckout(user.id, order), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}

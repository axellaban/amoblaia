import { failure, HttpError, requireAdmin } from "@/lib/commerce/http";
import { agencyActivity } from "@/lib/agency/admin-edit";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

/** What the team did on this agency, newest first, with who did it (by e-mail when it can be read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAdmin();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "No encontramos la inmobiliaria.");
    const rows = await agencyActivity(id);
    const actors = [...new Set(rows.map((r) => r.actor))].slice(0, 20);
    const emails = new Map<string, string>();
    await Promise.all(
      actors.map(async (actor) => {
        const r = await adminClient().auth.admin.getUserById(actor).catch(() => null);
        if (r?.data?.user?.email) emails.set(actor, r.data.user.email);
      }),
    );
    return Response.json(
      { items: rows.map((r) => ({ ...r, actor: r.actor === me.id ? "Vos" : (emails.get(r.actor) ?? "Otra persona del equipo") })) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

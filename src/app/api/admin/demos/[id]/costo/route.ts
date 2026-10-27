import { failure, HttpError } from "@/lib/commerce/http";
import { agencyCredits } from "@/lib/agency/panel";
import { requireDemoAccess } from "@/lib/agency/server";
import { readJson } from "@/lib/demos/input";
import { isUuid } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";
export const runtime = "nodejs";

type Project = {
  id: string;
  user_id: string;
  grant_id: string | null;
  credit_grants: { source_key: string; revoked: boolean; expires_at: string | null } | null;
};

/**
 * What staging these photos would cost, from the server's data, before
 * anything starts: who pays, the balance, how many photos use a credit and
 * whether something blocks it. A photo already paid costs nothing while its
 * coverage (or any live plan of the payer) lasts; past it, staging it needs
 * a plan again. { photoIds: [...] }.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { demo, admin, billingUser } = await requireDemoAccess(request, id);
    const body = await readJson(request, 8192);
    const ids = (Array.isArray(body.photoIds) ? body.photoIds : []).filter(isUuid).slice(0, 100);
    if (!billingUser)
      return Response.json({ payer: "team", credits: null, newPhotos: 0, cost: 0, blocked: null }, { headers: { "Cache-Control": "private, no-store" } });
    if (admin) throw new HttpError(409, "Esta inmobiliaria ya tiene su cuenta: las ambientaciones se crean desde su panel.");
    const db = adminClient();
    const { data: photos, error } = await db.from("demo_photos").select("id,project_id").eq("property_id", demo.property_id).in("id", ids);
    if (error) throw new Error("COST_PHOTOS_FAILED");
    const projectIds = (photos as { project_id: string }[]).map((p) => p.project_id);
    const now = new Date().toISOString();
    const [projects, live, credits] = await Promise.all([
      projectIds.length
        ? db.from("projects").select("id,user_id,grant_id,credit_grants(source_key,revoked,expires_at)").in("id", projectIds)
        : Promise.resolve({ data: [], error: null }),
      // Any live paid plan of the payer keeps paid photos stageable.
      db
        .from("credit_grants")
        .select("id")
        .eq("user_id", billingUser)
        .eq("revoked", false)
        .not("source_key", "like", "trial:%")
        .not("source_key", "like", "demo:%")
        .lte("starts_at", now)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .limit(1),
      agencyCredits(billingUser),
    ]);
    if (projects.error || live.error) throw new Error("COST_LOOKUP_FAILED");
    let newPhotos = 0;
    let expired = 0;
    let shared = 0;
    for (const p of (projects.data ?? []) as unknown as Project[]) {
      const g = p.credit_grants;
      if (p.user_id !== billingUser) shared++;
      else if (!p.grant_id || !g || /^(trial|demo):/.test(g.source_key)) newPhotos++;
      else if (g.revoked || (g.expires_at && g.expires_at <= now)) {
        if (!(live.data ?? []).length) expired++;
      }
    }
    const blocked =
      credits === null
        ? "No pudimos consultar el saldo. Probá de nuevo."
        : shared
          ? "Una de las fotos es compartida con otra demo: volvé a subirla para ambientarla."
          : expired
            ? "La cobertura de alguna foto ya ambientada venció: sumá un plan para crear más versiones."
            : credits < newPhotos
              ? `Hacen falta ${newPhotos} ${newPhotos === 1 ? "crédito" : "créditos"} y la inmobiliaria tiene ${credits}.`
              : null;
    return Response.json(
      { payer: "agency", credits, newPhotos, cost: newPhotos, blocked },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

import { requireAdmin, failure, HttpError, rpc } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/commerce/jobs";
import { billingStatus } from "@/lib/commerce/mercadopago";
export async function GET() {
  try {
    await requireAdmin();
    const db = adminClient();
    const r = await Promise.all([
      db.from("products").select("*").order("photos"),
      db
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("generations")
        .select(
          "id,user_id,status,model,usage,estimated_usd,created_at,error_code",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("payments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("webhook_events")
        .select("*")
        .not("last_error", "is", null)
        .limit(20),
      db.auth.admin.listUsers({ page: 1, perPage: 100 }),
    ]);
    if (r.some((v) => v.error)) throw new Error("ADMIN_LOOKUP_FAILED");
    return Response.json(
      {
        products: r[0].data,
        profiles: r[1].data,
        generations: r[2].data,
        payments: r[3].data,
        events: r[4].data,
        users: r[5].data.users.map((u) => ({ id: u.id, email: u.email })),
        billing: billingStatus(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const db = adminClient();
    await rpc("amobla_account", { p_user: actor.id, p_trial: false });
    if (Number(request.headers.get("content-length") || 0) > 4096)
      throw new HttpError(413, "Solicitud inválida.");
    const body = await request.json();
    if (body.action === "price") {
      if (
        typeof body.sku !== "string" ||
        !Number.isSafeInteger(body.cents) ||
        body.cents < 100 ||
        body.cents > 1000000000
      )
        throw new HttpError(400, "Importe inválido.");
      const r = await db
        .from("products")
        .update({ price_cents: body.cents, active: body.active === true })
        .eq("sku", body.sku)
        .select("sku")
        .single();
      if (r.error) throw new Error("PRICE_UPDATE_FAILED");
      if (body.annual && body.sku.endsWith("-month")) {
        const annual = await db
          .from("products")
          .update({
            price_cents: body.cents * 10,
            active: body.active === true,
          })
          .eq("sku", body.sku.replace(/-month$/, "-year"));
        if (annual.error) throw new Error("ANNUAL_PRICE_UPDATE_FAILED");
      }
    } else if (body.action === "credit") {
      await rpc("amobla_admin_credit", {
        p_actor: actor.id,
        p_user: body.userId,
        p_photos: body.photos,
        p_reason: String(body.reason || ""),
      });
    } else if (body.action === "resolve") {
      if (typeof body.reason !== "string" || body.reason.trim().length < 10)
        throw new HttpError(400, "Dejá el motivo de la resolución.");
      const { data: job, error } = await db
        .from("generations")
        .select("id,user_id,project_id,status")
        .eq("id", body.id)
        .eq("status", "needs_review")
        .single();
      if (error || !job)
        throw new HttpError(
          409,
          "El trabajo ya no está pendiente de revisión.",
        );
      if (body.outcome === "recover") {
        const path = `${job.user_id}/${job.project_id}/${job.id}.jpg`;
        const file = await db.storage.from(BUCKET).download(path);
        if (file.error || !file.data)
          throw new HttpError(
            409,
            "No hay un resultado guardado para recuperar.",
          );
        await rpc("amobla_finish_generation", {
          p_job: job.id,
          p_status: "succeeded",
          p_result: path,
          p_bytes: file.data.size,
        });
      } else if (body.outcome === "failed")
        await rpc("amobla_finish_generation", {
          p_job: job.id,
          p_status: "failed",
          p_error: "MANUALLY_CONFIRMED_FAILURE",
        });
      else throw new HttpError(400, "Elegí una resolución válida.");
    } else if (body.action === "unblock") {
      if (typeof body.reason !== "string" || body.reason.trim().length < 10)
        throw new HttpError(400, "Dejá el motivo de la revisión.");
      const r = await db
        .from("profiles")
        .update({ blocked: false })
        .eq("id", body.userId);
      if (r.error) throw new Error("UNBLOCK_FAILED");
    } else throw new HttpError(400, "Acción inválida.");
    const audit = await db
      .from("admin_audit")
      .insert({
        actor_id: actor.id,
        action: body.action,
        subject_id: body.id || body.userId || body.sku,
        details: { ...body },
      });
    if (audit.error) throw new Error("AUDIT_SAVE_FAILED");
    return Response.json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}

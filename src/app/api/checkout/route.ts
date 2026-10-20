import {
  requireUser,
  failure,
  HttpError,
  rpc,
  isAdmin,
} from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { billingConfigured, mp } from "@/lib/commerce/mercadopago";
import type { Product } from "@/lib/commerce/catalog";
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (!billingConfigured())
      throw new HttpError(
        503,
        "Estamos preparando los pagos. Podés explorar el estudio.",
      );
    if (process.env.MERCADOPAGO_MODE !== "production" && !isAdmin(user.email))
      throw new HttpError(
        403,
        "Los pagos de prueba están reservados al equipo.",
      );
    const base = process.env.APP_URL!.replace(/\/$/, "");
    if (new URL(base).origin !== new URL(request.url).origin)
      throw new HttpError(
        503,
        "Los pagos están disponibles en el sitio principal.",
      );
    if (Number(request.headers.get("content-length") || 0) > 2048)
      throw new HttpError(413, "Solicitud inválida.");
    const { sku, key, payerEmail } = await request.json();
    if (
      typeof sku !== "string" ||
      !/^[-a-z0-9]{3,40}$/.test(sku) ||
      typeof key !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(key)
    )
      throw new HttpError(400, "Elegí un plan válido.");
    const account = await rpc<{ blocked: boolean }>("amobla_account", {
      p_user: user.id,
      p_trial: false,
    });
    if (account.blocked)
      throw new HttpError(
        403,
        "Tu cuenta necesita una revisión antes de realizar otra compra.",
      );
    const db = adminClient();
    const email =
      typeof payerEmail === "string" ? payerEmail.trim().toLowerCase() : "";
    if (
      !email ||
      typeof payerEmail !== "string" ||
      payerEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
      throw new HttpError(400, "Ingresá un email válido de Mercado Pago.");
    // An abandoned checkout for the same plan is reopened instead of blocking a new attempt.
    const open = await db
      .from("orders")
      .select("id,checkout_url,provider_subscription_id,payer_email,snapshot")
      .eq("user_id", user.id)
      .eq("sku", sku)
      .eq("status", "checkout_ready")
      .not("checkout_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (open.error) throw new Error("CHECKOUT_LOOKUP_FAILED");
    if (open.data?.checkout_url) {
      const previous = open.data;
      if (previous.payer_email === email)
        return Response.json(
          { url: previous.checkout_url },
          { headers: { "Cache-Control": "no-store" } },
        );
      if (previous.provider_subscription_id) {
        // A legacy checkout can be tied to the sign-in email. Replace only a still-pending subscription.
        const sub = await mp<{
          status: string;
          external_reference: string;
          collector_id: number;
        }>(
          `/preapproval/${encodeURIComponent(previous.provider_subscription_id)}`,
        );
        if (
          sub.external_reference !== previous.id ||
          String(sub.collector_id) !== process.env.MERCADOPAGO_COLLECTOR_ID
        )
          throw new Error("SUBSCRIPTION_OWNERSHIP_MISMATCH");
        if (sub.status !== "pending" && sub.status !== "cancelled")
          throw new HttpError(
            409,
            "Tu suscripción ya está activa o en revisión. Revisala desde Mi cuenta antes de cambiar el email.",
          );
        if (sub.status === "pending")
          await mp(
            `/preapproval/${encodeURIComponent(previous.provider_subscription_id)}`,
            "PUT",
            { status: "cancelled" },
          );
        const ended = await db
          .from("subscriptions")
          .update({ status: "cancelled" })
          .eq("id", previous.provider_subscription_id)
          .eq("user_id", user.id);
        if (ended.error) throw new Error("SUBSCRIPTION_UPDATE_FAILED");
      }
      const replaced = await db
        .from("orders")
        .update({ status: "superseded" })
        .eq("id", previous.id)
        .eq("user_id", user.id);
      if (replaced.error) throw new Error("CHECKOUT_REPLACE_FAILED");
    }
    const created = await rpc<{
      order: { snapshot: Product; checkout_url: string | null };
      dispatch: boolean;
    }>("amobla_create_order", { p_user: user.id, p_id: key, p_sku: sku });
    const snapshot = created.order.snapshot;
    if (!created.dispatch) {
      if (created.order.checkout_url)
        return Response.json({ url: created.order.checkout_url });
      throw new HttpError(
        409,
        "Estamos verificando el checkout anterior. Consultá Mi cuenta antes de volver a comprar.",
      );
    }
    const notification_url = `${base}/api/webhooks/mercadopago?token=${encodeURIComponent(process.env.MERCADOPAGO_NOTIFICATION_TOKEN!)}`;
    let checkout: {
      id: string;
      init_point: string;
      sandbox_init_point?: string;
    };
    try {
      if (snapshot.kind === "pack") {
        checkout = await mp(
          "/checkout/preferences",
          "POST",
          {
            items: [
              {
                id: sku,
                title: `amoblaIA · ${snapshot.name}`,
                quantity: 1,
                currency_id: "ARS",
                unit_price: snapshot.price_cents! / 100,
              },
            ],
            external_reference: key,
            payer: { email },
            back_urls: {
              success: `${base}/cuenta?pago=retorno`,
              pending: `${base}/cuenta?pago=pendiente`,
              failure: `${base}/cuenta?pago=rechazado`,
            },
            auto_return: "approved",
            notification_url,
            payment_methods: { default_installments: 1, installments: 1 },
          },
          key,
        );
      } else {
        checkout = await mp(
          "/preapproval",
          "POST",
          {
            reason: `amoblaIA · ${snapshot.name}`,
            external_reference: key,
            payer_email: email,
            status: "pending",
            auto_recurring: {
              frequency: snapshot.kind === "year" ? 12 : 1,
              frequency_type: "months",
              transaction_amount: snapshot.price_cents! / 100,
              currency_id: "ARS",
            },
            back_url: `${base}/cuenta?pago=retorno`,
            notification_url,
          },
          key,
        );
      }
    } catch (e) {
      await db
        .from("orders")
        .update({ status: "checkout_needs_review" })
        .eq("id", key);
      throw e;
    }
    const url =
      snapshot.kind === "pack" && process.env.MERCADOPAGO_MODE !== "production"
        ? checkout.sandbox_init_point
        : checkout.init_point;
    if (
      !url ||
      !/^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.ar)?\//i.test(url)
    )
      throw new Error("INVALID_CHECKOUT_URL");
    const saved = await db
      .from("orders")
      .update({
        checkout_id: checkout.id,
        payer_email: email,
        checkout_url: url,
        ...(snapshot.kind !== "pack"
          ? { provider_subscription_id: checkout.id }
          : {}),
        status: "checkout_ready",
      })
      .eq("id", key);
    if (saved.error) throw new Error("CHECKOUT_SAVE_FAILED");
    if (snapshot.kind !== "pack") {
      const sub = await db.from("subscriptions").insert({
        id: checkout.id,
        order_id: key,
        user_id: user.id,
        status: "pending",
      });
      if (sub.error) throw new Error("SUBSCRIPTION_SAVE_FAILED");
    }
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}

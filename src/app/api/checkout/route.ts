import {
  requireUser,
  failure,
  HttpError,
  rpc,
  isAdmin,
} from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import {
  billingConfigured,
  MercadoPagoError,
  mp,
  retireSubscription,
  settleStaleOrders,
  syncSubscription,
  verifyCheckoutPayer,
  checkoutUrl,
} from "@/lib/commerce/mercadopago";
import { firstChargeCents, type Product } from "@/lib/commerce/catalog";

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
    const { sku, key, payerEmail, cardToken } = await request.json();
    // Card entry and tokenization now belong entirely to MP's hosted checkout.
    // An old tab must reload rather than accidentally using the retired flow.
    if (cardToken !== undefined)
      throw new HttpError(
        400,
        "Actualizamos el pago. Recargá la página para continuar en Mercado Pago.",
      );
    if (
      typeof sku !== "string" ||
      !/^[-a-z0-9]{3,40}$/.test(sku) ||
      typeof key !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(key)
    )
      throw new HttpError(400, "Elegí un plan válido.");
    const pack = sku.startsWith("pack-");
    const email =
      typeof payerEmail === "string" ? payerEmail.trim().toLowerCase() : "";
    if (
      !pack &&
      (!email ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
      throw new HttpError(
        400,
        "Ingresá el email que vas a usar en Mercado Pago.",
      );
    // Pro collects its own payer. Subscription links need the payer's explicit
    // email; neither flow silently binds a purchase to the Google email.
    await verifyCheckoutPayer(pack ? "" : email);
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
    await settleStaleOrders(user.id, [user.email || ""]).catch(() =>
      console.error("stale_orders_not_settled", user.id),
    );
    let replacing: { id: string; order_id: string } | null = null;
    if (!pack) {
      const current = await db
        .from("subscriptions")
        .select("id,order_id,status,orders(sku)")
        .eq("user_id", user.id)
        .in("status", ["authorized", "paused"])
        .limit(1)
        .maybeSingle();
      if (current.error) throw new Error("SUBSCRIPTION_LOOKUP_FAILED");
      if (current.data) {
        if (
          (current.data.orders as unknown as { sku: string } | null)?.sku ===
          sku
        )
          throw new HttpError(
            409,
            "Ya tenés este plan. Revisalo desde Mi cuenta.",
          );
        replacing = { id: current.data.id, order_id: current.data.order_id };
      }
      // Reopen only after checking the provider. A paid/authorized checkout
      // must never be reused or cancelled as if it were merely abandoned.
      const open = await db
        .from("orders")
        .select("id,sku,checkout_url,provider_subscription_id,payer_email")
        .eq("user_id", user.id)
        .eq("status", "checkout_ready")
        .not("provider_subscription_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(10);
      if (open.error) throw new Error("CHECKOUT_LOOKUP_FAILED");
      for (const previous of open.data || []) {
        if (previous.id === replacing?.order_id) continue;
        const { sub } = await syncSubscription(
          previous.provider_subscription_id!,
        );
        if (["authorized", "paused"].includes(sub.status))
          throw new HttpError(
            409,
            "Estamos confirmando tu suscripción. Revisala desde Mi cuenta antes de volver a comprar.",
          );
        if (
          sub.status === "pending" &&
          previous.sku === sku &&
          previous.payer_email === email &&
          previous.checkout_url
        )
          return Response.json(
            { url: checkoutUrl(previous.checkout_url), order: previous.id },
            { headers: { "Cache-Control": "no-store" } },
          );
        if (sub.status === "pending") await retireSubscription(sub.id);
        const closed = await db
          .from("orders")
          .update({ status: "superseded" })
          .eq("id", previous.id)
          .eq("user_id", user.id);
        if (closed.error) throw new Error("CHECKOUT_REPLACE_FAILED");
      }
    }
    const created = await rpc<{
      order: {
        id: string;
        snapshot: Product;
        checkout_url: string | null;
        payer_email: string | null;
        status: string;
      };
      dispatch: boolean;
    }>("amobla_create_order", {
      p_user: user.id,
      p_id: key,
      p_sku: sku,
      ...(replacing ? { p_replace: true } : {}),
    });
    const snapshot = created.order.snapshot;
    if (!created.dispatch) {
      if (
        created.order.checkout_url &&
        created.order.status === "checkout_ready" &&
        (pack || created.order.payer_email === email)
      )
        return Response.json(
          {
            url: checkoutUrl(created.order.checkout_url),
            order: created.order.id,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      throw new HttpError(
        409,
        "Estamos verificando el checkout anterior. Consultá Mi cuenta antes de volver a comprar.",
      );
    }
    const noted = await db
      .from("orders")
      .update({ payer_email: pack ? null : email })
      .eq("id", key);
    if (noted.error) throw new Error("ORDER_SAVE_FAILED");
    const notification_url = `${base}/api/webhooks/mercadopago?token=${encodeURIComponent(process.env.MERCADOPAGO_NOTIFICATION_TOKEN!)}`;
    const back = `${base}/cuenta?orden=${encodeURIComponent(key)}`;
    let checkout: {
      id: string;
      init_point: string;
      sandbox_init_point?: string;
    };
    try {
      checkout =
        snapshot.kind === "pack"
          ? await mp(
              "/checkout/preferences",
              "POST",
              {
                items: [
                  {
                    id: sku,
                    title: `habita. · ${snapshot.name}`,
                    quantity: 1,
                    currency_id: "ARS",
                    unit_price: snapshot.price_cents! / 100,
                  },
                ],
                external_reference: key,
                back_urls: {
                  success: `${back}&pago=retorno`,
                  pending: `${back}&pago=pendiente`,
                  failure: `${back}&pago=rechazado`,
                },
                auto_return: "approved",
                notification_url,
                payment_methods: { default_installments: 1, installments: 1 },
              },
              key,
            )
          : await mp(
              "/preapproval",
              "POST",
              {
                reason: `habita. · ${snapshot.name}`,
                external_reference: key,
                payer_email: email,
                status: "pending",
                auto_recurring: {
                  frequency: snapshot.kind === "year" ? 12 : 1,
                  frequency_type: "months",
                  // The launch price, if the order kept one; the list price
                  // replaces it after its first months (syncPayment).
                  transaction_amount: firstChargeCents(snapshot) / 100,
                  currency_id: "ARS",
                },
                back_url: `${back}&pago=retorno`,
                notification_url,
              },
              key,
            );
    } catch (e) {
      const refused =
        e instanceof MercadoPagoError &&
        e.status >= 400 &&
        e.status < 500 &&
        ![408, 409, 429].includes(e.status);
      await db
        .from("orders")
        .update({
          status: refused ? "checkout_failed" : "checkout_needs_review",
        })
        .eq("id", key);
      if (refused)
        throw new HttpError(
          402,
          "Mercado Pago no pudo abrir esta compra. Intentá de nuevo o contactanos desde Soporte.",
        );
      throw e;
    }
    const url = checkoutUrl(
      snapshot.kind === "pack" && process.env.MERCADOPAGO_MODE !== "production"
        ? checkout.sandbox_init_point
        : checkout.init_point,
    );
    const saved = await db
      .from("orders")
      .update({
        checkout_id: checkout.id,
        checkout_url: url,
        ...(snapshot.kind !== "pack"
          ? { provider_subscription_id: checkout.id }
          : {}),
        status: "checkout_ready",
      })
      .eq("id", key);
    if (saved.error) throw new Error("CHECKOUT_SAVE_FAILED");
    // A plan change can have one pending order beside its still-active plan.
    // It is materialized as an active subscription only after the first paid
    // invoice is verified, preserving the unique active-plan constraint.
    return Response.json(
      { url, order: key },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

import "server-only";
import { adminClient } from "@/lib/supabase/server";
import { HttpError } from "./http";
import {
  checkoutUrl,
  mp,
  syncPayment,
  settleStaleOrders,
  syncSubscription,
  type Order,
  type Payment,
} from "./mercadopago";
import type { CheckoutResult } from "./checkout-result";

/** Only a server-owned order selects what to reconcile. Browser return
 * parameters such as status, payment_id or preapproval_id are never trusted. */
export async function reconcileCheckout(
  userId: string,
  orderId: string,
): Promise<CheckoutResult> {
  const db = adminClient();
  const owned = await db
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (owned.error) throw new Error("ORDER_LOOKUP_FAILED");
  if (!owned.data)
    throw new HttpError(404, "No encontramos esa compra en tu cuenta.");
  let order = owned.data as Order;
  if (
    !order.provider_subscription_id &&
    order.snapshot.kind !== "pack" &&
    ["creating", "checkout_needs_review"].includes(order.status)
  ) {
    await settleStaleOrders(userId, []).catch(() =>
      console.error("checkout_recovery_deferred", orderId),
    );
    const recovered = await db
      .from("orders")
      .select("*")
      .eq("id", order.id)
      .eq("user_id", userId)
      .single();
    if (recovered.error) throw new Error("ORDER_LOOKUP_FAILED");
    order = recovered.data as Order;
  }
  let providerStatus = "";
  let uncertain = false;
  try {
    if (order.provider_subscription_id) {
      const { sub } = await syncSubscription(order.provider_subscription_id);
      providerStatus = sub.status;
      const invoices = await mp<{
        results: {
          preapproval_id: string;
          date_created?: string;
          last_modified?: string;
          payment?: { id: string | number };
        }[];
      }>(
        `/authorized_payments/search?preapproval_id=${encodeURIComponent(sub.id)}&limit=100`,
      );
      const ids = [
        ...new Set(
          invoices.results
            .sort(
              (a, b) =>
                Date.parse(b.last_modified || b.date_created || "1970-01-01") -
                Date.parse(a.last_modified || a.date_created || "1970-01-01"),
            )
            .filter((i) => i.preapproval_id === sub.id && i.payment?.id)
            .map((i) => String(i.payment!.id)),
        ),
      ];
      // The first checkout has at most a handful of attempts. Keep work bounded
      // for long-lived subscriptions; recurring invoices also arrive by webhook.
      for (const id of ids.slice(0, 3)) await syncPayment(id, sub.id);
    } else if (order.snapshot.kind === "pack" && order.status !== "creating") {
      const found = await mp<{ results: Payment[] }>(
        `/v1/payments/search?external_reference=${encodeURIComponent(order.id)}&sort=date_created&criteria=desc&limit=20`,
      );
      for (const payment of found.results
        .filter((p) => p.external_reference === order.id)
        .slice(0, 5))
        await syncPayment(String(payment.id));
    }
  } catch {
    uncertain = true;
    console.error("checkout_reconciliation_deferred", order.id);
  }
  const [fresh, payments] = await Promise.all([
    db.from("orders").select("status,checkout_url").eq("id", order.id).single(),
    db
      .from("payments")
      .select("status,coverage_start")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (fresh.error || payments.error)
    throw new Error("CHECKOUT_RESULT_LOOKUP_FAILED");
  const rows = payments.data || [];
  const approved = rows.some(
    (p) =>
      ["approved", "partially_refunded"].includes(p.status) && p.coverage_start,
  );
  const reversed =
    !approved &&
    rows.some((p) =>
      ["refunded", "charged_back", "in_mediation"].includes(p.status),
    );
  const rejected = rows.some((p) => p.status === "rejected");
  const inProcess = rows.some((p) =>
    ["pending", "in_process", "authorized"].includes(p.status),
  );
  const status = fresh.data.status;
  const state = approved
    ? "approved"
    : reversed
      ? "refunded"
      : uncertain || status === "checkout_needs_review"
        ? "review"
        : inProcess
          ? "pending"
          : ["cancelled", "superseded"].includes(status) ||
              providerStatus === "cancelled"
            ? "cancelled"
            : rejected || status === "checkout_failed"
              ? "rejected"
              : providerStatus === "authorized" || status === "creating"
                ? "pending"
                : "ready";
  let url: string | null = null;
  if (["ready", "rejected"].includes(state) && fresh.data.checkout_url) {
    try {
      url = checkoutUrl(fresh.data.checkout_url);
    } catch {
      /* Never return an unsafe destination. */
    }
  }
  return { order: order.id, state, name: order.snapshot.name, url };
}

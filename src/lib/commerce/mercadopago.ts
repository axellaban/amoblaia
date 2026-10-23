import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/supabase/server";
import { HttpError, rpc } from "./http";
import { acceptedChargeCents, isFullyReversed, type Product } from "./catalog";
export type Order = {
  id: string;
  user_id: string;
  snapshot: Product;
  provider_subscription_id: string | null;
  checkout_url: string | null;
  status: string;
  /** Subscription this order replaces in a plan change (2026-10-21 migration). */
  replaces_subscription_id?: string | null;
};
type Subscription = {
  id: string;
  collector_id: number;
  external_reference: string;
  status: string;
  auto_recurring: {
    currency_id: string;
    frequency: number;
    frequency_type: string;
    transaction_amount: number | string;
  };
};
export type Payment = {
  id: number | string;
  collector_id: number | string;
  external_reference: string;
  currency_id: string;
  transaction_amount: number | string;
  transaction_amount_refunded?: number;
  status: string;
  live_mode: boolean;
  date_approved: string | null;
  date_created: string;
};
export function moneyCents(value: number | string) {
  const s = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("INVALID_MONEY");
  const [a, b = ""] = s.split(".");
  const cents = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error("INVALID_MONEY");
  return cents;
}
export function validWebhookSignature(
  headers: Headers,
  id: string,
  secret: string,
) {
  const parts = Object.fromEntries(
    (headers.get("x-signature") || "")
      .split(",")
      .map((s) => s.trim().split("=")),
  );
  const requestId = headers.get("x-request-id");
  if (
    !requestId ||
    !/^\d+$/.test(parts.ts || "") ||
    !/^[0-9a-f]{64}$/i.test(parts.v1 || "")
  )
    return false;
  const signature = createHmac("sha256", secret)
    .update(`id:${id.toLowerCase()};request-id:${requestId};ts:${parts.ts};`)
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(parts.v1, "hex"),
  );
}
/** Names (never values) of the settings that still block checkout. */
export function billingStatus() {
  const env = process.env;
  const checks: [string, unknown][] = [
    ["BILLING_ENABLED", env.BILLING_ENABLED === "true"],
    ["MERCADOPAGO_ACCESS_TOKEN", env.MERCADOPAGO_ACCESS_TOKEN],
    ["MERCADOPAGO_COLLECTOR_ID", env.MERCADOPAGO_COLLECTOR_ID],
    ["MERCADOPAGO_NOTIFICATION_TOKEN", env.MERCADOPAGO_NOTIFICATION_TOKEN],
    ["APP_URL", env.APP_URL],
    ["SELLER_NAME", env.SELLER_NAME],
    ["SELLER_CUIT", env.SELLER_CUIT],
    [
      "SUPPORT_EMAIL o NEXT_PUBLIC_CONTACT_URL",
      env.SUPPORT_EMAIL || env.NEXT_PUBLIC_CONTACT_URL,
    ],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  return {
    ready: missing.length === 0,
    mode: env.MERCADOPAGO_MODE === "production" ? "production" : "test",
    missing,
  };
}
export function billingConfigured() {
  return billingStatus().ready;
}
/** A Mercado Pago API refusal; `reason` is its response body, for support. */
export class MercadoPagoError extends Error {
  constructor(
    public status: number,
    public reason: string,
  ) {
    super(`MERCADOPAGO_${status}`);
  }
}
export async function mp<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token)
    throw new HttpError(503, "Los pagos todavía no están habilitados.");
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(key ? { "X-Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) {
    // Mercado Pago's reason (e.g. a card or payer error) is kept for support;
    // its body holds no credentials.
    const reason = await response.text().catch(() => "");
    console.error(
      "mercadopago_error",
      method,
      path.split("?")[0].replace(/\/[^/]*\d[^/]*$/, "/:id"),
      response.status,
      reason.slice(0, 300),
    );
    throw new MercadoPagoError(response.status, reason.slice(0, 300));
  }
  return response.json() as Promise<T>;
}
/** Accept only HTTPS checkout destinations controlled by Mercado Pago. */
export function checkoutUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("INVALID_CHECKOUT_URL");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !/(^|\.)mercadopago\.com(\.ar)?$/.test(url.hostname)
  )
    throw new Error("INVALID_CHECKOUT_URL");
  return url.toString();
}
function verifySeller(id: number | string) {
  if (
    !process.env.MERCADOPAGO_COLLECTOR_ID ||
    String(id) !== process.env.MERCADOPAGO_COLLECTOR_ID
  )
    throw new Error("SELLER_MISMATCH");
}
/** Read-only check before collecting a card or creating any order/subscription. */
export async function verifyCheckoutPayer(email: string) {
  const merchant = await mp<{
    id: number;
    email: string;
    site_id: string;
    country_id: string;
  }>("/users/me");
  if (
    String(merchant.id) !== process.env.MERCADOPAGO_COLLECTOR_ID ||
    merchant.site_id !== "MLA" ||
    merchant.country_id !== "AR"
  )
    throw new HttpError(
      503,
      "Necesitamos revisar la configuración de Mercado Pago antes de recibir pagos. Contactanos desde Soporte.",
    );
  if (email.trim().toLowerCase() === merchant.email?.trim().toLowerCase())
    throw new HttpError(
      400,
      "El email para el pago corresponde a la cuenta que cobra en amoblaIA. Para probar una compra, usá una cuenta compradora distinta de la vendedora.",
    );
}
export function validatePayment(payment: Payment, order: Order) {
  verifySeller(payment.collector_id);
  if (
    payment.currency_id !== "ARS" ||
    !acceptedChargeCents(order.snapshot).includes(
      moneyCents(payment.transaction_amount),
    )
  )
    throw new Error("PAYMENT_AMOUNT_MISMATCH");
  if (payment.live_mode !== (process.env.MERCADOPAGO_MODE === "production"))
    throw new Error("PAYMENT_MODE_MISMATCH");
  if (order.snapshot.kind === "pack" && payment.external_reference !== order.id)
    throw new Error("PAYMENT_ORDER_MISMATCH");
}
/** True only when this very subscription row already exists. A clash with
 * another open subscription of the user (subscriptions_one_open) is an error:
 * ignoring it would leave a paid subscription without its row. */
export function isDuplicateSubscription(error: {
  code?: string;
  message?: string;
}) {
  return error.code === "23505" && !/one_open/.test(error.message || "");
}
async function getOrder(id: string) {
  const { data, error } = await adminClient()
    .from("orders")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("ORDER_NOT_FOUND");
  return data as Order;
}
/**
 * Cancels a subscription in Mercado Pago and in our records. When the
 * cancellation call fails or times out, the real state is read back: it may
 * well have been applied.
 */
export async function retireSubscription(id: string) {
  const path = `/preapproval/${encodeURIComponent(id)}`;
  try {
    await mp(path, "PUT", { status: "cancelled" });
  } catch (e) {
    const now = await mp<{ status: string }>(path).catch(() => null);
    if (now?.status !== "cancelled") throw e;
  }
  const db = adminClient();
  const ended = await db
    .from("subscriptions")
    .update({ status: "cancelled" })
    .eq("id", id)
    .select("order_id")
    .maybeSingle();
  if (ended.error) throw new Error("SUBSCRIPTION_UPDATE_FAILED");
  if (ended.data)
    await db
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", ended.data.order_id);
}
export async function syncSubscription(id: string, paidPayment?: Payment) {
  const sub = await mp<Subscription>(`/preapproval/${encodeURIComponent(id)}`);
  verifySeller(sub.collector_id);
  let order = await getOrder(String(sub.external_reference));
  // Mercado Pago may have created the subscription while saving its id
  // failed (timeout, crash). The verified seller and our own order id in
  // external_reference identify it, so the order adopts it instead of the
  // payment being stranded.
  if (
    !order.provider_subscription_id &&
    ["creating", "checkout_needs_review", "checkout_failed"].includes(
      order.status,
    )
  ) {
    const adopted = await adminClient()
      .from("orders")
      .update({
        provider_subscription_id: sub.id,
        checkout_id: sub.id,
        status: "checkout_ready",
      })
      .eq("id", order.id)
      .is("provider_subscription_id", null);
    if (adopted.error) throw new Error("ORDER_ADOPT_FAILED");
    order = await getOrder(order.id);
  }
  const a = sub.auto_recurring;
  if (
    order.provider_subscription_id !== sub.id ||
    order.snapshot.kind === "pack" ||
    a.currency_id !== "ARS" ||
    !acceptedChargeCents(order.snapshot).includes(
      moneyCents(a.transaction_amount),
    ) ||
    a.frequency_type !== "months" ||
    a.frequency !== (order.snapshot.kind === "year" ? 12 : 1)
  )
    throw new Error("SUBSCRIPTION_MISMATCH");
  const db = adminClient();
  // Validate the actual paid invoice before changing the previous plan.
  // Authorizing a mandate is not a first charge, and abandoned links must
  // leave the current subscription and its renewal untouched.
  if (paidPayment) validatePayment(paidPayment, order);
  const paid = Boolean(
    paidPayment &&
    ["approved", "partially_refunded"].includes(paidPayment.status),
  );
  if (
    order.replaces_subscription_id &&
    order.status !== "paid" &&
    !paid &&
    ["pending", "authorized", "paused"].includes(sub.status)
  )
    return { sub, order };
  if (sub.status === "authorized" && order.replaces_subscription_id) {
    const old = await db
      .from("subscriptions")
      .select("status")
      .eq("id", order.replaces_subscription_id)
      .maybeSingle();
    if (old.error) throw new Error("SUBSCRIPTION_LOOKUP_FAILED");
    if (old.data && old.data.status !== "cancelled") {
      try {
        await retireSubscription(order.replaces_subscription_id);
      } catch {
        await db
          .from("orders")
          .update({ status: "checkout_needs_review" })
          .eq("id", order.id);
        throw new Error("PLAN_CHANGE_CANCELLATION_PENDING");
      }
    }
  }
  const saved = await db
    .from("subscriptions")
    .update({ status: sub.status })
    .eq("id", sub.id)
    .select("id")
    .maybeSingle();
  if (saved.error) throw new Error("SUBSCRIPTION_SAVE_FAILED");
  if (!saved.data) {
    const created = await db.from("subscriptions").insert({
      id: sub.id,
      order_id: order.id,
      user_id: order.user_id,
      status: sub.status,
    });
    if (created.error && !isDuplicateSubscription(created.error))
      throw new Error("SUBSCRIPTION_SAVE_FAILED");
  }
  if (sub.status === "cancelled")
    await db.from("orders").update({ status: "cancelled" }).eq("id", order.id);
  return { sub, order };
}
/**
 * Orders left half-way (a timeout, a crash, a redirect checkout that never
 * opened) would block every new purchase forever. After ten minutes, an
 * order without a subscription is checked against Mercado Pago: one that
 * exists there is adopted, otherwise nothing was created and it is closed.
 */
export async function settleStaleOrders(userId: string, emails: string[]) {
  const db = adminClient();
  const { data, error } = await db
    .from("orders")
    .select("id,snapshot,payer_email")
    .eq("user_id", userId)
    .in("status", ["creating", "checkout_needs_review"])
    .is("provider_subscription_id", null)
    .lt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if (error) throw new Error("ORDER_LOOKUP_FAILED");
  for (const order of data || []) {
    // A pack payment carries the order id and is credited from its webhook
    // whatever this status, so closing a pack checkout loses nothing.
    if ((order.snapshot as Product).kind !== "pack") {
      const searched = new Set(
        [order.payer_email, ...emails]
          .filter((e): e is string => Boolean(e))
          .map((e) => e.toLowerCase()),
      );
      let found: string | null = null;
      for (const email of searched) {
        const { results } = await mp<{
          results: { id: string; external_reference: string | null }[];
        }>(
          `/preapproval/search?payer_email=${encodeURIComponent(email)}&limit=100`,
        );
        found =
          results.find((s) => s.external_reference === order.id)?.id || null;
        if (found) break;
      }
      if (found) {
        await syncSubscription(found);
        continue;
      }
    }
    await db
      .from("orders")
      .update({ status: "checkout_failed" })
      .eq("id", order.id)
      .is("provider_subscription_id", null);
  }
}
export async function syncPayment(id: string, subscriptionId?: string) {
  const payment = await mp<Payment>(`/v1/payments/${encodeURIComponent(id)}`);
  let order: Order;
  if (subscriptionId) {
    const linked = await syncSubscription(subscriptionId, payment);
    order = linked.order;
    // The caller obtained this binding from a provider-verified invoice.
  } else {
    const external = String(payment.external_reference || "");
    let direct: Order | null = null;
    if (/^[0-9a-f-]{36}$/i.test(external)) direct = await getOrder(external);
    if (direct?.snapshot.kind === "pack") order = direct;
    else {
      const invoices = await mp<{ results: AuthorizedInvoice[] }>(
        `/authorized_payments/search?payment_id=${encodeURIComponent(id)}`,
      );
      const invoice = invoices.results.find(
        (i) =>
          String(i.payment?.id) === String(payment.id) &&
          (!direct || i.preapproval_id === direct.provider_subscription_id),
      );
      if (!invoice) {
        // An unrelated merchant payment with no amoblaIA reference is ignored;
        // an invoice for one of our orders must remain retryable.
        if (!direct) return;
        throw new Error("SUBSCRIPTION_INVOICE_NOT_FOUND");
      }
      subscriptionId = invoice.preapproval_id;
      const linked = await syncSubscription(subscriptionId, payment);
      order = linked.order;
      if (direct && direct.id !== order.id)
        throw new Error("PAYMENT_ORDER_MISMATCH");
    }
  }
  validatePayment(payment, order);
  // Only an approval with money given back is a partial refund: a chargeback
  // or a dispute can also report refunded amounts and must keep its status.
  const status =
    (payment.transaction_amount_refunded || 0) > 0 &&
    payment.status === "approved"
      ? "partially_refunded"
      : payment.status;
  await rpc("amobla_apply_payment", {
    p_id: String(payment.id),
    p_order: order.id,
    p_status: status,
    p_amount: moneyCents(payment.transaction_amount),
    p_paid_at: payment.date_approved || payment.date_created,
    p_subscription: subscriptionId || null,
  });
  // The payment is already credited: a failed switch is retried by the
  // daily cron instead of failing this notification over and over.
  if (
    subscriptionId &&
    order.snapshot.promo_price_cents &&
    ["approved", "partially_refunded"].includes(status)
  )
    await endLaunchPrice(subscriptionId, order).catch(() =>
      console.error("launch_price_not_ended", subscriptionId),
    );
  // A full refund or a chargeback undoes the purchase: renewals must stop,
  // or a blocked account would keep being charged every month. A failure is
  // thrown so the notification is retried.
  if (subscriptionId && ["refunded", "charged_back"].includes(status)) {
    const { data, error } = await adminClient()
      .from("subscriptions")
      .select("status")
      .eq("id", subscriptionId)
      .maybeSingle();
    if (error) throw new Error("SUBSCRIPTION_LOOKUP_FAILED");
    if (data && data.status !== "cancelled")
      await retireSubscription(subscriptionId);
  }
}
type AuthorizedInvoice = {
  id: string | number;
  preapproval_id: string;
  payment?: { id: number | string };
};
/** Some subscription notifications precede the invoice's detail endpoint.
 * The search API is an independent, read-only recovery path. A missing
 * invoice stays retryable; a callback alone never becomes an approval. */
export async function authorizedInvoice(id: string) {
  try {
    const invoice = await mp<AuthorizedInvoice>(
      `/authorized_payments/${encodeURIComponent(id)}`,
    );
    if (String(invoice.id) !== id) throw new Error("INVOICE_ID_MISMATCH");
    return invoice;
  } catch (e) {
    if (!(e instanceof MercadoPagoError) || e.status !== 404) throw e;
    const found = await mp<{ results: AuthorizedInvoice[] }>(
      `/authorized_payments/search?id=${encodeURIComponent(id)}`,
    );
    const invoice = found.results.find((i) => String(i.id) === id);
    if (!invoice) throw e;
    return invoice;
  }
}
/**
 * After the launch months have been paid, the next renewals are charged at
 * the list price kept in the order. Idempotent, so it can be retried.
 */
export async function endLaunchPrice(subscriptionId: string, order: Order) {
  const { promo_months: months, price_cents: list } = order.snapshot;
  if (!months || !list) return;
  const paid = await adminClient()
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id)
    .not("coverage_start", "is", null);
  if (paid.error) throw new Error("PAYMENT_LOOKUP_FAILED");
  if ((paid.count || 0) < months) return;
  const path = `/preapproval/${encodeURIComponent(subscriptionId)}`;
  const sub = await mp<Subscription>(path);
  verifySeller(sub.collector_id);
  if (
    sub.status === "cancelled" ||
    moneyCents(sub.auto_recurring.transaction_amount) === list
  )
    return;
  await mp(path, "PUT", {
    auto_recurring: { transaction_amount: list / 100, currency_id: "ARS" },
  });
}
/** Daily fallback for launch prices whose switch failed in the webhook. */
export async function endLaunchPrices() {
  const { data, error } = await adminClient()
    .from("subscriptions")
    .select("id,orders(*)")
    .eq("status", "authorized")
    .limit(200);
  if (error) throw new Error("SUBSCRIPTION_LOOKUP_FAILED");
  for (const row of data || []) {
    const order = row.orders as unknown as Order | null;
    if (!order?.snapshot.promo_price_cents) continue;
    await endLaunchPrice(row.id, order).catch(() =>
      console.error("launch_price_not_ended", row.id),
    );
  }
}
/** Daily fallback: a subscription whose charges were all refunded must stop
 * renewing even if the refund was processed without cancelling it (a deploy
 * that predates that rule, a lost notification). */
export async function retireReversedSubscriptions() {
  const { data, error } = await adminClient()
    .from("subscriptions")
    .select("id,orders(payments(status))")
    .in("status", ["authorized", "paused"])
    .limit(200);
  if (error) throw new Error("SUBSCRIPTION_LOOKUP_FAILED");
  for (const row of data || []) {
    const order = row.orders as unknown as {
      payments: { status: string }[];
    } | null;
    if (!isFullyReversed((order?.payments || []).map((p) => p.status)))
      continue;
    await retireSubscription(row.id).catch(() =>
      console.error("reversed_subscription_not_retired", row.id),
    );
  }
}
export async function processBillingEvent(topic: string, id: string) {
  if (topic === "payment") return syncPayment(id);
  if (topic === "subscription_preapproval") {
    await syncSubscription(id);
    return;
  }
  if (topic === "subscription_authorized_payment") {
    const invoice = await authorizedInvoice(id);
    if (invoice.payment?.id)
      await syncPayment(String(invoice.payment.id), invoice.preapproval_id);
  }
}
/** Processes a stored notification; false means it failed and must be retried. */
export async function processInbox(key: string, topic: string, id: string) {
  const db = adminClient();
  try {
    const existing = await db
      .from("webhook_events")
      .select("processed_at")
      .eq("event_key", key)
      .maybeSingle();
    if (existing.error) throw new Error("INBOX_LOOKUP_FAILED");
    if (existing.data?.processed_at) return true;
    await processBillingEvent(topic, id);
    const r = await db
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString(), last_error: null })
      .eq("event_key", key);
    if (r.error) throw new Error("INBOX_SAVE_FAILED");
    return true;
  } catch (e) {
    const code =
      e instanceof Error ? e.message.slice(0, 80) : "PROCESSING_FAILED";
    // Counting attempts lets the retry queue put events that keep failing
    // behind fresh ones (amobla_inbox_failed needs the 20261021 migration).
    const counted = await db.rpc("amobla_inbox_failed", {
      p_key: key,
      p_error: code,
    });
    if (counted.error)
      await db
        .from("webhook_events")
        .update({ last_error: code })
        .eq("event_key", key);
    return false;
  }
}

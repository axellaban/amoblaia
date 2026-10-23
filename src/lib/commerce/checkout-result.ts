export type CheckoutState =
  | "approved"
  | "pending"
  | "ready"
  | "rejected"
  | "cancelled"
  | "review"
  | "refunded"
  | "duplicate";
export type CheckoutResult = {
  order: string;
  state: CheckoutState;
  name: string;
  url: string | null;
  /** Approved charge in ARS, for conversion tracking. */
  value?: number | null;
};
export const checkoutMessages: Record<CheckoutState, string> = {
  approved: "¡Pago confirmado! Tus fotos ya están disponibles.",
  pending: "Estamos confirmando tu pago con Mercado Pago.",
  ready: "Tu pago todavía no se completó. Podés continuar en Mercado Pago.",
  rejected:
    "Mercado Pago rechazó el intento de pago. Podés elegir otro medio de pago allí.",
  cancelled:
    "Este checkout está cerrado. Podés elegir un plan para volver a empezar.",
  review:
    "Estamos verificando tu compra. No vuelvas a pagar mientras la revisamos.",
  refunded:
    "El pago fue reintegrado o está en revisión. Consultá el detalle en Mi cuenta.",
  duplicate:
    "Ya tenías esta compra, así que no te cobramos dos veces: te devolvemos este pago.",
};

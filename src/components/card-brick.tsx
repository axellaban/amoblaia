"use client";
import { useEffect, useId, useRef, useState } from "react";

// Mercado Pago's Card Payment Brick: card fields hosted by Mercado Pago, so
// card numbers never reach amoblaIA. It only hands us a single-use token.
type CardData = { token: string; payer: { email: string } };
type Controller = { unmount(): void };
type MercadoPagoSdk = new (
  key: string,
  options: { locale: string },
) => {
  bricks(): {
    create(
      kind: "cardPayment",
      container: string,
      settings: Record<string, unknown>,
    ): Promise<Controller>;
  };
};
declare global {
  interface Window {
    MercadoPago?: MercadoPagoSdk;
  }
}
export const mercadoPagoPublicKey =
  process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY || "";
let sdk: Promise<void> | null = null;
function loadSdk() {
  if (window.MercadoPago) return Promise.resolve();
  sdk ||= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.mercadopago.com/js/v2";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdk = null;
      script.remove();
      reject(new Error("MERCADOPAGO_SDK_FAILED"));
    };
    document.head.appendChild(script);
  });
  return sdk;
}
export function CardBrick({
  amount,
  onToken,
}: {
  amount: number;
  /** Resolves when the subscription was created; rejects to let the buyer retry. */
  onToken: (token: string, payerEmail: string) => Promise<void>;
}) {
  const container = `card-brick-${useId().replace(/:/g, "")}`;
  const submit = useRef(onToken);
  submit.current = onToken;
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let controller: Controller | null = null;
    let active = true;
    loadSdk()
      .then(async () => {
        if (!active || !window.MercadoPago) return;
        const mp = new window.MercadoPago(mercadoPagoPublicKey, {
          locale: "es-AR",
        });
        controller = await mp.bricks().create("cardPayment", container, {
          initialization: {
            amount,
            // Supplying the Google email here hides the Brick's email field.
            // Keep it editable: the payer may use another email or MP country.
          },
          customization: {
            paymentMethods: { maxInstallments: 1 },
            visual: {
              hideFormTitle: true,
              style: { customVariables: { baseColor: "#2e5fcb" } },
              texts: {
                formSubmit: "Suscribirme",
                email: { label: "Email para el pago" },
              },
            },
          },
          callbacks: {
            onReady: () => active && setState("ready"),
            onError: () => undefined,
            onSubmit: (data: CardData) =>
              submit.current(data.token, data.payer.email),
          },
        });
        if (!active) controller.unmount();
      })
      .catch(() => active && setState("failed"));
    return () => {
      active = false;
      controller?.unmount();
    };
  }, [amount, container]);
  return (
    <div className="card-brick">
      {state === "loading" && (
        <p role="status">Cargando el formulario de pago…</p>
      )}
      {state === "failed" && (
        <p className="inline-error" role="alert">
          No pudimos cargar el formulario de Mercado Pago. Revisá tu conexión o
          el bloqueador de contenido y volvé a intentarlo.
        </p>
      )}
      <div id={container} />
    </div>
  );
}

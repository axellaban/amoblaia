// The preview of a shared prices link (/precios, and /panel/precios, which
// leads here for anyone without a session, as messaging apps are): the price
// card as an image, with the catalog's real prices. Refreshed every hour.
import { ImageResponse } from "next/og";
import { adminClient } from "@/lib/supabase/server";
import { cloudConfigured } from "@/lib/supabase/config";
import { formatARS, type Product } from "@/lib/commerce/catalog";
import { creditPackages, FREE_MONTHLY_CREDITS } from "@/lib/commerce/credit-packs";
import { MODE_INFO, VIDEO_CREDITS } from "@/lib/video/plan";

export const alt = "Precios de habita.: plan Gratis con 10 créditos por mes y paquetes de créditos sin suscripción";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

const FOREST = "#24382e";
const INK = "#242824";
const SUBTLE = "#6b6b6b";
const LINE = "#e6dfd3";
const ars = (cents: number) => formatARS(cents).replace(/\s/g, "");

export default async function Image() {
  let products: Product[] = [];
  if (cloudConfigured()) {
    try {
      const { data } = await adminClient().from("products").select("*");
      products = (data || []) as Product[];
    } catch {
      /* Without the catalog the card still shows the offer, without amounts. */
    }
  }
  const packages = creditPackages(products);
  const uses: [string, string][] = [
    ["Foto transformada con IA", "1 crédito"],
    ...(["classic", "clip", "cinematic"] as const).map((m): [string, string] => [
      `Video · ${MODE_INFO[m].name}`,
      VIDEO_CREDITS[m] ? `${VIDEO_CREDITS[m]} créditos` : "Sin créditos",
    ]),
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#f8f5ef", padding: 44, gap: 36, color: INK }}>
        <div style={{ display: "flex", flexDirection: "column", width: 470, justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 44, color: FOREST, letterSpacing: -1 }}>habita.</div>
            <div style={{ display: "flex", fontSize: 58, lineHeight: 1.05, marginTop: 26, letterSpacing: -2 }}>Precios</div>
            <div style={{ display: "flex", fontSize: 26, color: SUBTLE, marginTop: 14, lineHeight: 1.3 }}>
              Empezá gratis. Pagá solo los créditos que uses, sin suscripción.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#e5ece1", borderRadius: 24, padding: "24px 28px" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 34 }}>Gratis</div>
              <div style={{ display: "flex", fontSize: 26, color: INK, marginTop: 6 }}>{FREE_MONTHLY_CREDITS} créditos por mes</div>
              <div style={{ display: "flex", fontSize: 22, color: SUBTLE, marginTop: 2 }}>Sin tarjeta</div>
            </div>
            <div style={{ display: "flex", fontSize: 56, color: FOREST, marginLeft: 20 }}>$0</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#fff", borderRadius: 28, border: `2px solid ${LINE}`, padding: "26px 32px" }}>
          <div style={{ display: "flex", fontSize: 20, color: SUBTLE, letterSpacing: 2 }}>PAQUETES DE CRÉDITOS · PAGO ÚNICO</div>
          {packages.length ? (
            packages.map((p, i) => (
              <div
                key={p.sku}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", borderTop: i ? `2px solid ${LINE}` : "none" }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <div style={{ display: "flex", fontSize: 34 }}>{p.credits}</div>
                  <div style={{ display: "flex", fontSize: 24, color: SUBTLE }}>créditos</div>
                  {p.discount >= 0.01 && (
                    <div style={{ display: "flex", fontSize: 19, color: "#2f6b3c", background: "#dfeedd", borderRadius: 999, padding: "3px 12px", marginLeft: 6 }}>
                      −{Math.round(p.discount * 100)}%
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", fontSize: 34 }}>{ars(p.cents)}</div>
              </div>
            ))
          ) : (
            <div style={{ display: "flex", fontSize: 28, color: SUBTLE, padding: "30px 0" }}>Paquetes de 10, 25, 50 y 100 créditos</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", marginTop: 10, background: "#f6f4ef", borderRadius: 18, padding: "12px 18px", gap: 3 }}>
            {uses.map(([what, cost]) => (
              <div key={what} style={{ display: "flex", justifyContent: "space-between", fontSize: 20 }}>
                <div style={{ display: "flex" }}>{what}</div>
                <div style={{ display: "flex", color: cost === "Sin créditos" ? "#2f6b3c" : FOREST }}>{cost}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

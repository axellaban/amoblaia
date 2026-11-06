// The preview of www.habitaia.app/precios when it is shared (WhatsApp, redes):
// the living before and after, «Presentá mejor tus propiedades con IA» with the
// lowest price per image (one credit) from the catalog, the free plan's monthly credits and
// the three figures of «El impacto en tu negocio». Generated, so the prices are
// never stale.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { IMPACT_STATS } from "@/lib/business-impact";
import { formatARS, type Product } from "@/lib/commerce/catalog";
import { FREE_MONTHLY_CREDITS, lowestUnitCents } from "@/lib/commerce/credit-packs";
import { cloudConfigured } from "@/lib/supabase/config";
import { adminClient } from "@/lib/supabase/server";

export const alt = "Precios de habita.: presentá mejor tus propiedades con IA, desde un precio por imagen y con créditos gratis por mes";
export const size = { width: 1200, height: 630 };
// JPEG and light: WhatsApp skips preview images much heavier than ~300 KB.
export const contentType = "image/jpeg";
// Prices change rarely: the image is made again at most once an hour.
export const revalidate = 3600;

const GREEN = "#24382e";
const CREAM = "#f8f5ef";

async function lowestPrice() {
  if (!cloudConfigured()) return null;
  try {
    const { data } = await adminClient().from("products").select("*");
    const cents = lowestUnitCents((data || []) as Product[]);
    return cents ? formatARS(cents).replace(/\s/g, "") : null;
  } catch {
    return null;
  }
}

const icon = (id: string, color: string, px: number) => {
  const common = { width: px, height: px, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (id === "precio")
    return (
      <svg {...common}>
        <path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
        <path d="M16 7h6v6" />
      </svg>
    );
  if (id === "velocidad")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
};

export default async function Image() {
  // Literal paths, so the build bundles these files with the route.
  const [photo, semi, bold, price] = await Promise.all([
    readFile(join(process.cwd(), "assets/og/precios-living.jpg")),
    readFile(join(process.cwd(), "assets/og/manrope-600.woff")),
    readFile(join(process.cwd(), "assets/og/manrope-800.woff")),
    lowestPrice(),
  ]);
  const photoSrc = `data:image/jpeg;base64,${photo.toString("base64")}`;
  const png = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: CREAM, color: GREEN, fontFamily: "Manrope" }}>
        <div style={{ display: "flex", height: 390 }}>
          {/* The living, before and after. */}
          <div style={{ position: "relative", display: "flex", width: 600, height: 390 }}>
            <img src={photoSrc} width={600} height={390} alt="" />
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 299, width: 3, background: "#fff", display: "flex" }} />
            <div style={{ position: "absolute", top: 165, left: 270, width: 60, height: 60, borderRadius: 30, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 18px rgba(0,0,0,0.25)" }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 7-5 5 5 5" />
                <path d="m15 7 5 5-5 5" />
              </svg>
            </div>
            <div style={{ position: "absolute", top: 22, left: 26, display: "flex", fontSize: 42, fontWeight: 800, color: "#fff", letterSpacing: -1.2, textShadow: "0 2px 14px rgba(0,0,0,0.35)" }}>habita.</div>
          </div>
          {/* The offer. */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", padding: "0 44px", background: GREEN, color: CREAM }}>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 50, fontWeight: 800, letterSpacing: -1.4, lineHeight: 1.08 }}>
              <div style={{ display: "flex" }}>Presentá mejor</div>
              <div style={{ display: "flex" }}>tus propiedades</div>
              <div style={{ display: "flex" }}>con IA</div>
            </div>
            {price ? (
              <div style={{ display: "flex", alignItems: "center", marginTop: 26, padding: "10px 24px", borderRadius: 999, background: CREAM, color: GREEN }}>
                <div style={{ display: "flex", fontSize: 22, fontWeight: 600 }}>Desde</div>
                <div style={{ display: "flex", fontSize: 44, fontWeight: 800, letterSpacing: -1.2, margin: "0 12px" }}>{price}</div>
                <div style={{ display: "flex", fontSize: 22, fontWeight: 600 }}>por imagen</div>
              </div>
            ) : (
              <div style={{ display: "flex", marginTop: 26, padding: "14px 24px", borderRadius: 999, background: CREAM, color: GREEN, fontSize: 24, fontWeight: 800 }}>Comprá créditos cuando los necesites</div>
            )}
            <div style={{ display: "flex", marginTop: 12, marginLeft: 24, fontSize: 20, fontWeight: 600, color: "#cfe0c4" }}>Sin suscripción</div>
          </div>
        </div>
        {/* The free plan. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 84, background: "#e4e9da" }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#3b6e3a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="8" width="18" height="4" rx="1" />
            <path d="M12 8v13" />
            <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
            <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
          </svg>
          <div style={{ display: "flex", marginLeft: 14, fontSize: 28, fontWeight: 600 }}>Probalo con</div>
          <div style={{ display: "flex", marginLeft: 8, fontSize: 28, fontWeight: 800 }}>{`${FREE_MONTHLY_CREDITS} créditos gratis por mes`}</div>
          <div style={{ display: "flex", width: 2, height: 36, background: "#c5cfb6", margin: "0 26px" }} />
          <div style={{ display: "flex", fontSize: 22, fontWeight: 600, color: "#3c453d" }}>Para inmobiliarias verificadas</div>
        </div>
        {/* «El impacto en tu negocio». */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 30px" }}>
          {IMPACT_STATS.map(({ id, value, label }, i) => (
            <div key={id} style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 28px", borderLeft: i ? "2px solid #e0dacd" : "none" }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                {icon(id, "#3b6e3a", 38)}
                <div style={{ display: "flex", marginLeft: 14, fontSize: 50, fontWeight: 800, letterSpacing: -1.4, lineHeight: 1 }}>{value}</div>
              </div>
              <div style={{ display: "flex", marginTop: 6, fontSize: 21, fontWeight: 600, color: "#3c453d" }}>{label.replace("mayor ", "")}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Manrope", data: semi, weight: 600, style: "normal" },
        { name: "Manrope", data: bold, weight: 800, style: "normal" },
      ],
    },
  );
  const jpeg = await sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" },
  });
}

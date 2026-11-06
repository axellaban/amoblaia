// The image of a shared panel link (src/lib/agency/panel-preview.ts):
// «Tu panel de <inmobiliaria>», its free credits, the three tools (the first
// with the agency's own property when it has a demo), «Ingresar a tu panel»
// and «El impacto en tu negocio». JPEG and light, so WhatsApp shows it.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { creditsLine, panelPreview } from "@/lib/agency/panel-preview";
import { IMPACT_STATS } from "@/lib/business-impact";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GREEN = "#24382e";
const CREAM = "#f8f5ef";
const dataUrl = (bytes: Buffer, type = "image/jpeg") => `data:${type};base64,${bytes.toString("base64")}`;

/** The agency's own cover, through the demo's preview image; null when it cannot be read in time. */
async function ownCover(origin: string, path: string | null) {
  if (!path) return null;
  try {
    const res = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(5000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(jpeg|png)/.test(type)) return null;
    return dataUrl(Buffer.from(await res.arrayBuffer()), type.split(";")[0]);
  } catch {
    return null;
  }
}

const svg = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function StatIcon({ id }: { id: string }) {
  const p = { width: 30, height: 30, viewBox: "0 0 24 24", stroke: "#cfe0c4", strokeWidth: 2.2, ...svg };
  if (id === "precio")
    return (
      <svg {...p}>
        <path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
        <path d="M16 7h6v6" />
      </svg>
    );
  if (id === "velocidad")
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    );
  return (
    <svg {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ToolIcon({ id }: { id: "demo" | "studio" | "video" }) {
  const p = { width: 22, height: 22, viewBox: "0 0 24 24", stroke: GREEN, strokeWidth: 2, ...svg };
  if (id === "demo")
    return (
      <svg {...p}>
        <path d="m12 2 9 5-9 5-9-5 9-5z" />
        <path d="m3 12 9 5 9-5" />
        <path d="m3 17 9 5 9-5" />
      </svg>
    );
  if (id === "studio")
    return (
      <svg {...p}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    );
  return (
    <svg {...p}>
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("codigo");
  const preview = await panelPreview(code);
  // Literal paths, so the build bundles these files with the route.
  const [semi, bold, demo, studio, video, cover] = await Promise.all([
    readFile(join(process.cwd(), "assets/og/manrope-600.woff")),
    readFile(join(process.cwd(), "assets/og/manrope-800.woff")),
    readFile(join(process.cwd(), "assets/og/panel-demo.jpg")),
    readFile(join(process.cwd(), "assets/og/panel-studio.jpg")),
    readFile(join(process.cwd(), "assets/og/panel-video.jpg")),
    ownCover(url.origin, preview.cover),
  ]);
  const cards = [
    { id: "demo" as const, title: "Demos interactivas", src: cover ?? dataUrl(demo) },
    { id: "studio" as const, title: "Estudio de imágenes", src: dataUrl(studio) },
    { id: "video" as const, title: "Creación de videos", src: dataUrl(video) },
  ];
  const name = preview.agencyName;
  const png = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: CREAM, color: GREEN, fontFamily: "Manrope" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "26px 40px 0" }}>
          <div style={{ display: "flex", width: 200, fontSize: 38, fontWeight: 800, letterSpacing: -1.1 }}>habita.</div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 200 }}>
            <svg width="46" height="46" viewBox="0 0 24 24" stroke={GREEN} strokeWidth="2" {...svg}>
              <path d="M3 10.5 12 3l9 7.5" />
              <path d="M5 9.5V21h14V9.5" />
              <path d="M10 21v-6h4v6" />
            </svg>
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 16, maxWidth: 640 }}>
              <div style={{ display: "flex", fontSize: 20, fontWeight: 600, color: "#5d625d" }}>{name ? "Tu panel de" : "Tu panel en"}</div>
              <div style={{ display: "flex", fontSize: (name ?? "").length > 28 ? 32 : 40, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1.05 }}>{name ?? "habita."}</div>
            </div>
          </div>
        </div>
        <div style={{ alignSelf: "center", display: "flex", alignItems: "center", marginTop: 16, padding: "10px 22px", borderRadius: 999, background: "#e4e9da", fontSize: 21 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" stroke="#3b6e3a" strokeWidth="2.2" {...svg}>
            <rect x="3" y="8" width="18" height="4" rx="1" />
            <path d="M12 8v13" />
            <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
            <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
          </svg>
          <div style={{ display: "flex", marginLeft: 12, fontWeight: 800 }}>{creditsLine(preview)}</div>
          <div style={{ display: "flex", marginLeft: 7, fontWeight: 600 }}>para probar todas las herramientas</div>
        </div>
        <div style={{ display: "flex", padding: "20px 40px 0" }}>
          {cards.map(({ id, title, src }, i) => (
            <div key={id} style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", marginLeft: i ? 20 : 0, background: "#fff", border: "1px solid #e6dfd3", borderRadius: 18, overflow: "hidden" }}>
              <img src={src} width={360} height={160} alt="" style={{ width: "100%", height: 160, objectFit: "cover" }} />
              {id === "video" && (
                <div style={{ position: "absolute", top: 52, left: 151, width: 56, height: 56, borderRadius: 28, background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill={GREEN}>
                    <polygon points="8 4 20 12 8 20 8 4" />
                  </svg>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 12, background: "#e4e9da" }}>
                  <ToolIcon id={id} />
                </div>
                <div style={{ display: "flex", marginLeft: 12, fontSize: 23, fontWeight: 800 }}>{title}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ alignSelf: "center", display: "flex", alignItems: "center", marginTop: 18, padding: "14px 40px", borderRadius: 14, background: GREEN, color: CREAM, fontSize: 23, fontWeight: 800 }}>
          Ingresar a tu panel
          <svg width="24" height="24" viewBox="0 0 24 24" stroke={CREAM} strokeWidth="2.4" style={{ marginLeft: 12 }} {...svg}>
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </div>
        <div style={{ marginTop: "auto", height: 92, display: "flex", alignItems: "center", padding: "0 40px", background: GREEN, color: CREAM }}>
          <div style={{ display: "flex", flexDirection: "column", width: 230, fontSize: 15, fontWeight: 800, letterSpacing: 1.2 }}>
            <div style={{ display: "flex" }}>EL IMPACTO EN</div>
            <div style={{ display: "flex" }}>TU NEGOCIO</div>
          </div>
          {IMPACT_STATS.map(({ id, value, label }) => (
            <div key={id} style={{ flex: 1, display: "flex", alignItems: "center", paddingLeft: 22, borderLeft: "1px solid rgba(248,245,239,0.2)" }}>
              <StatIcon id={id} />
              <div style={{ display: "flex", marginLeft: 12, fontSize: 34, fontWeight: 800, letterSpacing: -0.7 }}>{value}</div>
              <div style={{ display: "flex", marginLeft: 12, maxWidth: 150, fontSize: 16, fontWeight: 600, color: "#e9eee2", lineHeight: 1.2 }}>{label.replace("mayor ", "")}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Manrope", data: semi, weight: 600, style: "normal" },
        { name: "Manrope", data: bold, weight: 800, style: "normal" },
      ],
    },
  );
  const jpeg = await sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" },
  });
}

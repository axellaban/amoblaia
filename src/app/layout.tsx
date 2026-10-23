import { ProductTour } from "@/components/product-tour";
import Script from "next/script";
import { GOOGLE_ADS_ID } from "@/lib/ads";
import { MetaPixel } from "@/components/meta-pixel";
import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { Header, Footer } from "@/components/shell";
import "./globals.css";
const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
});
export const viewport: Viewport = { themeColor: "#151a2d" };
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://amoblaia.vercel.app"),
  title: {
    default: "amoblaIA — De espacio vacío a próximo hogar",
    template: "%s · amoblaIA",
  },
  description:
    "Amoblá tus propiedades con inteligencia artificial. Virtual staging para inmobiliarias, agentes y propietarios de Latinoamérica.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "amoblaIA — Mostrá un hogar",
    description:
      "Dale vida a tus propiedades con virtual staging e inteligencia artificial.",
    locale: "es_AR",
    siteName: "amoblaIA",
    type: "website",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={outfit.variable}>
      <body>
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <Header />
        <main id="contenido">{children}</main>
        <Footer />
        <ProductTour />
        {process.env.VERCEL_ENV === "production" && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-ads-tag" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GOOGLE_ADS_ID}');`}
            </Script>
          </>
        )}
        <MetaPixel />
      </body>
    </html>
  );
}

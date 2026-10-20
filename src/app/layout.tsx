import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope } from "next/font/google";
import { Header, Footer } from "@/components/shell";
import "./globals.css";
const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-fraunces",
});
export const viewport: Viewport = { themeColor: "#14271f" };
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
    <html
      lang="es"
      className={`${manrope.variable} ${fraunces.variable}`}
    >
      <body>
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <Header />
        <main id="contenido">{children}</main>
        <Footer
          seller={
            process.env.SELLER_NAME && process.env.SELLER_CUIT
              ? `${process.env.SELLER_NAME} · CUIT ${process.env.SELLER_CUIT}`
              : ""
          }
        />
      </body>
    </html>
  );
}

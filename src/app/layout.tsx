import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { Header, Footer } from "@/components/shell";
import "./globals.css";
const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
});
export const metadata: Metadata = {
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
    type: "website",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className={outfit.variable}>
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <Header />
        <main id="contenido">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

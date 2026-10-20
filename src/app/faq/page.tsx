import type { Metadata } from "next";
import { FaqBrowser } from "@/components/faq-browser";
export const metadata: Metadata = {
  title: "Preguntas frecuentes",
  description:
    "Respuestas sobre diseños gratis, estilos, pagos con Mercado Pago y tu cuenta de amoblaIA.",
};
export default function FaqPage() {
  return <FaqBrowser />;
}

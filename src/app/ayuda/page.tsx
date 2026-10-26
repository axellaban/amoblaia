import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/contact-form";
export const metadata: Metadata = { title: "Ayuda y soporte" };
export default function Help() {
  return (
    <article className="legal-page container">
      <span className="eyebrow">ESTAMOS PARA AYUDARTE</span>
      <h1>¿En qué podemos ayudarte?</h1>
      <p>
        Consultá las <Link href="/faq">preguntas frecuentes</Link> o dejá una
        solicitud. Podés ver tus planes y pagos en{" "}
        <Link href="/cuenta">Mi cuenta</Link>.
      </p>
      <h2>Contactar al equipo</h2>
      <ContactForm />
      <h2 id="arrepentimiento">Botón de arrepentimiento</h2>
      <p>
        Si querés revocar una compra, dejá el email de tu cuenta y la referencia
        del pago. No hace falta explicar el motivo. La solicitud queda
        registrada con un número de seguimiento.
      </p>
      <ContactForm kind="arrepentimiento" />
      <h2 id="baja">Botón de baja</h2>
      <p>
        Entrá a <Link href="/cuenta">Mi cuenta</Link>, buscá tu suscripción y
        elegí Cancelar renovación. Conservás el período ya pagado. Si no podés
        ingresar, usá el formulario de soporte de esta página.
      </p>
      <Link href="/cuenta" className="button button-primary">
        Gestionar mi suscripción
      </Link>
      <h2>Revisión de pagos</h2>
      <p>
        Para consultar un reembolso podés usar el{" "}
        <Link href="/reembolsos">formulario de reembolsos</Link>. No envíes
        contraseñas ni datos completos de tarjetas.
      </p>
    </article>
  );
}

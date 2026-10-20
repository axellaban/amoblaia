import Link from "next/link";
export default function Help() {
  const contact = process.env.NEXT_PUBLIC_CONTACT_URL,
    email = process.env.SUPPORT_EMAIL;
  return (
    <article className="legal-page container">
      <span className="eyebrow">ESTAMOS PARA AYUDARTE</span>
      <h1>Una mano con tu cuenta.</h1>
      <p>
        Podés gestionar tu suscripción, consultar pagos y ver el estado de una
        generación desde <Link href="/cuenta">Mi cuenta</Link>.
      </p>
      <h2 id="arrepentimiento">Botón de arrepentimiento</h2>
      <p>
        Tenés 10 días corridos desde la contratación para revocarla, sin costo
        y sin explicar el motivo. Escribinos con el email de tu cuenta y la
        fecha de la compra; te respondemos con un número de trámite dentro de
        las 24 horas.
      </p>
      {email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && (
        <p>
          <a
            className="button button-primary"
            href={`mailto:${email}?subject=${encodeURIComponent("Arrepentimiento de compra")}`}
          >
            Me arrepiento de mi compra
          </a>
        </p>
      )}
      {!email && contact && /^https:\/\//.test(contact) && (
        <p>
          <a
            className="button button-primary"
            href={contact}
            target="_blank"
            rel="noopener noreferrer"
          >
            Me arrepiento de mi compra
          </a>
        </p>
      )}
      <h2>Soporte, bajas y solicitudes</h2>
      <p>
        Para pedir ayuda, un reembolso, ejercer un derecho sobre tus datos o
        consultar por una baja, incluí el email de tu cuenta y la referencia del
        pago o proyecto. Nunca envíes tu contraseña ni datos de tarjeta.
      </p>
      {email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && (
        <p>
          <a className="button button-dark" href={`mailto:${email}`}>
            Escribir a {email}
          </a>
        </p>
      )}
      {contact && /^https:\/\//.test(contact) && (
        <a
          className="button button-outline"
          href={contact}
          target="_blank"
          rel="noopener noreferrer"
        >
          Contactar al equipo
        </a>
      )}
      {!email && !contact && (
        <p>
          El canal comercial de soporte se publicará antes de habilitar las
          ventas.
        </p>
      )}
      <h2 id="baja">Botón de baja</h2>
      <p>
        Entrá a <Link href="/cuenta">Mi cuenta</Link>, buscá tu suscripción y
        elegí «Cancelar renovación». Conservás el período ya pagado. Si no podés
        ingresar, usá la recuperación de acceso o el canal de soporte publicado.
      </p>
    </article>
  );
}

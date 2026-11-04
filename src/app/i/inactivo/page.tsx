import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = { title: "Enlace no disponible", robots: { index: false, follow: false } };

/** A fixed panel link that was changed (or never existed): no sign-up, no /admin. */
export default function InactiveLink() {
  return (
    <div className="account-page container ap-start">
      <span className="eyebrow">habita para inmobiliarias</span>
      <h1>Este enlace ya no está activo</h1>
      <p>Puede que lo hayan cambiado por uno nuevo. Pedile el enlace actualizado al equipo de habita por el mismo WhatsApp.</p>
      <div className="ap-start-actions">
        <Link href="/acceso?next=%2Fpanel" className="button button-outline">
          Iniciar sesión
        </Link>
      </div>
    </div>
  );
}

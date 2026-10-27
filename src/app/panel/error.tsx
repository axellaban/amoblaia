"use client";
// The panel could not load (a lookup failed, not a missing agency): say so and offer to retry.
import Link from "next/link";
import { useEffect } from "react";

export default function PanelError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("panel_error", error instanceof Error ? error.message.slice(0, 120) : "unknown");
  }, [error]);
  return (
    <div className="account-page container ap-start" role="alert">
      <h1>No pudimos cargar tu panel</h1>
      <p>Fue un problema de conexión con nuestros servidores, no de tu cuenta: tus propiedades siguen ahí.</p>
      <div className="ap-start-actions">
        <button type="button" className="button button-primary" onClick={() => retry()}>
          Reintentar
        </button>
        <Link href="/" className="button button-outline">
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}

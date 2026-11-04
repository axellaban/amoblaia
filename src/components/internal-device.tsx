"use client";

import { useEffect, useState } from "react";
import { forgetThisDevice, syncInternal } from "@/lib/internal/client";

const OUTCOME: Record<string, string> = {
  vinculado: "Listo: este dispositivo quedó vinculado al equipo.",
  "enlace-invalido": "Ese enlace no es válido, ya se usó o venció (duran 30 minutos). Generá otro desde /admin/internos.",
  error: "No pudimos vincular este dispositivo. Probá de nuevo.",
  "no-disponible": "La clasificación de dispositivos no está disponible en este entorno.",
};

/** /interno: the verdict for this browser, and the way to stop marking it. */
export function InternalDeviceStatus({ outcome }: { outcome: string | null }) {
  const [internal, setInternal] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void syncInternal().then((v) => live && setInternal(v));
    return () => {
      live = false;
    };
  }, []);

  async function forget() {
    setBusy(true);
    setInternal(await forgetThisDevice());
    setBusy(false);
  }

  return (
    <main className="account-page container">
      <span className="eyebrow">Tráfico interno</span>
      <h1>
        Este dispositivo<span className="accent">.</span>
      </h1>
      {outcome && OUTCOME[outcome] && (
        <p className={outcome === "vinculado" ? "inline-notice" : "inline-error"} role="status">
          {OUTCOME[outcome]}
        </p>
      )}
      <div className="account-panel">
        {internal === null ? (
          <p>Comprobando…</p>
        ) : internal ? (
          <>
            <p>
              <strong>Se cuenta como tráfico del equipo.</strong> Lo que hagas desde acá (demos, panel, estudio) queda fuera de las métricas comerciales y del Lead
              Engagement Score, aunque no tengas la sesión iniciada.
            </p>
            <p className="pr-muted">Si iniciaste sesión con una cuenta del equipo, este navegador vuelve a marcarse solo mientras la sesión siga abierta.</p>
            <button type="button" className="button button-outline" onClick={() => void forget()} disabled={busy}>
              {busy ? "Quitando…" : "Dejar de marcar este dispositivo"}
            </button>
          </>
        ) : (
          <p>
            <strong>Se cuenta como un visitante externo.</strong> Para marcarlo como del equipo, iniciá sesión con una cuenta del equipo o abrí un enlace de
            vinculación generado en /admin/internos.
          </p>
        )}
      </div>
    </main>
  );
}

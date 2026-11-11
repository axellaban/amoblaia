"use client";
// The team's switch for the property assistant test (lib/demos/buyer-agent.ts),
// on /admin/inmobiliarias. Off by default: while off, no agency sees the block
// unless its demo forces it («Mostrar siempre», in the demo's editor).
import { useEffect, useState } from "react";
import { api } from "@/components/admin-demos";

type Settings = { enabled: boolean; share: number; ready: boolean; updatedAt: string | null };

export function BuyerAgentSwitch() {
  const [s, setS] = useState<Settings | null>(null);
  const [share, setShare] = useState("50");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<Settings>("/api/admin/asistente-demo")
      .then((r) => {
        setS(r);
        setShare(String(r.share));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No pudimos leer la prueba del asistente."));
  }, []);

  async function save(patch: { enabled?: boolean; share?: number }) {
    setBusy(true);
    setError("");
    try {
      const r = await api<Settings>("/api/admin/asistente-demo", { method: "PUT", body: JSON.stringify(patch) });
      setS(r);
      setShare(String(r.share));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setBusy(false);
    }
  }

  if (!s) return error ? <p className="ba-admin" role="alert">{error}</p> : null;
  const n = Number(share);
  const validShare = Number.isInteger(n) && n >= 0 && n <= 100;
  return (
    <section className="ba-admin" aria-label="Prueba del asistente de la propiedad">
      <strong>Prueba del asistente en la demo</strong>
      <span className={`ba-admin-state ${s.enabled ? "is-on" : ""}`} role="status">
        {!s.ready ? "Falta aplicar la migración" : s.enabled ? `Encendida · ${s.share} % de las inmobiliarias lo ve` : "Apagada · ninguna inmobiliaria lo ve"}
      </span>
      {s.ready && (
        <>
          <label>
            Reparto
            <input type="number" min={0} max={100} step={1} value={share} onChange={(e) => setShare(e.target.value)} aria-label="Porcentaje de inmobiliarias que ven el asistente" />%
          </label>
          {validShare && n !== s.share && (
            <button type="button" className="button button-small button-outline" disabled={busy} onClick={() => void save({ share: n })}>
              Guardar reparto
            </button>
          )}
          <button
            type="button"
            className={`button button-small ${s.enabled ? "button-outline" : "button-primary"}`}
            disabled={busy}
            onClick={() => {
              const go = s.enabled
                ? window.confirm("¿Apagar la prueba? Las inmobiliarias dejan de ver el asistente (salvo demos con «Mostrar siempre»).")
                : window.confirm(`¿Encender la prueba? El ${s.share} % de las inmobiliarias va a ver el asistente en la vista de su demo.`);
              if (go) void save({ enabled: !s.enabled });
            }}
          >
            {s.enabled ? "Apagar" : "Encender"}
          </button>
          <small>Por demo se puede forzar en su editor: Publicación y compartir.</small>
        </>
      )}
      {error && (
        <p className="ba-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

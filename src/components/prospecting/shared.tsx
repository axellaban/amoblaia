"use client";

import { useState, type ReactNode } from "react";
import { api } from "@/components/admin-demos";
import type { Filters } from "@/lib/prospecting/metrics";
import { TZ } from "@/lib/prospecting/time";
import { CHANNEL_LABEL, type Dataset } from "@/lib/prospecting/types";

export { api };

/** A fresh idempotency key that survives retries of the same form until it succeeds. */
export function useOperationKey() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return [key, () => setKey(crypto.randomUUID())] as const;
}

/** "2026-10-27T14:05" for a datetime-local input, in Buenos Aires time. */
export function artInput(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** A datetime-local value (Buenos Aires) → ISO. */
export const fromArtInput = (v: string) => (v ? new Date(`${v}:00-03:00`).toISOString() : null);
/** A date input (Buenos Aires day) → ISO of its start. */
export const fromArtDate = (v: string) => (v ? new Date(`${v}T00:00:00-03:00`).toISOString() : null);

export function Pill({ tone, children }: { tone?: "amber" | "blue" | "red" | "green"; children: ReactNode }) {
  return <span className={`pr-pill${tone ? ` is-${tone}` : ""}`}>{children}</span>;
}

export function ErrorNote({ error }: { error: string }) {
  if (!error) return null;
  return (
    <p className="inline-error" role="alert">
      {error}
    </p>
  );
}

/** Filters shared by the summary and the message report: same cohort, same rules. */
export function FilterBar({ ds, filters, onChange, idPrefix }: { ds: Dataset; filters: Filters; onChange: (f: Filters) => void; idPrefix: string }) {
  const values = (k: "sdr" | "campaign" | "zone") => [...new Set(ds.accounts.map((a) => a[k]).filter((v): v is string => !!v))].sort();
  const channels = [...new Set(ds.attempts.filter((a) => a.status === "sent").map((a) => a.channel))].sort();
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => onChange({ ...filters, [k]: e.target.value || null });
  const any = Object.values(filters).some(Boolean);
  return (
    <div className="pr-filters" role="group" aria-label="Filtros">
      <label>
        <span>Primer envío desde</span>
        <input type="date" id={`${idPrefix}-from`} value={filters.from ?? ""} onChange={set("from")} data-testid={`${idPrefix}-filter-from`} />
      </label>
      <label>
        <span>hasta</span>
        <input type="date" id={`${idPrefix}-to`} value={filters.to ?? ""} onChange={set("to")} data-testid={`${idPrefix}-filter-to`} />
      </label>
      <label>
        <span>Canal</span>
        <select value={filters.channel ?? ""} onChange={set("channel")} data-testid={`${idPrefix}-filter-channel`}>
          <option value="">Todos los canales</option>
          {channels.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>SDR</span>
        <select value={filters.sdr ?? ""} onChange={set("sdr")} data-testid={`${idPrefix}-filter-sdr`}>
          <option value="">Todos los SDR</option>
          {values("sdr").map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Campaña</span>
        <select value={filters.campaign ?? ""} onChange={set("campaign")} data-testid={`${idPrefix}-filter-campaign`}>
          <option value="">Todas las campañas</option>
          {values("campaign").map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Zona</span>
        <select value={filters.zone ?? ""} onChange={set("zone")} data-testid={`${idPrefix}-filter-zone`}>
          <option value="">Todas las zonas</option>
          {values("zone").map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {any && (
        <button type="button" className="pr-link" onClick={() => onChange({})}>
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

export function filterLabel(f: Filters) {
  const parts = [
    f.from || f.to ? `Primer envío ${f.from ? `desde ${f.from.split("-").reverse().join("/")}` : ""}${f.to ? ` hasta ${f.to.split("-").reverse().join("/")}` : ""}` : "Todas las cohortes",
    f.channel ? CHANNEL_LABEL[f.channel as keyof typeof CHANNEL_LABEL] : "Todos los canales",
    f.sdr ? `SDR ${f.sdr}` : "Todos los SDR",
    f.campaign ? `Campaña ${f.campaign}` : null,
    f.zone ? `Zona ${f.zone}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

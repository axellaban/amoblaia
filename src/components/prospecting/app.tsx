"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import type { Filters } from "@/lib/prospecting/metrics";
import { formatWhen } from "@/lib/prospecting/time";
import type { Dataset } from "@/lib/prospecting/types";
import { AccountsView } from "./accounts";
import { AccountDrawer } from "./drawer";
import { ExecutionView } from "./execution";
import { MessagesView } from "./messages";
import { api } from "./shared";
import { SummaryView } from "./summary";

export type Tab = "resumen" | "prospectos" | "mensajes" | "ejecucion";
const TABS: [Tab, string][] = [
  ["resumen", "Resumen ejecutivo"],
  ["prospectos", "Prospectos"],
  ["mensajes", "Mensajes y conversión"],
  ["ejecucion", "Bandeja de ejecución"],
];
const POLL_MS = 60_000;

/**
 * The team's acquisition center. Everything shown comes from the persisted
 * dataset (GET /api/admin/prospeccion): it reloads after every mutation, every
 * minute and when the tab gets focus, so two sessions converge. Nothing is
 * kept in memory as if it had happened.
 */
export function ProspectingApp({ initialTab }: { initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [ds, setDs] = useState<Dataset | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>({});
  const [drawer, setDrawer] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const inflight = useRef(false);

  const reload = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const data = await api<Dataset>("/api/admin/prospeccion");
      setDs(data);
      setSyncedAt(data.now);
      setSyncError("");
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "No pudimos actualizar.");
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);
  /** After any confirmed mutation: refresh the dataset and an open account. */
  const changed = useCallback(async () => {
    setDetailVersion((v) => v + 1);
    await reload();
  }, [reload]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void reload(), POLL_MS);
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  const select = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("vista", t);
    window.history.replaceState(null, "", url);
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length : null;
    if (next == null) return;
    e.preventDefault();
    select(TABS[next][0]);
    document.getElementById(`pr-tab-${TABS[next][0]}`)?.focus();
  };
  const prepareFor = (accountId: string) => {
    setTarget(accountId);
    setDrawer(null);
    select("ejecucion");
  };

  return (
    <div className="pr-layout">
      <aside className="pr-side" aria-label="Operación comercial">
        <div className="pr-side-brand">
          habita<span>.</span>
          <small>Operación comercial</small>
        </div>
        <nav>
          <Link href="/admin/prospeccion" className="is-on" aria-current="page">
            Adquisición
          </Link>
          <Link href="/admin/demos">Demos existentes</Link>
          <Link href="/admin/inmobiliarias">Inmobiliarias</Link>
        </nav>
        <p className="pr-side-foot">Privado del equipo. Sin conexión automática a WhatsApp ni Gmail: cada envío y respuesta se registra.</p>
      </aside>
      <main className="pr-main">
        <div className="pr-top">
          <div>
            <span className="pr-label">Adquisición / Visión y ejecución</span>
            <h1>De la lista al próximo cliente.</h1>
            <p className="pr-muted">Una base. Cada contacto registrado. Cada mensaje medible.</p>
          </div>
          <div className="pr-sync" role="status" aria-live="polite" data-testid="sync-status">
            {syncedAt ? <span>Actualizado {formatWhen(syncedAt)} (hora Argentina)</span> : <span>Cargando datos…</span>}
            {syncError && <span className="pr-sync-error">No se pudo actualizar: {syncError}</span>}
            <button type="button" className="pr-link" onClick={() => void reload()} disabled={loading} data-testid="sync-now">
              {loading ? "Actualizando…" : "Actualizar"}
            </button>
          </div>
        </div>

        <div className="pr-tabs" role="tablist" aria-label="Secciones">
          {TABS.map(([id, label], i) => (
            <button
              key={id}
              id={`pr-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`pr-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className={tab === id ? "is-active" : ""}
              onClick={() => select(id)}
              onKeyDown={(e) => onTabKey(e, i)}
              data-testid={`tab-${id}`}
            >
              {label}
            </button>
          ))}
        </div>

        {!ds && !syncError && <p className="pr-muted">Cargando la base…</p>}
        {!ds && syncError && (
          <div className="pr-panel" role="alert">
            <h2>No pudimos cargar la base</h2>
            <p>{syncError}</p>
            <button type="button" className="button button-small" onClick={() => void reload()}>
              Reintentar
            </button>
          </div>
        )}
        {ds && (
          <section id={`pr-panel-${tab}`} role="tabpanel" aria-labelledby={`pr-tab-${tab}`}>
            {tab === "resumen" && <SummaryView ds={ds} filters={filters} onFilters={setFilters} goTo={select} />}
            {tab === "prospectos" && <AccountsView ds={ds} onOpen={setDrawer} onChanged={changed} />}
            {tab === "mensajes" && <MessagesView ds={ds} filters={filters} onFilters={setFilters} onChanged={changed} />}
            {tab === "ejecucion" && <ExecutionView ds={ds} target={target} onTarget={setTarget} onChanged={changed} onOpenAccount={setDrawer} />}
          </section>
        )}
      </main>
      {ds && drawer && (
        <AccountDrawer
          key={drawer}
          id={drawer}
          ds={ds}
          version={detailVersion}
          onClose={() => setDrawer(null)}
          onChanged={changed}
          onPrepare={prepareFor}
        />
      )}
    </div>
  );
}

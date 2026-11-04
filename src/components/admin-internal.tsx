"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/components/admin-demos";
import type { InternalDevice, InternalPerson } from "@/lib/internal/admin";
import { formatWhen } from "@/lib/prospecting/time";

/**
 * /admin/internos: who is the team (people with one or more accounts), which
 * browsers are counted as the team's, and what is still unknown. Everything
 * here stays out of the demos' activity, the Lead Engagement Score, the
 * agencies' funnel, the metrics and PostHog's commercial dashboards.
 */

type Data = { people: InternalPerson[]; devices: InternalDevice[]; fingerprints: number };
const ROLE: Record<string, string> = { admin: "Administrador", collaborator: "Colaborador", test: "Cuenta de prueba" };
const STATUS: Record<string, string> = { internal: "Interno", unknown: "Desconocido", external: "Externo (confirmado)", revoked: "Revocado" };
const SOURCE: Record<string, string> = {
  login: "Inicio de sesión",
  link: "Enlace de vinculación",
  fingerprint: "Huella del equipo (incógnito)",
  manual: "Manual",
  backfill: "Reclasificación histórica",
};

export function AdminInternal() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [link, setLink] = useState<{ person: string; url: string; expires: string } | null>(null);
  const [form, setForm] = useState({ label: "", emails: "", role: "collaborator" });
  const [filter, setFilter] = useState<"internal" | "unknown" | "other">("internal");

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/admin/internos"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cargar el registro.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: string, body: Record<string, unknown>, done?: string) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const r = await api<Record<string, unknown>>("/api/admin/internos", { method: "POST", body: JSON.stringify(body) });
      if (typeof r.url === "string") setLink({ person: String(body.id), url: r.url, expires: String(r.expires) });
      const rec = r.recalculated as { demos?: number } | undefined;
      setNotice(`${done ?? "Listo."}${rec ? ` Recalculadas ${rec.demos ?? 0} demos.` : ""}`);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar el cambio.");
      return false;
    } finally {
      setBusy("");
    }
  }

  const counts = useMemo(() => {
    const d = data?.devices ?? [];
    return { internal: d.filter((x) => x.status === "internal").length, unknown: d.filter((x) => x.status === "unknown").length, other: d.filter((x) => x.status === "external" || x.status === "revoked").length };
  }, [data]);
  const devices = (data?.devices ?? []).filter((d) => (filter === "other" ? d.status === "external" || d.status === "revoked" : d.status === filter));
  const personName = (id: string | null) => data?.people.find((p) => p.id === id)?.label ?? "Sin persona";

  return (
    <main className="pr-main ld-main">
      <div className="pr-top">
        <div>
          <span className="pr-label">Tráfico interno</span>
          <h1>Quién es del equipo.</h1>
          <p className="pr-muted">
            Las cuentas y dispositivos de esta lista quedan fuera de las visitas e interacciones de las demos, del Lead Engagement Score, del funnel de
            inmobiliarias, de las métricas y de los dashboards comerciales de PostHog. Sus eventos se guardan igual, marcados, para QA.
          </p>
        </div>
        <div className="pr-sync" role="status" aria-live="polite">
          <span>{data ? `${data.fingerprints} huellas de red activas` : "Cargando…"}</span>
          <span>
            <button type="button" className="pr-link" onClick={() => void act("recompute", { action: "recompute" }, "Recalculado.")} disabled={busy === "recompute"}>
              {busy === "recompute" ? "Recalculando…" : "Recalcular todo"}
            </button>
          </span>
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}

      <div className="pr-cards">
        <article className="pr-card">
          <h3>Personas</h3>
          <strong>{data ? data.people.filter((p) => p.active).length : "…"}</strong>
          <small>Activas en el registro (más ADMIN_EMAILS)</small>
        </article>
        <article className="pr-card">
          <h3>Dispositivos internos</h3>
          <strong>{data ? counts.internal : "…"}</strong>
          <small>Navegadores que se excluyen aunque no tengan sesión</small>
        </article>
        <article className="pr-card">
          <h3>Desconocidos</h3>
          <strong>{data ? counts.unknown : "…"}</strong>
          <small>Sin evidencia suficiente: siguen contando hasta que se decida</small>
        </article>
      </div>

      <section className="pr-panel" aria-labelledby="int-people">
        <h2 id="int-people">Personas y cuentas</h2>
        <div className="pr-tablewrap">
          <table className="pr-table">
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col">Cuentas</th>
                <th scope="col">Dispositivos</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data?.people.map((p) => (
                <tr key={p.id} className={p.active ? undefined : "is-internal"}>
                  <td>
                    <strong>{p.label}</strong>
                    <br />
                    <small className="pr-muted">
                      {ROLE[p.role]}
                      {p.active ? "" : " · inactiva (cuenta como externa)"}
                    </small>
                  </td>
                  <td>
                    {p.identities
                      .filter((i) => i.kind === "email")
                      .map((i) => (
                        <div key={i.id}>
                          {i.value}{" "}
                          <button
                            type="button"
                            className="pr-link"
                            disabled={Boolean(busy)}
                            onClick={() => window.confirm(`¿Quitar ${i.value}? Esa cuenta va a contar como externa.`) && void act(`rm-${i.id}`, { action: "identity_remove", id: i.id })}
                          >
                            Quitar
                          </button>
                        </div>
                      ))}
                    <small className="pr-muted">{p.identities.filter((i) => i.kind === "user_id").length} id de usuario vinculados al iniciar sesión</small>
                    <AddEmail disabled={Boolean(busy)} onAdd={(email) => act(`add-${p.id}`, { action: "identity_add", id: p.id, email }, "Email agregado.")} />
                  </td>
                  <td>{data.devices.filter((d) => d.person_id === p.id && d.status === "internal").length}</td>
                  <td>
                    <button type="button" className="pr-link" disabled={Boolean(busy)} onClick={() => void act(`link-${p.id}`, { action: "link_create", id: p.id }, "Enlace creado.")}>
                      Vincular otro dispositivo
                    </button>
                    <br />
                    <button type="button" className="pr-link" disabled={Boolean(busy)} onClick={() => void act(`act-${p.id}`, { action: "person_update", id: p.id, active: !p.active })}>
                      {p.active ? "Dar de baja" : "Reactivar"}
                    </button>
                    {link?.person === p.id && (
                      <div className="ld-explain">
                        <p>
                          Abrí este enlace en el celular, la ventana incógnita o el otro perfil (sirve una vez, hasta {formatWhen(link.expires)}):
                        </p>
                        <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace de vinculación" />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="ld-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void act("create", { action: "person_create", label: form.label, role: form.role, emails: form.emails.split(/[\s,;]+/) }, "Persona agregada.").then(
              (ok) => ok && setForm({ label: "", emails: "", role: "collaborator" }),
            );
          }}
        >
          <input placeholder="Nombre" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-label="Nombre" required />
          <input placeholder="Emails (separados por coma)" value={form.emails} onChange={(e) => setForm({ ...form, emails: e.target.value })} aria-label="Emails" required />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Rol">
            <option value="admin">Administrador</option>
            <option value="collaborator">Colaborador</option>
            <option value="test">Cuenta de prueba</option>
          </select>
          <button type="submit" className="button button-primary" disabled={Boolean(busy)}>
            Agregar persona
          </button>
        </form>
        <p className="pr-caption">
          Agregar un email no da acceso al panel del equipo (eso sigue siendo ADMIN_EMAILS): solo hace que esa cuenta cuente como interna.
        </p>
      </section>

      <section className="pr-panel" aria-labelledby="int-devices">
        <h2 id="int-devices">Dispositivos</h2>
        <div className="ld-filters" role="radiogroup" aria-label="Estado">
          {(
            [
              ["internal", `Internos (${counts.internal})`],
              ["unknown", `Desconocidos (${counts.unknown})`],
              ["other", `Externos o revocados (${counts.other})`],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
          {filter === "unknown" && counts.unknown > 0 && (
            <button
              type="button"
              className="pr-link"
              disabled={Boolean(busy)}
              onClick={() => window.confirm(`¿Marcar los ${counts.unknown} desconocidos como internos?`) && void act("bulk", { action: "devices_confirm_unknown" }, "Marcados como internos.")}
            >
              Marcar todos como internos
            </button>
          )}
        </div>
        <div className="pr-tablewrap">
          <table className="pr-table ld-table">
            <thead>
              <tr>
                <th scope="col">Dispositivo</th>
                <th scope="col">Origen</th>
                <th scope="col">Persona</th>
                <th scope="col">Visto</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!devices.length && (
                <tr>
                  <td colSpan={5} className="pr-zero">
                    Nada en esta lista.
                  </td>
                </tr>
              )}
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.label ?? "Navegador"}</strong>
                    <br />
                    <small className="pr-muted">
                      {STATUS[d.status]}
                      {d.ph_device_ids.length ? ` · PostHog ${d.ph_device_ids.map((p) => p.slice(0, 8)).join(", ")}` : ""}
                    </small>
                    {d.evidence && <small className="ld-internal">{d.evidence}</small>}
                  </td>
                  <td>{SOURCE[d.source] ?? d.source}</td>
                  <td>{personName(d.person_id)}</td>
                  <td>{formatWhen(d.last_seen_at)}</td>
                  <td>
                    {d.status !== "internal" && (
                      <button type="button" className="pr-link" disabled={Boolean(busy)} onClick={() => void act(`d-${d.id}`, { action: "device_status", id: d.id, status: "internal" })}>
                        Es del equipo
                      </button>
                    )}{" "}
                    {d.status !== "external" && d.status !== "revoked" && (
                      <button
                        type="button"
                        className="pr-link"
                        disabled={Boolean(busy)}
                        onClick={() => void act(`d-${d.id}`, { action: "device_status", id: d.id, status: d.status === "unknown" ? "external" : "revoked" })}
                      >
                        {d.status === "unknown" ? "Es un cliente" : "Revocar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pr-caption">
          «Revocar» sirve si alguien del equipo inició sesión en la computadora de un cliente: desde ese momento lo que haga ese navegador vuelve a contar.
          Lo que ya se registró como interno sigue siéndolo.
        </p>
      </section>
    </main>
  );
}

function AddEmail({ disabled, onAdd }: { disabled: boolean; onAdd: (email: string) => Promise<boolean> }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) void onAdd(value.trim()).then((ok) => ok && setValue(""));
      }}
    >
      <input type="email" placeholder="otro@gmail.com" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Agregar email" />{" "}
      <button type="submit" className="pr-link" disabled={disabled}>
        Agregar
      </button>
    </form>
  );
}

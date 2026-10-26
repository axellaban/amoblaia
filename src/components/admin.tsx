"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { formatARS, type Product } from "@/lib/commerce/catalog";
type AdminData = {
  products: Product[];
  requests: {
    id: string;
    kind: string;
    email: string;
    message: string;
    status: string;
    created_at: string;
  }[];
  users: { id: string; email: string }[];
  profiles: { id: string; blocked: boolean }[];
  generations: {
    id: string;
    user_id: string;
    status: string;
    estimated_usd: number | null;
    error_code: string;
    created_at: string;
  }[];
  payments: {
    id: string;
    user_id: string;
    status: string;
    amount_cents: number;
  }[];
  events: { event_key: string; last_error: string }[];
  billing: { ready: boolean; mode: "test" | "production"; missing: string[] };
};
export function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [userId, setUserId] = useState(""),
    [photos, setPhotos] = useState(1),
    [reason, setReason] = useState("");
  async function load() {
    const r = await fetch("/api/admin", { cache: "no-store" });
    const p = await r.json();
    if (!r.ok) throw new Error(p.error);
    setData(p);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setNotice("Cambio guardado.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-page container">
      <span className="eyebrow">OPERACIÓN DE AMOBLAIA</span>
      <h1>
        Administración<span className="accent">.</span>
      </h1>
      <p>
        Acceso del equipo. Los cambios de precios se aplican a nuevas compras;
        las suscripciones existentes conservan su importe.
      </p>
      <p>
        <Link href="/admin/demos" className="text-link">
          Demos comerciales para inmobiliarias →
        </Link>
      </p>
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
      {data && (
        <>
          <section className="account-panel">
            <h2>Consultas y solicitudes</h2>
            <p>
              Solicitudes de soporte, reembolso, afiliados y acceso comercial.
              Cambiar el estado no envía emails ni ejecuta reembolsos.
            </p>
            {!data.requests.length && <p>Todavía no hay solicitudes.</p>}
            {data.requests.map((r) => (
              <article className="request-row" key={r.id}>
                <div>
                  <span className="category-chip">{r.kind}</span>
                  <strong> {r.id.slice(0, 8).toUpperCase()}</strong>
                  <p>
                    {r.email} · {new Date(r.created_at).toLocaleString("es-AR")}
                  </p>
                  <p style={{ whiteSpace: "pre-wrap" }}>{r.message}</p>
                </div>
                <label>
                  Estado
                  <select
                    value={r.status}
                    disabled={busy}
                    onChange={(e) =>
                      void action({
                        action: "request",
                        id: r.id,
                        status: e.target.value,
                      })
                    }
                  >
                    <option value="new">Nueva</option>
                    <option value="in_progress">En seguimiento</option>
                    <option value="resolved">Resuelta</option>
                  </select>
                </label>
              </article>
            ))}
          </section>
          <section className="account-panel">
            <h2>Precios en pesos argentinos</h2>
            <p>
              Un producto muestra su botón de compra cuando los cobros están
              activos y tiene precio y la casilla Publicado marcada.
            </p>
            <ul className="billing-status">
              <li className={data.billing.ready ? "ok" : "warn"}>
                {data.billing.ready
                  ? data.billing.mode === "production"
                    ? "Cobros activos en producción: todos los clientes ven los botones."
                    : "Cobros en modo prueba: solo los emails de ADMIN_EMAILS ven los botones."
                  : `Cobros apagados. Falta en Vercel: ${data.billing.missing.join(", ")}.`}
              </li>
              <li
                className={
                  data.products.some((p) => p.active && p.price_cents)
                    ? "ok"
                    : "warn"
                }
              >
                {data.products.some((p) => p.active && p.price_cents)
                  ? `${data.products.filter((p) => p.active && p.price_cents).length} de ${data.products.length} productos publicados.`
                  : "Ningún producto publicado: cargá un precio, marcá Publicado y guardá."}
              </li>
            </ul>
            {data.products.map((p) => (
              <form
                key={p.sku}
                className="price-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void action({
                    action: "price",
                    sku: p.sku,
                    cents: Math.round(Number(f.get("price")) * 100),
                    active: f.get("active") === "on",
                    annual: f.get("annual") === "on",
                  });
                }}
              >
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    {p.sku} · {p.photos} fotos{" "}
                    {p.kind === "year"
                      ? "por mes, cobro anual"
                      : p.kind === "month"
                        ? "por mes"
                        : "por pack"}
                  </small>
                </div>
                <label>
                  Precio ARS
                  <input
                    name="price"
                    type="number"
                    step="1"
                    min="1"
                    max="10000000"
                    defaultValue={p.price_cents ? p.price_cents / 100 : ""}
                    required
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={p.active}
                  />
                  Publicado
                </label>
                {p.kind === "month" && (
                  <label className="checkbox-label">
                    <input name="annual" type="checkbox" />
                    Anual = 10 meses (reemplaza el precio anual)
                  </label>
                )}
                <button className="button button-outline" disabled={busy}>
                  Guardar
                </button>
              </form>
            ))}
          </section>
          <section className="account-panel">
            <h2>Ajuste de fotos</h2>
            <form
              className="admin-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action({ action: "credit", userId, photos, reason });
              }}
            >
              <label>
                Cliente
                <select
                  required
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                >
                  <option value="">Elegí un cliente</option>
                  {data.users
                    .filter((u) => data.profiles.some((p) => p.id === u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.email || u.id}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Fotos
                <input
                  type="number"
                  min="1"
                  max="1000"
                  required
                  value={photos}
                  onChange={(e) => setPhotos(Number(e.target.value))}
                />
              </label>
              <label>
                Motivo
                <input
                  minLength={5}
                  required
                  maxLength={250}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button className="button button-dark" disabled={busy}>
                Acreditar fotos
              </button>
            </form>
          </section>
          <section className="account-panel">
            <h2>Generaciones que necesitan revisión</h2>
            <p>
              Revisá el consumo del proveedor antes de confirmar una falla.
              Recuperar busca un resultado ya guardado; nunca llama nuevamente a
              la IA.
            </p>
            {data.generations
              .filter((j) => j.status === "needs_review")
              .map((j) => (
                <form
                  key={j.id}
                  className="review-row"
                  onSubmit={(e) => e.preventDefault()}
                >
                  <strong>
                    {data.users.find((u) => u.id === j.user_id)?.email ||
                      j.user_id}
                  </strong>
                  <p>
                    {j.id} · {j.error_code}
                  </p>
                  <input
                    name="reason"
                    placeholder="Motivo de la resolución"
                    minLength={10}
                    maxLength={250}
                    required
                  />
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={busy}
                    onClick={(e) => {
                      const form = e.currentTarget.form!;
                      if (form.reportValidity())
                        void action({
                          action: "resolve",
                          id: j.id,
                          outcome: "recover",
                          reason: new FormData(form).get("reason"),
                        });
                    }}
                  >
                    Recuperar resultado guardado
                  </button>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={busy}
                    onClick={(e) => {
                      const form = e.currentTarget.form!;
                      if (
                        form.reportValidity() &&
                        window.confirm(
                          "¿Confirmaste la falla? Se devolverá la foto si corresponde.",
                        )
                      )
                        void action({
                          action: "resolve",
                          id: j.id,
                          outcome: "failed",
                          reason: new FormData(form).get("reason"),
                        });
                    }}
                  >
                    Confirmar falla
                  </button>
                </form>
              ))}
          </section>
          <section className="account-panel">
            <h2>Cuentas en revisión</h2>
            {data.profiles
              .filter((p) => p.blocked)
              .map((p) => (
                <form
                  key={p.id}
                  className="review-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action({
                      action: "unblock",
                      userId: p.id,
                      reason: new FormData(e.currentTarget).get("reason"),
                    });
                  }}
                >
                  <strong>
                    {data.users.find((u) => u.id === p.id)?.email || p.id}
                  </strong>
                  <input
                    name="reason"
                    placeholder="Resultado de la revisión del pago"
                    minLength={10}
                    maxLength={250}
                    required
                  />
                  <button disabled={busy} className="button button-outline">
                    Habilitar cuenta
                  </button>
                </form>
              ))}
          </section>
          <section className="account-panel">
            <h2>Últimos 100 trabajos</h2>
            <p>
              {data.generations.filter((j) => j.status === "succeeded").length}{" "}
              completados ·{" "}
              {data.generations.filter((j) => j.estimated_usd !== null).length}{" "}
              con estimación de costo. La estimación requiere configurar
              tarifas; los tokens se guardan cuando el proveedor los devuelve.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Estado</th>
                    <th>IA estimada USD</th>
                  </tr>
                </thead>
                <tbody>
                  {data.generations.map((j) => (
                    <tr key={j.id}>
                      <td>{new Date(j.created_at).toLocaleString("es-AR")}</td>
                      <td>
                        {data.users.find((u) => u.id === j.user_id)?.email ||
                          j.user_id}
                      </td>
                      <td>{j.status}</td>
                      <td>
                        {j.estimated_usd === null
                          ? "Sin estimar"
                          : Number(j.estimated_usd).toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="account-panel">
            <h2>Últimos pagos</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Pago</th>
                    <th>Cliente</th>
                    <th>Estado</th>
                    <th>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.id}</td>
                      <td>
                        {data.users.find((u) => u.id === p.user_id)?.email ||
                          p.user_id}
                      </td>
                      <td>{p.status}</td>
                      <td>{formatARS(p.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="account-panel">
            <h2>Notificaciones pendientes de resolver</h2>
            {data.events.map((e) => (
              <p key={e.event_key}>
                {e.event_key} · {e.last_error}
              </p>
            ))}
            {!data.events.length && <p>Sin errores registrados.</p>}
          </section>
        </>
      )}
    </div>
  );
}

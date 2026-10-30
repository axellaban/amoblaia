import type { Metadata } from "next";
import Link from "next/link";
import { MiguelAvatar } from "@/components/assistant";
import { conversationFilter, conversations, MissingHistory, PER_PAGE, type ConversationFilter } from "@/lib/assistant/admin";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Miguel Ángel",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const when = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

/** The list's URL with some filters changed, so links keep the rest. */
function href(filter: ConversationFilter, change: Partial<ConversationFilter>) {
  const f = { ...filter, ...change };
  const params = new URLSearchParams();
  if (f.place) params.set("lugar", f.place);
  if (f.q) params.set("q", f.q);
  if (f.agency) params.set("inmobiliaria", f.agency);
  if (f.page > 1) params.set("pagina", String(f.page));
  const qs = params.toString();
  return `/admin/asistente${qs ? `?${qs}` : ""}`;
}

const MIGRATION = "202611120001_assistant_conversations.sql";

/** Every conversation with Miguel Ángel: where it happened, who asked, and what. */
export default async function AssistantHistoryPage({ searchParams }: Props) {
  await requireAdminPage("/admin/asistente");
  const filter = conversationFilter(await searchParams);
  let data: Awaited<ReturnType<typeof conversations>> | null = null;
  let problem: string | null = null;
  try {
    data = await conversations(filter);
  } catch (e) {
    problem =
      e instanceof MissingHistory
        ? `Falta aplicar la migración ${MIGRATION} en Supabase: hasta entonces las conversaciones no se guardan.`
        : "No pudimos cargar las conversaciones. Probá recargar.";
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / PER_PAGE)) : 1;
  return (
    <main className="ma-page">
      <header className="ma-head">
        <MiguelAvatar size={52} />
        <div>
          <span className="eyebrow">Asistente</span>
          <h1>Conversaciones con Miguel Ángel</h1>
          <p>Lo que preguntan las inmobiliarias en su panel y en sus demos, con cada respuesta.</p>
        </div>
      </header>

      {data && (
        <dl className="ma-stats" aria-label="Últimos 7 días">
          <div>
            <dt>Conversaciones (7 días)</dt>
            <dd>{data.week.conversations}</dd>
          </div>
          <div>
            <dt>Preguntas (7 días)</dt>
            <dd>{data.week.questions}</dd>
          </div>
          <div>
            <dt>Sin respuesta (7 días)</dt>
            <dd className={data.week.failures ? "is-bad" : undefined}>{data.week.failures}</dd>
          </div>
        </dl>
      )}

      <form className="ma-filters" action="/admin/asistente" role="search">
        <label>
          <span>Buscar</span>
          <input type="search" name="q" defaultValue={filter.q} placeholder="Inmobiliaria, email, demo o pregunta" />
        </label>
        <label>
          <span>Dónde</span>
          <select name="lugar" defaultValue={filter.place ?? ""}>
            <option value="">Panel y demos</option>
            <option value="panel">Panel</option>
            <option value="demo">Demos</option>
          </select>
        </label>
        {filter.agency && <input type="hidden" name="inmobiliaria" value={filter.agency} />}
        <button className="button button-small button-primary">Filtrar</button>
        {(filter.q || filter.place || filter.agency) && (
          <Link href="/admin/asistente" className="text-link">
            Ver todas
          </Link>
        )}
      </form>

      {problem && (
        <p className="inline-error" role="alert">
          {problem}
        </p>
      )}

      {data &&
        (data.items.length ? (
          <ul className="ma-list">
            {data.items.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/asistente/${c.id}`} className="ma-row">
                  <span className="ma-row-top">
                    <span className={`ma-chip is-${c.place}`}>{c.place === "demo" ? "Demo" : "Panel"}</span>
                    <strong>{c.agency_name ?? "Sin inmobiliaria"}</strong>
                    {c.demo_title && <span className="ma-muted">· {c.demo_title}</span>}
                    {c.support && <span className="ma-chip">Soporte</span>}
                    <time dateTime={c.updated_at}>{when(c.updated_at)}</time>
                  </span>
                  <span className="ma-question">“{c.last_question ?? "…"}”</span>
                  <span className="ma-row-meta">
                    {c.user_email ?? (c.place === "demo" ? "Sin cuenta (enlace de demo)" : "Sin email")} · {c.questions}{" "}
                    {c.questions === 1 ? "pregunta" : "preguntas"}
                    {c.failures > 0 && <span className="ma-bad"> · {c.failures} sin respuesta</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="aa-empty">{filter.q || filter.place || filter.agency ? "No hay conversaciones con esos filtros." : "Todavía nadie habló con Miguel Ángel."}</p>
        ))}

      {data && pages > 1 && (
        <nav className="ap-pages" aria-label="Páginas de conversaciones">
          {filter.page > 1 ? (
            <Link className="button button-small button-outline" href={href(filter, { page: filter.page - 1 })}>
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <span>
            Página {filter.page} de {pages}
          </span>
          {filter.page < pages ? (
            <Link className="button button-small button-outline" href={href(filter, { page: filter.page + 1 })}>
              Siguiente
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}

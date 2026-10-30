import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnswerText, MiguelAvatar } from "@/components/assistant";
import { conversation, MissingHistory } from "@/lib/assistant/admin";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Conversación con Miguel Ángel",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

const when = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  });

/** One conversation, whole: who, where, and every question with its answer. */
export default async function AssistantConversationPage({ params }: Props) {
  const { id } = await params;
  await requireAdminPage(`/admin/asistente/${id}`);
  let found: Awaited<ReturnType<typeof conversation>>;
  try {
    found = await conversation(id);
  } catch (e) {
    return (
      <main className="ma-page">
        <Link href="/admin/asistente" className="text-link">
          ← Conversaciones
        </Link>
        <p className="inline-error" role="alert">
          {e instanceof MissingHistory ? "Falta aplicar la migración 202611120001_assistant_conversations.sql en Supabase." : "No pudimos cargar la conversación."}
        </p>
      </main>
    );
  }
  if (!found) notFound();
  const { conversation: c, messages } = found;
  return (
    <main className="ma-page">
      <Link href="/admin/asistente" className="text-link">
        ← Conversaciones
      </Link>
      <header className="ma-head">
        <MiguelAvatar size={52} />
        <div>
          <span className="eyebrow">{c.place === "demo" ? "En una demo" : "En el panel"}</span>
          <h1>{c.agency_name ?? "Sin inmobiliaria"}</h1>
          <p>
            {c.questions} {c.questions === 1 ? "pregunta" : "preguntas"} · del {when(c.created_at)} al {when(c.updated_at)}
          </p>
        </div>
      </header>

      <dl className="ma-facts">
        <div>
          <dt>Dónde</dt>
          <dd>
            {c.place === "demo" ? "Demo en modo demostración" : "Panel de la inmobiliaria"}
            {c.support ? " (vista de soporte del equipo)" : ""}
          </dd>
        </div>
        <div>
          <dt>Inmobiliaria</dt>
          <dd>{c.agency_id ? <Link href={`/admin/inmobiliarias/${c.agency_id}`}>{c.agency_name ?? "Ver inmobiliaria"}</Link> : "Todavía sin inmobiliaria"}</dd>
        </div>
        {c.place === "demo" && (
          <div>
            <dt>Demo</dt>
            <dd>{c.demo_id ? <Link href={`/admin/demos/${c.demo_id}`}>{c.demo_title ?? "Ver demo"}</Link> : (c.demo_title ?? "Demo eliminada")}</dd>
          </div>
        )}
        <div>
          <dt>Cuenta</dt>
          <dd>{c.user_email ?? (c.place === "demo" ? "Sin cuenta: enlace privado de la demo" : "Sin email")}</dd>
        </div>
        <div>
          <dt>Última página</dt>
          <dd>{c.path ?? "—"}</dd>
        </div>
        {c.failures > 0 && (
          <div>
            <dt>Sin respuesta</dt>
            <dd className="ma-bad">{c.failures}</dd>
          </div>
        )}
        {c.agency_id && (
          <div>
            <dt>Más</dt>
            <dd>
              <Link href={`/admin/asistente?inmobiliaria=${c.agency_id}`}>Todas las conversaciones de esta inmobiliaria</Link>
            </dd>
          </div>
        )}
      </dl>

      <ol className="ma-transcript" aria-label="Conversación">
        {messages.map((m) => (
          <li key={m.id} className={`ma-msg is-${m.role}`}>
            <span className="ma-msg-who">
              {m.role === "user" ? (c.place === "demo" ? "Inmobiliaria" : (c.user_email ?? "Usuario")) : "Miguel Ángel"} ·{" "}
              <time dateTime={m.created_at}>{when(m.created_at)}</time>
              {m.model && <span className="ma-muted"> · {m.model}</span>}
            </span>
            {m.content ? <div className="ma-msg-body">{m.role === "assistant" ? <AnswerText text={m.content} /> : <p>{m.content}</p>}</div> : null}
            {m.error && <span className="ma-bad">{m.content ? "Falla" : "Sin respuesta"}: {m.error}</span>}
          </li>
        ))}
      </ol>
    </main>
  );
}

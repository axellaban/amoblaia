import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resources } from "@/lib/content";
import { ContactForm } from "@/components/contact-form";
export function generateStaticParams() {
  return resources.map((r) => ({ slug: r.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const r = resources.find((r) => r.slug === slug);
  return r
    ? {
        title: r.title,
        description: r.intro,
        alternates: { canonical: `/${slug}` },
      }
    : {};
}
export default async function ResourcePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const r = resources.find((r) => r.slug === slug);
  if (!r) notFound();
  return (
    <article className="resource-page container">
      <div className="page-intro">
        <span className="eyebrow">AMOBLAIA · ARGENTINA</span>
        <h1>{r.title}</h1>
        <p>{r.intro}</p>
      </div>
      <div className="resource-layout">
        <div>
          {r.sections.map((s) => (
            <section key={s.title}>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
              {s.points && (
                <ul>
                  {s.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <div className="resource-links">
            <Link href="/estudio" className="button button-primary">
              Probar el estudio
            </Link>
            <Link href="/precios" className="button button-outline">
              Ver planes
            </Link>
            <Link href="/faq">Preguntas frecuentes →</Link>
          </div>
        </div>
        {r.kind && (
          <aside className="request-card">
            <h2>
              {r.kind === "reembolso"
                ? "Enviar solicitud"
                : "Hablemos de tu proyecto"}
            </h2>
            <ContactForm kind={r.kind} />
          </aside>
        )}
      </div>
    </article>
  );
}

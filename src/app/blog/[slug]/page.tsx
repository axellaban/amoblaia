import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { articles } from "@/lib/content";
export function generateStaticParams() {
  return articles.map((a) => ({ slug: a.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const a = articles.find((a) => a.slug === slug);
  return a
    ? {
        title: a.title,
        description: a.intro,
        alternates: { canonical: `/blog/${slug}` },
      }
    : {};
}
export default async function Article({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const a = articles.find((a) => a.slug === slug);
  if (!a) notFound();
  return (
    <article className="blog-article container">
      <Link href="/blog" className="text-link">
        ← Volver al blog
      </Link>
      <div className="page-intro">
        <span className="eyebrow">{a.category}</span>
        <h1>{a.title}</h1>
        <p>{a.intro}</p>
      </div>
      <img
        className="article-cover"
        src={`/ejemplos/${a.image}.webp`}
        alt="Escena ilustrativa creada con IA"
      />
      <div className="article-body">
        {a.sections.map((s) => (
          <section key={s.title}>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
          </section>
        ))}
        <div className="article-cta">
          <h2>Probalo con una foto propia</h2>
          <p>25 diseños gratis por cuenta. Sin tarjeta.</p>
          <Link href="/estudio" className="button button-primary">
            Abrir el estudio
          </Link>
        </div>
        <h2>Seguí explorando</h2>
        {articles
          .filter((b) => b.slug !== slug)
          .slice(0, 3)
          .map((b) => (
            <p key={b.slug}>
              <Link className="text-link" href={`/blog/${b.slug}`}>
                {b.title} →
              </Link>
            </p>
          ))}
      </div>
    </article>
  );
}

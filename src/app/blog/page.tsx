import type { Metadata } from "next";
import Link from "next/link";
import { articles } from "@/lib/content";
export const metadata: Metadata = {
  title: "Blog",
  description:
    "Ideas y guías para fotografía inmobiliaria, decoración y virtual staging en Argentina.",
};
export default function Blog() {
  return (
    <div className="blog-page container">
      <div className="page-intro">
        <span className="eyebrow">IDEAS PARA TU PRÓXIMA PUBLICACIÓN</span>
        <h1>Blog</h1>
        <p>
          Fotografía, estilos y herramientas para mostrar mejor cada propiedad.
        </p>
      </div>
      <div className="blog-grid">
        {articles.map((a) => (
          <Link className="blog-card" href={`/blog/${a.slug}`} key={a.slug}>
            <img
              src={`/ejemplos/${a.image}.webp`}
              alt="Escena ilustrativa de un ambiente"
            />
            <div>
              <span className="category-chip">{a.category}</span>
              <h2>{a.title}</h2>
              <p>{a.intro}</p>
              <span className="text-link">Leer la guía →</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, Plus, Minus, Link2, Check } from "lucide-react";
import { faqItems } from "@/lib/faq";
const categories = [
  "Todas",
  "Diseños",
  "Planes y pagos",
  "Cuenta",
  "Reembolsos",
];
const normalize = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function FaqBrowser() {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("Todas"),
    [open, setOpen] = useState(""),
    [copied, setCopied] = useState("");
  useEffect(() => {
    setOpen(window.location.hash.slice(1));
  }, []);
  const results = faqItems.filter(
    (i) =>
      (category === "Todas" || i.category === category) &&
      normalize(i.q + " " + i.a).includes(normalize(query)),
  );
  return (
    <div className="faq-page container">
      <div className="page-intro">
        <span className="eyebrow">CENTRO DE AYUDA</span>
        <h1>Preguntas frecuentes</h1>
        <p>Encontrá respuestas sobre tus diseños, tu cuenta y tus pagos.</p>
      </div>
      <label className="faq-search">
        <Search size={22} />
        <span className="visually-hidden">Buscar en las preguntas</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="¿En qué podemos ayudarte?"
        />
      </label>
      <div className="faq-browser">
        <aside>
          <h2>Filtrar por categoría</h2>
          {categories.map((c) => (
            <button
              key={c}
              className={category === c ? "selected" : ""}
              onClick={() => setCategory(c)}
            >
              {c}
              <span>
                {c === "Todas"
                  ? faqItems.length
                  : faqItems.filter((i) => i.category === c).length}
              </span>
            </button>
          ))}
        </aside>
        <section aria-live="polite">
          <h2>
            {query
              ? `${results.length} ${results.length === 1 ? "respuesta" : "respuestas"}`
              : "Preguntas más consultadas"}
          </h2>
          {results.length === 0 && (
            <p>
              No encontramos esa pregunta. Probá con otra palabra o{" "}
              <Link href="/ayuda">contactanos</Link>.
            </p>
          )}
          {results.map((item) => (
            <article className="faq-result" id={item.id} key={item.id}>
              <div>
                <span className="category-chip">{item.category}</span>
                <button
                  className="icon-button"
                  aria-label={`Copiar enlace: ${item.q}`}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        `${location.origin}/faq#${item.id}`,
                      );
                      setCopied(item.id);
                    } catch {
                      setOpen(item.id);
                    }
                  }}
                >
                  {copied === item.id ? (
                    <Check size={16} />
                  ) : (
                    <Link2 size={16} />
                  )}
                </button>
              </div>
              <h3>
                <button
                  aria-expanded={open === item.id}
                  aria-controls={`answer-${item.id}`}
                  onClick={() => setOpen(open === item.id ? "" : item.id)}
                >
                  {item.q}
                  {open === item.id ? <Minus size={19} /> : <Plus size={19} />}
                </button>
              </h3>
              <p id={`answer-${item.id}`} hidden={open !== item.id}>
                {item.a}
              </p>
            </article>
          ))}
        </section>
      </div>
      <div className="gallery-invite">
        <div>
          <h2>¿Necesitás una mano?</h2>
          <p>Enviá tu consulta y recibí un número de seguimiento.</p>
        </div>
        <Link href="/ayuda" className="button button-primary">
          Contactar al equipo
        </Link>
      </div>
    </div>
  );
}

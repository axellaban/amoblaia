"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, X, Sparkles } from "lucide-react";
const steps = [
  {
    title: "Te damos la bienvenida a amoblaIA",
    text: "¿Listo para transformar tu primer espacio? Te mostramos cómo subir fotos, crear diseños y organizar cada propiedad.",
    path: "/proyectos",
    target: "",
  },
  {
    title: "Todas tus fotos, en un lugar",
    text: "Acá encontrás los originales y los diseños que guardaste en tu cuenta. Podés volver a abrirlos y descargarlos.",
    path: "/proyectos",
    target: "photos",
  },
  {
    title: "Organizá por propiedad",
    text: "Creá carpetas para cada departamento, casa o cliente. Después asigná las fotos desde su tarjeta.",
    path: "/proyectos",
    target: "folders",
  },
  {
    title: "Encontrá una foto rápido",
    text: "Buscá por nombre y usá los filtros de todas las fotos, sin carpeta o papelera.",
    path: "/proyectos",
    target: "search",
  },
  {
    title: "La papelera permite recuperar",
    text: "Mandar una foto a la papelera no la borra para siempre. Podés restaurarla; el consumo de diseños gratis se conserva.",
    path: "/proyectos",
    target: "trash",
  },
  {
    title: "Empezá con tu foto",
    text: "Subí un JPG, PNG o WebP, o elegí un ejemplo para explorar. Una foto nítida, sin personas y bien iluminada funciona mejor.",
    path: "/estudio",
    target: "upload",
  },
  {
    title: "Elegí qué querés hacer",
    text: "Amoblá un ambiente vacío o rediseñá uno amoblado. Los planes también incluyen vaciado, mejora de foto y día a atardecer.",
    path: "/estudio",
    target: "operation",
  },
  {
    title: "Ambiente y estilo",
    text: "Elegí el ambiente y un estilo habitual como Moderno, Nórdico o Industrial. Sumá indicaciones si querés personalizar el resultado.",
    path: "/estudio",
    target: "style",
  },
  {
    title: "Creá, compará y descargá",
    text: "Las propuestas aparecen una por una mientras se generan. Podés ver y descargar las listas sin esperar al resto. La prueba incluye hasta 25 resultados en tandas de hasta tres.",
    path: "/estudio",
    target: "generate",
  },
];
export function ProductTour() {
  const pathname = usePathname(),
    router = useRouter();
  const [step, setStep] = useState<number | null>(null),
    [rect, setRect] = useState<{
      top: number;
      left: number;
      width: number;
      height: number;
    } | null>(null);
  const dialog = useRef<HTMLDivElement>(null),
    previousFocus = useRef<HTMLElement | null>(null),
    checked = useRef(false);
  useEffect(() => {
    if (
      checked.current ||
      !["/proyectos", "/estudio", "/cuenta"].includes(pathname)
    )
      return;
    checked.current = true;
    void fetch("/api/onboarding", { cache: "no-store" })
      .then(async (r) => {
        if (r.ok && !(await r.json()).completed) {
          previousFocus.current = document.activeElement as HTMLElement;
          setStep(0);
        }
      })
      .catch(() => {});
  }, [pathname]);
  useEffect(() => {
    const restart = () => {
      previousFocus.current = document.activeElement as HTMLElement;
      setStep(0);
    };
    window.addEventListener("amoblaia:tour", restart);
    return () => window.removeEventListener("amoblaia:tour", restart);
  }, []);
  useEffect(() => {
    if (step === null) return;
    const current = steps[step];
    if (step > 0 && pathname !== current.path) {
      router.push(current.path);
      return;
    }
    const update = () => {
      const element = current.target
        ? document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`)
        : null;
      if (element) {
        const r = element.getBoundingClientRect();
        setRect({
          top: r.top - 6,
          left: r.left - 6,
          width: r.width + 12,
          height: r.height + 12,
        });
      } else setRect(null);
    };
    const element = current.target
      ? document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`)
      : null;
    element?.scrollIntoView({ block: "center", behavior: "instant" });
    update();
    dialog.current?.focus();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step, pathname, router]);
  async function finish() {
    const response = await fetch("/api/onboarding", { method: "POST" }).catch(
      () => null,
    );
    if (!response?.ok) {
      /* Closing the guide never blocks the editor. */
    }
    setStep(null);
    setRect(null);
    previousFocus.current?.focus();
  }
  if (step === null) return null;
  const current = steps[step];
  return (
    <div className={`tour-layer ${step === 0 ? "tour-welcome" : ""}`}>
      <div className="tour-backdrop" />
      {rect && (
        <div className="tour-spotlight" style={rect} aria-hidden="true" />
      )}
      <div
        ref={dialog}
        className="tour-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            void finish();
          }
          if (e.key === "Tab") {
            const items =
              dialog.current?.querySelectorAll<HTMLElement>("button,a[href]");
            if (!items?.length) return;
            const first = items[0],
              last = items[items.length - 1];
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === dialog.current)
            ) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <button
          className="icon-button tour-close"
          aria-label="Cerrar recorrido"
          onClick={() => void finish()}
        >
          <X size={20} />
        </button>
        <span className="tour-brand">
          amobla<span>IA</span>
        </span>
        <Sparkles className="tour-spark" size={30} />
        <h2 id="tour-title">{current.title}</h2>
        <p>{current.text}</p>
        <div className="tour-footer">
          <span>
            {step + 1}/{steps.length}
          </span>
          {step === 0 ? (
            <button className="subtle-button" onClick={() => void finish()}>
              Explorar por mi cuenta
            </button>
          ) : (
            <button className="subtle-button" onClick={() => setStep(step - 1)}>
              <ChevronLeft size={16} />
              Atrás
            </button>
          )}
          <button
            className="button button-primary"
            onClick={() =>
              step === steps.length - 1 ? void finish() : setStep(step + 1)
            }
          >
            {step === 0
              ? "Comenzar recorrido"
              : step === steps.length - 1
                ? "Empezar a diseñar"
                : "Siguiente"}
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
export function TourButton() {
  return (
    <button
      className="subtle-button"
      onClick={() => window.dispatchEvent(new Event("amoblaia:tour"))}
    >
      Ver recorrido
    </button>
  );
}

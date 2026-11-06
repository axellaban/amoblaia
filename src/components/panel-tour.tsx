"use client";
// The panel's welcome tour: seven steps over the real home (its header, the
// three tools, the start picker, «Mis demostraciones» and the credits), then
// an invitation to create the first demo. A modal <dialog> on top of
// everything: the page underneath only shows, nothing is clicked, imported or
// charged while it runs. It starts by itself once for a new account
// (/api/panel/recorrido) and again from «Ayuda → Volver a ver el recorrido».
// It does not replace the guide at the bottom of the home (panel-guide.tsx).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { track } from "@/lib/analytics";
import type { PanelSummary } from "@/lib/agency/shared";
import { videoEnabled } from "@/lib/agency/flags";
import { PANEL_MENU_EVENT, PANEL_TOUR_EVENT, PANEL_TOUR_QUERY, TOUR_VERSION } from "@/lib/agency/panel-tour";

export type TourStepId = "welcome" | "demo" | "start" | "studio" | "video" | "demos" | "credits";
export type TourOrigin = "auto" | "help";

type Step = {
  id: TourStepId;
  title: string;
  text: string;
  /** Where to point, in order: the first one on screen is used. */
  targets: string[];
  /** On a phone, the step points into the panel's menu (opened for it). */
  menu?: boolean;
  /** The step shows the real start picker (opened without any action). */
  picker?: boolean;
};

const MOBILE = "(max-width: 860px)";
const SESSION_KEY = "habita-panel-tour";
const SEEN_KEY = "habita-panel-tour-seen";
const DEFER_KEY = "habita-panel-tour-later";

const sel = (id: string) => `[data-tour="${id}"]`;
const isMobile = () => window.matchMedia(MOBILE).matches;
const deviceType = () => (isMobile() ? "mobile" : "desktop");

/**
 * The steps this account can use: no tools for a viewer or a user limited to
 * some properties (they cannot create), no video where it is not enabled,
 * and «Mis demostraciones» on the home only when there are some.
 */
export function tourSteps(data: Pick<PanelSummary, "role" | "properties" | "credits" | "support">, creator: boolean, video = videoEnabled()): Step[] {
  const owner = data.role === "owner" && !data.support;
  const steps: (Step | false)[] = [
    {
      id: "welcome",
      title: "¡Bienvenido a Habita!",
      text: "Te mostramos cómo crear contenido atractivo para tus propiedades y compartirlo con tus clientes.",
      targets: [sel("welcome")],
    },
    creator && {
      id: "demo",
      title: "Tu herramienta principal",
      text: "Creá demostraciones con fotos ambientadas, comparación antes y después y distintos estilos para tus clientes.",
      targets: [sel("tool-demo")],
    },
    creator && {
      id: "start",
      title: "Empezar es muy fácil",
      text: "Podés continuar con una propiedad existente, importar una publicación desde su URL o subir fotos.",
      targets: [".sp-dialog[open]"],
      picker: true,
    },
    creator && {
      id: "studio",
      title: "Mejorá tus fotografías",
      text: "Ambientá espacios, mejorá luz y color, quitá objetos y transformá tus imágenes con IA.",
      targets: [sel("tool-editar")],
    },
    creator &&
      video && {
        id: "video",
        title: "También podés crear videos",
        text: "Transformá las fotos de tus propiedades en videos para destacar tus publicaciones.",
        targets: [sel("tool-video")],
      },
    {
      id: "demos",
      title: "Todo queda organizado",
      text: creator
        ? "Acá encontrás tus propiedades, editás las fotos y compartís las demostraciones publicadas."
        : "Acá encontrás las propiedades de tu inmobiliaria y compartís las demostraciones publicadas.",
      targets: data.properties.length ? [sel("recents")] : [sel("nav-propiedades")],
      menu: !data.properties.length,
    },
    {
      id: "credits",
      title: "Pagás solo cuando lo necesitás",
      text: owner
        ? "Consultá tus créditos disponibles y comprá paquetes cuando quieras. Sin suscripción."
        : "Consultá los créditos disponibles de tu inmobiliaria. Los paquetes los compra la cuenta dueña, sin suscripción.",
      // The real balance: the top bar's on a computer, the menu's on a phone.
      targets: [sel("credits-balance"), sel("credits-plans"), sel("nav-creditos")],
      menu: true,
    },
  ];
  return steps.filter((s): s is Step => Boolean(s));
}

/** Arrived to keep working on something (an import from the demo, a section of the home): the tour waits. */
export function continuingWork() {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has("continuar") || q.has("accion") || q.has("foto")) return true;
    if (window.location.hash && window.location.hash !== "#") return true;
    return Boolean(localStorage.getItem("habita_pending_import") || localStorage.getItem("habita_import_en_curso"));
  } catch {
    return false;
  }
}

const store = {
  get<T>(kind: "session" | "local", key: string): T | null {
    try {
      const raw = (kind === "session" ? sessionStorage : localStorage).getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(kind: "session" | "local", key: string, value: unknown) {
    try {
      const s = kind === "session" ? sessionStorage : localStorage;
      if (value === null) s.removeItem(key);
      else s.setItem(key, JSON.stringify(value));
    } catch {
      /* Private mode: the tour just won't resume after a reload. */
    }
  },
};

type Rect = { top: number; left: number; width: number; height: number };
type Place = { top: number; left: number; width?: number; side: "top" | "bottom" | "left" | "right" | "center"; arrow: number };

const visible = (el: Element | null): el is HTMLElement => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const findTarget = (targets: string[]) => {
  for (const t of targets) {
    const found = Array.from(document.querySelectorAll(t)).find(visible);
    if (found) return found as HTMLElement;
  }
  return null;
};
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/** Next to the element on a computer; on a phone, a compact card above or below it, full width. */
function placeCard(rect: Rect | null, card: { width: number; height: number }): Place {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = 12;
  const gap = 14;
  if (!rect) return { top: Math.max(m, (vh - card.height) / 2), left: Math.max(m, (vw - card.width) / 2), side: "center", arrow: 0 };
  const cx = rect.left + rect.width / 2;
  const clampX = (x: number) => Math.min(Math.max(x, m), vw - card.width - m);
  const clampY = (y: number) => Math.min(Math.max(y, m), vh - card.height - m);
  if (isMobile()) {
    const width = vw - m * 2;
    const arrow = Math.min(Math.max(cx - m, 24), width - 24);
    const fits = rect.top >= 0 && rect.top + rect.height <= vh;
    if (fits && vh - (rect.top + rect.height) >= card.height + gap + m) return { top: rect.top + rect.height + gap, left: m, width, side: "bottom", arrow };
    if (fits && rect.top >= card.height + gap + m) return { top: rect.top - card.height - gap, left: m, width, side: "top", arrow };
    // No room: the card sits at the bottom of the screen, over the element's end.
    return { top: vh - card.height - m, left: m, width, side: "center", arrow: 0 };
  }
  const below = rect.top + rect.height + gap;
  if (below + card.height + m <= vh) {
    const left = clampX(cx - card.width / 2);
    return { top: below, left, side: "bottom", arrow: cx - left };
  }
  if (rect.top - gap - card.height >= m) {
    const left = clampX(cx - card.width / 2);
    return { top: rect.top - gap - card.height, left, side: "top", arrow: cx - left };
  }
  const cy = rect.top + rect.height / 2;
  if (rect.left + rect.width + gap + card.width + m <= vw) {
    const top = clampY(cy - card.height / 2);
    return { top, left: rect.left + rect.width + gap, side: "right", arrow: cy - top };
  }
  if (rect.left - gap - card.width >= m) {
    const top = clampY(cy - card.height / 2);
    return { top, left: rect.left - gap - card.width, side: "left", arrow: cy - top };
  }
  return { top: clampY(vh - card.height - m), left: clampX(cx - card.width / 2), side: "center", arrow: 0 };
}

type Run = { index: number; origin: TourOrigin } | { index: "final"; origin: TourOrigin };

/**
 * The tour over the panel's home. `openPicker` shows the real start picker
 * (step 3, without any action, and the final «Crear mi primera
 * demostración», as a normal opening).
 */
export function PanelTour({
  data,
  creator,
  continuing,
  setPicker,
}: {
  data: PanelSummary;
  creator: boolean;
  /** Arrived to keep working on something: the tour does not start by itself this time. */
  continuing: boolean;
  setPicker: (picker: { tour: boolean } | null) => void;
}) {
  const uid = useId();
  const steps = useMemo(() => tourSteps(data, creator), [data, creator]);
  const available = !data.support && !data.visitor;
  const [run, setRun] = useState<Run | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const promoting = useRef(false);
  const closing = useRef(false);
  const menuOpen = useRef(false);
  const started = useRef(false);
  const viewed = useRef<string>("");
  const ownDemos = data.properties.some((p) => p.origin === "agency");

  const props = useCallback(
    (origin: TourOrigin) => ({ tour_version: TOUR_VERSION, origin, steps_total: steps.length, role: data.role, device_type: deviceType() }),
    [steps.length, data.role],
  );

  const measure = useCallback(() => {
    const el = target.current;
    const r = el?.isConnected ? el.getBoundingClientRect() : null;
    const pad = 6;
    const next = r && r.width && r.height ? { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 } : null;
    setRect(next);
    const c = card.current;
    if (c) {
      // Never off screen, whatever the element does.
      const p = placeCard(next, { width: c.offsetWidth, height: c.offsetHeight });
      setPlace({ ...p, top: Math.min(Math.max(p.top, 12), Math.max(12, window.innerHeight - c.offsetHeight - 12)) });
    }
  }, []);

  const setMenu = (open: boolean) => {
    if (menuOpen.current === open) return;
    menuOpen.current = open;
    window.dispatchEvent(new CustomEvent(PANEL_MENU_EVENT, { detail: open }));
  };

  const start = useCallback(
    (origin: TourOrigin, index = 0, resumed = false) => {
      if (!steps.length) return;
      started.current = true;
      previousFocus.current = (document.activeElement as HTMLElement | null) ?? null;
      viewed.current = "";
      setRun({ index, origin });
      if (resumed) return;
      track("panel_tour_started", props(origin));
      store.set("local", SEEN_KEY, TOUR_VERSION);
      void fetch("/api/panel/recorrido", { method: "POST" }).catch(() => null);
    },
    [steps.length, props],
  );

  // Starting: from «Ayuda» (an event on the home, or ?recorrido=1 from another page), a reload in the middle, or by itself once.
  useEffect(() => {
    // Marked when it really starts: React may run this twice on arrival (a cancelled first lookup starts nothing).
    if (!available || started.current) return;
    const q = new URLSearchParams(window.location.search);
    if (q.has(PANEL_TOUR_QUERY)) {
      q.delete(PANEL_TOUR_QUERY);
      const query = q.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      start("help");
      return;
    }
    const saved = store.get<{ index: number | "final"; origin: TourOrigin; v: number }>("session", SESSION_KEY);
    if (saved && saved.v === TOUR_VERSION) {
      const index = saved.index === "final" ? steps.length - 1 : Math.min(Math.max(0, saved.index), steps.length - 1);
      start(saved.origin, index, true);
      return;
    }
    if (continuing) store.set("session", DEFER_KEY, true);
    if (continuing || store.get("session", DEFER_KEY) || store.get("local", SEEN_KEY) === TOUR_VERSION) return;
    let cancelled = false;
    void fetch("/api/panel/recorrido", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { eligible: false }))
      .then(async (r: { eligible?: boolean }) => {
        if (cancelled || !r.eligible) return;
        // Once the home has painted; never over a dialog the person opened meanwhile.
        await new Promise((res) => setTimeout(res, 600));
        if (cancelled || started.current || document.querySelector("dialog[open]")) return;
        start("auto");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [available, continuing, start, steps.length]);

  useEffect(() => {
    if (!available) return;
    const again = () => {
      if (run) return;
      store.set("session", SESSION_KEY, null);
      start("help");
    };
    window.addEventListener(PANEL_TOUR_EVENT, again);
    return () => window.removeEventListener(PANEL_TOUR_EVENT, again);
  }, [available, run, start]);

  const end = useCallback(
    (how: "completed" | "skipped" | "cta", method?: string) => {
      if (!run) return;
      const step = run.index === "final" ? null : steps[run.index];
      if (how === "skipped" && step)
        track("panel_tour_skipped", { ...props(run.origin), step_id: step.id, step_index: (run.index as number) + 1, method: method ?? "button" });
      store.set("session", SESSION_KEY, null);
      setMenu(false);
      setPicker(null);
      setRun(null);
      setRect(null);
      setPlace(null);
      promoting.current = false;
      if (dialog.current?.open) {
        closing.current = true;
        dialog.current.close();
      }
      if (how === "cta") {
        track("panel_tour_primary_cta_clicked", { ...props(run.origin), cta: "create_first_demo" });
        // The start picker, as a normal opening: the prepared property goes first there.
        setPicker({ tour: false });
        return;
      }
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    },
    // setMenu only reads a ref and dispatches.
    [run, steps, props, setPicker],
  );

  const go = (index: number | "final") => {
    if (!run) return;
    if (index === "final") track("panel_tour_completed", props(run.origin));
    setRun({ index, origin: run.origin });
  };

  // Each step: the picker and the menu as it needs them, the element in view, the card next to it.
  const index = run?.index;
  useEffect(() => {
    if (!run) return;
    const d = dialog.current;
    if (d && !d.open) {
      closing.current = false;
      d.showModal();
    }
    store.set("session", SESSION_KEY, { index: run.index, origin: run.origin, v: TOUR_VERSION });
    const step = run.index === "final" ? null : steps[run.index];
    let cancelled = false;
    void (async () => {
      setPicker(step?.picker ? { tour: true } : null);
      if (!step?.menu || !isMobile()) setMenu(false);
      await nextFrame();
      if (cancelled) return;
      // The picker is a modal dialog too: the tour goes back on top of it (the last one opened).
      if (step?.picker && d?.open) {
        promoting.current = true;
        d.close();
        d.showModal();
      }
      let el = step ? findTarget(step.targets) : null;
      if (step && !el && step.menu && isMobile()) {
        setMenu(true);
        await nextFrame();
        if (cancelled) return;
        el = findTarget(step.targets);
      }
      target.current = el;
      // Also inside the phone's menu, which scrolls on its own (the credits are at its end).
      if (el && !step?.picker) {
        const r = el.getBoundingClientRect();
        el.scrollIntoView({ block: r.height > window.innerHeight * 0.55 ? "start" : "center", behavior: "instant" as ScrollBehavior });
      }
      measure();
      primary.current?.focus();
      if (step && viewed.current !== `${run.index}`) {
        viewed.current = `${run.index}`;
        track("panel_tour_step_viewed", { ...props(run.origin), step_id: step.id, step_index: (run.index as number) + 1 });
      }
    })();
    return () => {
      cancelled = true;
    };
    // One pass per step: the rest is read when it starts.
  }, [index]);

  useEffect(() => {
    if (!run) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const watch = new ResizeObserver(update);
    if (card.current) watch.observe(card.current);
    // The element may still be settling (the picker loads its list and opens with an animation).
    const observed = window.setInterval(() => {
      if (target.current && target.current.isConnected) watch.observe(target.current);
    }, 200);
    const late = [250, 600, 1200].map((ms) => window.setTimeout(update, ms));
    return () => {
      window.clearInterval(observed);
      late.forEach((t) => window.clearTimeout(t));
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      watch.disconnect();
    };
  }, [run, measure]);

  // The card's own size changes with the step: placed again before painting.
  useLayoutEffect(() => {
    if (run) measure();
  }, [run, measure]);

  if (!available || !run) return null;

  const final = run.index === "final";
  const step = final ? null : steps[run.index as number];
  const at = final ? steps.length : (run.index as number);
  const last = at === steps.length - 1;
  const titleId = `${uid}-title`;
  const textId = `${uid}-text`;
  const style = place
    ? ({ top: place.top, left: place.left, ...(place.width ? { width: place.width } : {}), "--pt-arrow": `${place.arrow}px` } as React.CSSProperties)
    : { visibility: "hidden" as const };

  return (
    <dialog
      ref={dialog}
      className={`pt-layer ${final ? "is-final" : ""} ${step?.picker ? "is-picker" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={(e) => {
        // Escape: the tour ends; the browser closes it (close event) if it insists.
        e.preventDefault();
        if (final) end("completed");
        else end("skipped", "escape");
      }}
      onKeyDown={(e) => {
        // Tab goes around the card's buttons: it never leaves the tour for the page or the browser.
        if (e.key !== "Tab") return;
        const items = Array.from(card.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 || i < 0 ? 0 : i + 1;
        e.preventDefault();
        items[next].focus();
      }}
      onClose={() => {
        if (promoting.current || closing.current) {
          promoting.current = false;
          closing.current = false;
          return;
        }
        if (run) end(final ? "completed" : "skipped", "escape");
      }}
    >
      {rect && !final ? <div className="pt-spot" style={rect} aria-hidden="true" /> : <div className="pt-shade" aria-hidden="true" />}
      <div ref={card} className={`pt-card is-${final ? "final" : (place?.side ?? "center")}`} style={final ? undefined : style}>
        <button type="button" className="pt-close" aria-label="Cerrar el recorrido" onClick={() => (final ? end("completed") : end("skipped", "close"))}>
          <X size={18} aria-hidden="true" />
        </button>
        {final ? (
          <>
            <span className="pt-done" aria-hidden="true">
              <Check size={30} strokeWidth={3} />
            </span>
            <h2 id={titleId}>¡Listo para empezar!</h2>
            <p id={textId}>
              {creator
                ? "Ya conocés las herramientas principales. Ahora probemos con una propiedad real de tu inmobiliaria."
                : "Ya conocés las herramientas principales del panel de tu inmobiliaria."}
            </p>
            <div className="pt-final-actions">
              {creator && (
                <button ref={primary} type="button" className="button button-primary" onClick={() => end("cta")}>
                  {ownDemos ? "Crear una demostración" : "Crear mi primera demostración"} <ArrowRight size={17} aria-hidden="true" />
                </button>
              )}
              <button ref={creator ? undefined : primary} type="button" className={creator ? "text-link pt-explore" : "button button-primary"} onClick={() => end("completed")}>
                {creator ? "Explorar el panel por mi cuenta" : "Explorar el panel"}
              </button>
            </div>
          </>
        ) : (
          step && (
            <>
              <h2 id={titleId}>{step.title}</h2>
              <p id={textId}>{step.text}</p>
              <div className="pt-foot">
                <span className="pt-count" aria-label={`Paso ${at + 1} de ${steps.length}`}>
                  {at + 1} de {steps.length}
                </span>
                <button type="button" className="pt-skip" onClick={() => end("skipped", "button")}>
                  Saltar
                </button>
                <div className="pt-nav">
                  {at > 0 && (
                    <button type="button" className="button button-outline button-small pt-back" onClick={() => go(at - 1)}>
                      <ArrowLeft size={16} aria-hidden="true" /> Anterior
                    </button>
                  )}
                  <button ref={primary} type="button" className="button button-primary button-small" onClick={() => go(last ? "final" : at + 1)}>
                    {last ? "Finalizar" : "Siguiente"} <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </>
          )
        )}
      </div>
    </dialog>
  );
}

/** «Ayuda → Volver a ver el recorrido»: on the home it starts there; elsewhere the home opens with it. */
export function reopenTour(source: string) {
  const home = window.location.pathname === "/panel";
  track("panel_tour_reopened", { tour_version: TOUR_VERSION, source_surface: source, device_type: deviceType() }, !home);
  if (home) window.dispatchEvent(new Event(PANEL_TOUR_EVENT));
  else window.location.assign(`/panel?${PANEL_TOUR_QUERY}=1`);
}


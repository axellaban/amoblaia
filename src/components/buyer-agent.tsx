"use client";
// «Asistente de la propiedad»: in the agency's own demo, a simulation of how an
// assistant would answer a buyer about THIS property, and how that conversation
// would land in a CRM. Answers by rules from what the demo publishes
// (lib/demos/buyer-agent.ts); nothing is sent, booked or stored except the
// access request. Its events go straight to PostHog: never the demo's activity
// steps nor the lead score, so the group that sees it does not look more
// engaged just for having one more block (docs/CRO_INSTRUMENTACION.md, section 8).
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, CheckCircle2, Send } from "lucide-react";
import { track, type EventProperties } from "@/lib/analytics";
import { cta } from "@/lib/interaction-tracking";
import type { PublicDemo } from "@/lib/demos/shared";
import {
  AGENT_INTENT_LABEL,
  AGENT_SUGGESTIONS,
  BUYER_AGENT_EXPERIMENT,
  agentReply,
  leadAfter,
  type AgentReply,
  type BuyerAgentDecision,
} from "@/lib/demos/buyer-agent";

/** What the agency is looking at in the gallery: the photo and the style on screen. */
export type AgentViewing = { photo: string; style: string | null } | null;

type Turn = { question: string; reply: AgentReply; source: "suggested" | "typed" };
type RequestState = "idle" | "busy" | "done" | "already" | "internal" | "error";

const deviceType = () => (typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches ? "mobile" : "desktop");

export function BuyerAgent({
  demo,
  token,
  code,
  decision,
  viewing,
  panelHref,
}: {
  demo: PublicDemo;
  token: string;
  /** The agency's invitation: the server checks it before saving the request. */
  code: string;
  decision: BuyerAgentDecision;
  viewing: AgentViewing;
  panelHref: string;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [visit, setVisit] = useState<string | null>(null);
  const [request, setRequest] = useState<RequestState>("idle");
  const box = useRef<HTMLElement>(null);
  const sent = useRef<Record<string, boolean>>({});

  const facts = { title: demo.title, location: demo.location, operation: demo.operation, price: demo.price, availability: demo.availability, features: demo.features };
  const props = (extra: EventProperties = {}): EventProperties => ({
    agency_id: demo.agencyId,
    demo_id: demo.id,
    // A demo forced by the team is out of the analysis: no group.
    experiment_variant: decision.variant ? `${BUYER_AGENT_EXPERIMENT}:${decision.variant}` : "forzado",
    entry_surface: "demo_owner",
    device_type: deviceType(),
    property_context_present: Boolean(viewing),
    is_simulation: true,
    ...extra,
  });
  /** Once per page view (exposure, opening, the CRM card). */
  const once = (event: string, extra: EventProperties = {}) => {
    if (sent.current[event]) return;
    sent.current[event] = true;
    track(event, props(extra));
  };

  // Exposed: the closed strip was on screen (half of it, once).
  useEffect(() => {
    const el = box.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          once("integrated_demo_exposed");
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
    // Once per demo page.
  }, []);

  function ask(question: string, source: Turn["source"]) {
    const q = question.trim().slice(0, 500);
    if (!q) return;
    const reply = agentReply(q, facts);
    setTurns((t) => [...t, { question: q, reply, source }]);
    setText("");
    track("buyer_agent_question_submitted", props({ intent_category: reply.intent, question_source: source }));
    track("buyer_agent_response_displayed", props({ intent_category: reply.intent, answered_from_data: reply.answeredFromData }));
    if (turns.length === 0) once("buyer_agent_crm_preview_opened");
  }

  function pickSlot(slot: string) {
    setVisit(slot);
    track("buyer_agent_visit_requested", props());
  }

  async function requestAccess() {
    if (request === "busy") return;
    setRequest("busy");
    try {
      const res = await fetch(`/api/demo/${encodeURIComponent(token)}/interes-comercial`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error("request_failed");
      const r = (await res.json()) as { registered: boolean; already?: boolean; internal?: boolean };
      if (r.internal) return setRequest("internal");
      setRequest(r.already ? "already" : "done");
      // Counted only once the server saved it (a repeat is not a new request).
      if (!r.already) track("integrated_product_access_requested", props());
    } catch {
      setRequest("error");
    }
  }

  const lastSlots = turns.at(-1)?.reply.slots ?? null;
  const lead = leadAfter(turns, visit);
  const context = viewing ? `${viewing.photo}${viewing.style ? ` · ${viewing.style}` : ""}` : null;

  if (!open)
    return (
      <section ref={box} className="ba-strip" aria-labelledby="ba-title">
        <div className="ba-strip-text">
          <span className="ba-icon" aria-hidden="true">
            <Bot size={20} />
          </span>
          <h2 id="ba-title">Probá cómo respondería un asistente IA a un comprador</h2>
          <span className="ba-pill">Simulación</span>
        </div>
        <button
          type="button"
          className="button button-small button-outline"
          aria-expanded="false"
          aria-controls="ba-panel"
          {...cta("buyer_agent_open", "buyer_agent", "buyer_agent_preview")}
          onClick={() => {
            setOpen(true);
            once("buyer_agent_preview_opened");
          }}
        >
          Probar
        </button>
      </section>
    );

  return (
    <section ref={box} id="ba-panel" className="ba-block" aria-labelledby="ba-title">
      <div className="ba-head">
        <h2 id="ba-title">
          <Bot size={20} aria-hidden="true" /> Probá cómo respondería un asistente IA a un comprador
        </h2>
        <span className="ba-pill">Simulación</span>
      </div>
      <p className="ba-sub">Con los datos publicados de esta propiedad. Elegí una pregunta o escribí la tuya, como si fueras un comprador.</p>
      <div className="ba-grid">
        <div className="ba-chat">
          {context && (
            <p className="ba-context">
              Estás viendo: <strong>{context}</strong>
            </p>
          )}
          <div className="ba-suggest" role="group" aria-label="Preguntas sugeridas">
            {AGENT_SUGGESTIONS.map((s, i) => (
              <button key={s} type="button" {...cta(`buyer_agent_suggestion_${i}`, "buyer_agent", "buyer_agent_question")} onClick={() => ask(s, "suggested")}>
                {s}
              </button>
            ))}
          </div>
          {turns.length > 0 && (
            <ol className="ba-thread" aria-live="polite">
              {turns.map((t, i) => (
                <li key={i}>
                  <p className="ba-msg is-buyer">
                    <small>Comprador (vos, probando)</small>
                    {t.question}
                  </p>
                  <p className="ba-msg is-agent">
                    <small>Asistente de la propiedad</small>
                    {t.reply.text}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {lastSlots && (
            <div className="ba-slots" role="group" aria-label="Horarios propuestos para la visita">
              {lastSlots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  className={visit === slot ? "is-on" : undefined}
                  aria-pressed={visit === slot}
                  {...cta("buyer_agent_visit_slot", "buyer_agent", "buyer_agent_visit")}
                  onClick={() => pickSlot(slot)}
                >
                  {slot}
                </button>
              ))}
            </div>
          )}
          <form
            className="ba-composer"
            onSubmit={(e) => {
              e.preventDefault();
              ask(text, "typed");
            }}
          >
            <label className="dv2-sr" htmlFor="ba-input">
              Consulta de comprador para probar
            </label>
            <input id="ba-input" type="text" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribí como si fueras un comprador…" autoComplete="off" />
            <button type="submit" aria-label="Enviar consulta de prueba" disabled={!text.trim()} {...cta("buyer_agent_send", "buyer_agent", "buyer_agent_question")}>
              <Send size={18} aria-hidden="true" />
            </button>
          </form>
        </div>

        <aside className="ba-crm" aria-label="Cómo llegaría a tu CRM">
          <div className="ba-crm-head">
            <strong>Así llegaría a tu CRM</strong>
            <span className="ba-example">Ejemplo</span>
          </div>
          {turns.length === 0 ? (
            <p className="ba-crm-empty">Hacé una pregunta y vas a ver cómo se ordena la consulta para tu equipo.</p>
          ) : (
            <dl className="ba-crm-rows">
              <dt>Propiedad</dt>
              <dd>{demo.title}</dd>
              {context && (
                <>
                  <dt>Miró</dt>
                  <dd>{context}</dd>
                </>
              )}
              <dt>Intención</dt>
              <dd>{lead.intent ? AGENT_INTENT_LABEL[lead.intent] : "—"}</dd>
              <dt>Presupuesto</dt>
              <dd>{lead.budget ?? "No lo dijo"}</dd>
              <dt>Pendiente</dt>
              <dd>{lead.pending.length ? lead.pending.join(", ") : "Nada"}</dd>
              <dt>Próxima acción</dt>
              <dd>{lead.nextAction}</dd>
            </dl>
          )}
          <p className="ba-note">Ejemplo: no se envió ningún mensaje ni se agendó ninguna visita.</p>
          {request === "done" || request === "already" ? (
            <p className="ba-done" role="status">
              <CheckCircle2 size={18} aria-hidden="true" />
              {request === "done" ? "Solicitud registrada. Todavía no se activó ningún servicio." : "Ya registramos tu solicitud."}
            </p>
          ) : request === "internal" ? (
            <p className="ba-note" role="status">
              Vista del equipo: la solicitud no se guarda.
            </p>
          ) : (
            <button
              type="button"
              className="ba-cta"
              disabled={request === "busy"}
              {...cta("buyer_agent_request_access", "buyer_agent", "integrated_access_request", "habita_b2b")}
              onClick={() => void requestAccess()}
            >
              {request === "busy" ? "Registrando…" : "Quiero esto para mi inmobiliaria"} <ArrowRight size={17} aria-hidden="true" />
            </button>
          )}
          {request === "error" && (
            <p className="ba-error" role="alert">
              No pudimos registrar tu solicitud. Revisá tu conexión e intentá nuevamente.
            </p>
          )}
          <a href={panelHref} className="ba-panel-link" {...cta("buyer_agent_panel", "buyer_agent", "panel_visit", "habita_b2b", { intent: "panel_home" })}>
            Continuar en mi panel
          </a>
          <small className="ba-fine">Registra tu interés. No activa mensajes ni conecta WhatsApp.</small>
        </aside>
      </div>
    </section>
  );
}

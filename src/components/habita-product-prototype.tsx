"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Bot, CalendarDays, CheckCircle2, MessageCircle, Send, Sparkles, UserRound } from "lucide-react";
import { track } from "@/lib/analytics";
import { PanelNav } from "@/components/panel-shell";

type Product = "consultas" | "crm";
type Lead = { id: number; name: string; interest: string; score: number; status: string; last: string; action: string };
const inventory = [
  { name: "Departamento Güemes", zone: "Güemes", rooms: 2, price: 95000, area: 58 },
  { name: "Departamento Centro", zone: "Centro", rooms: 2, price: 78000, area: 49 },
  { name: "Departamento Playa Grande", zone: "Playa Grande", rooms: 3, price: 145000, area: 86 },
];
const initialLeads: Lead[] = [
  { id: 1, name: "Martina G.", interest: "2 ambientes · Güemes · USD 100.000", score: 92, status: "Calificado", last: "Solicitó coordinar una visita", action: "Confirmar visita" },
  { id: 2, name: "Lucas R.", interest: "3 ambientes · Playa Grande", score: 76, status: "Seguimiento", last: "Consultó por financiación", action: "Confirmar condiciones" },
  { id: 3, name: "Sofía M.", interest: "Departamento · Centro", score: 44, status: "Sin respuesta", last: "No respondió el último mensaje", action: "Revisar seguimiento" },
];
const intent = (s: string) => /visita|visitar|verlo|conocer|turno|horario/i.test(s) ? "visita" : /precio|cu[aá]nto|financi|cr[eé]dito/i.test(s) ? "precio" : /busco|ambientes|zona|presupuesto|ten[eé]s/i.test(s) ? "busqueda" : "general";
function answer(q: string) {
  const kind = intent(q);
  const budget = q.match(/(?:usd|u\$s|d[oó]lares?)\s*([\d.,]+)/i)?.[1] ?? q.match(/([\d.,]+)\s*(?:usd|u\$s)/i)?.[1];
  const amount = budget ? Number(budget.replace(/\./g, "").replace(",", ".")) : null;
  const zone = inventory.find(p => q.toLowerCase().includes(p.zone.toLowerCase()));
  const rooms = /3\s*ambientes/i.test(q) ? 3 : /2\s*ambientes/i.test(q) ? 2 : null;
  const matches = inventory.filter(p => (!zone || p.zone === zone.zone) && (!rooms || p.rooms === rooms) && (!amount || p.price <= amount));
  if (kind === "visita") return { text: "¡Claro! Puedo ayudarte a coordinar una visita. ¿Preferís mañana por la mañana o por la tarde? Un asesor confirmará la disponibilidad antes de reservar.", tag: "Visita solicitada" };
  if (kind === "precio") return { text: zone ? `El precio publicado de ${zone.name} es USD ${zone.price.toLocaleString("es-AR")}. No tengo condiciones de financiación verificadas; puedo derivar esa consulta a un asesor.` : "Tenemos propiedades desde USD 78.000 en esta demo. Para financiación y condiciones específicas te conectaría con un asesor.", tag: "Consulta comercial" };
  if (kind === "busqueda") return { text: matches.length ? `Encontré ${matches.length} opción(es) en el inventario de ejemplo: ${matches.map(p => `${p.name} (${p.rooms} ambientes, USD ${p.price.toLocaleString("es-AR")})`).join("; ")}. ¿La buscás para vivir o invertir?` : "No encuentro una propiedad que cumpla todos esos filtros en este inventario de ejemplo. ¿Querés ampliar zona o presupuesto?", tag: matches.length ? "Búsqueda calificada" : "Sin coincidencias" };
  return { text: "¡Hola! Soy el asistente de demostración de Habita. Puedo ayudarte con propiedades, precios publicados o visitas. ¿Qué estás buscando?", tag: "Consulta general" };
}
function metric(event: string, product: Product, props: Record<string, string | number | boolean> = {}) { track(event, { product, prototype: true, ...props }); }
export function ProductPrototype({ product }: { product: Product }) {
  const isChat = product === "consultas";
  const [messages, setMessages] = useState<{ from: "user" | "bot"; text: string }[]>([{ from: "bot", text: "¡Hola! Soy Habita IA. ¿Querés conocer una propiedad, consultar un precio o coordinar una visita?" }]);
  const [input, setInput] = useState("");
  const [tag, setTag] = useState("Sin calificar");
  const [handoff, setHandoff] = useState(false);
  const [leads, setLeads] = useState(initialLeads);
  const [selected, setSelected] = useState(1);
  const [filter, setFilter] = useState("Todos");
  const [request, setRequest] = useState(false);
  const current = useMemo(() => leads.find(l => l.id === selected) ?? leads[0], [leads, selected]);
  function send(value = input) {
    const q = value.trim().slice(0, 500);
    if (!q) return;
    const result = answer(q);
    setMessages(m => [...m, { from: "user", text: q }, { from: "bot", text: result.text }]);
    setTag(result.tag); setInput("");
    metric("prototype_meaningful_interaction", "consultas", { intent: intent(q) });
  }
  function advance() {
    setLeads(ls => ls.map(l => l.id === selected ? { ...l, status: "Visita pendiente", last: "Visita pendiente de confirmación", action: "Confirmar horario" } : l));
    metric("prototype_crm_action", "crm", { action: "advance_to_visit" });
  }
  return <><PanelNav section="inicio" /><main className="account-page container ap-page" style={{ paddingTop: 32, paddingBottom: 80 }}>
    <Link href="/panel" style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 24 }}><ArrowLeft size={18}/> Volver al panel</Link>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div><p style={{ fontSize: 12, letterSpacing: 2, opacity: .65 }}>HABITA · NUEVO</p><h1 style={{ margin: "6px 0" }}>{isChat ? "Consultas IA" : "CRM Inteligente"}</h1><p style={{ opacity: .75 }}>{isChat ? "Respondé consultas y convertí interesados en visitas." : "Priorizá oportunidades y definí la próxima acción."}</p></div>
      <span style={{ padding: "7px 12px", borderRadius: 20, background: "#e7f3eb", color: "#245c3b", fontSize: 12, fontWeight: 700 }}>PROTOTIPO · DATOS FICTICIOS</span>
    </div>
    <div style={{ margin: "24px 0", padding: 16, background: "#f3f6f2", color: "#294a36", borderRadius: 12, fontSize: 14 }}>Probá libremente. Esta demo no se conecta a WhatsApp, no envía mensajes y no modifica contactos reales. Las respuestas son simuladas a partir de un inventario de ejemplo.</div>
    {isChat ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", gap: 20 }}>
      <section style={card}>
        <h2 style={heading}><MessageCircle size={22}/> Conversación de ejemplo</h2>
        <div aria-live="polite" style={{ minHeight: 320, maxHeight: 460, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, padding: "18px 0" }}>
          {messages.map((m,i) => <div key={i} style={{ alignSelf: m.from === "user" ? "flex-end" : "flex-start", maxWidth: "88%", padding: 13, borderRadius: 14, background: m.from === "user" ? "#e0f0e3" : "#f4f4f2", color: "#202c25", fontSize: 14 }}>{m.text}</div>)}
        </div>
        <form onSubmit={e => { e.preventDefault(); send(); }} style={{ display: "flex", gap: 8 }}>
          <input aria-label="Escribí tu consulta" value={input} onChange={e => setInput(e.target.value)} placeholder="Escribí una consulta..." maxLength={500} style={{ flex: 1, minWidth: 0, padding: 12, border: "1px solid #ccc", borderRadius: 10 }} />
          <button type="submit" className="button button-primary" aria-label="Enviar consulta"><Send size={18}/></button>
        </form>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          {["Quiero visitar Güemes", "¿Cuánto cuesta en Centro?", "Busco 2 ambientes hasta USD 100000"].map(q => <button key={q} type="button" className="button button-outline button-small" onClick={() => send(q)}>{q}</button>)}
        </div>
      </section>
      <section style={card}>
        <h2 style={heading}><Bot size={22}/> Panel del asesor</h2>
        <p style={{ opacity: .7, fontSize: 13 }}>Calificación de la conversación</p>
        <h3 style={{ margin: "8px 0 24px" }}>{tag}</h3>
        <h3 style={heading}><CalendarDays size={20}/> Próxima acción</h3>
        <p>{tag === "Visita solicitada" ? "Confirmar día, hora y disponibilidad con el asesor." : "Continuar calificando o derivar a una persona."}</p>
        <button type="button" className="button button-outline" onClick={() => { setHandoff(true); metric("prototype_handoff_clicked", "consultas"); }}>Solicitar intervención humana</button>
        {handoff && <p role="status" style={{ marginTop: 12, color: "#24613b" }}><CheckCircle2 size={16} style={{ display: "inline" }}/> Derivación simulada. No se notificó a nadie.</p>}
        <h3 style={{ marginTop: 32 }}>Inventario de demostración</h3>
        {inventory.map(p => <p key={p.name} style={{ fontSize: 14, borderBottom: "1px solid #eee", paddingBottom: 12 }}>{p.name} · {p.rooms} amb. · USD {p.price.toLocaleString("es-AR")}</p>)}
      </section>
    </div> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", gap: 20 }}>
      <section style={card}>
        <h2 style={heading}><UserRound size={22}/> Oportunidades</h2>
        <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>{["Todos","Calificado","Seguimiento"].map(f => <button type="button" key={f} onClick={() => setFilter(f)} className={filter === f ? "button button-primary button-small" : "button button-outline button-small"}>{f}</button>)}</div>
        {leads.filter(l => filter === "Todos" || l.status === filter).map(l => <button type="button" key={l.id} onClick={() => { setSelected(l.id); metric("prototype_crm_lead_opened", "crm", { score: l.score }); }} style={{ display: "block", textAlign: "left", width: "100%", padding: 16, marginBottom: 10, border: l.id === selected ? "2px solid #285a3c" : "1px solid #ddd", borderRadius: 12, background: "#fff", color: "#202c25", cursor: "pointer" }}><strong>{l.name}</strong><span style={{ float: "right", fontWeight: 700 }}>{l.score}/100</span><div style={{ fontSize: 13, opacity: .7, marginTop: 6 }}>{l.interest}</div><div style={{ fontSize: 12, marginTop: 8 }}>{l.status}</div></button>)}
      </section>
      <section style={card}>
        <h2 style={heading}><Sparkles size={22}/> Ficha del interesado</h2>
        <h3>{current.name}</h3><p>{current.interest}</p>
        <p><strong>Estado:</strong> {current.status}</p><p><strong>Última actividad:</strong> {current.last}</p>
        <div style={{ background: "#f3f6f2", padding: 16, borderRadius: 12, margin: "24px 0" }}><strong>Prioridad sugerida: {current.score}/100</strong><p style={{ marginBottom: 0, fontSize: 14 }}>Score ilustrativo, no predictivo. {current.score >= 85 ? "Intención de visita explícita y presupuesto compatible." : current.score >= 70 ? "Interés activo, falta resolver una condición." : "No hay intención de compra confirmada."}</p></div>
        <p><strong>Siguiente acción:</strong> {current.action}</p>
        <button type="button" className="button button-primary" onClick={advance}>Simular avance a visita <ArrowRight size={17}/></button>
        <p style={{ fontSize: 12, opacity: .65, marginTop: 14 }}>El cambio ocurre únicamente en esta pantalla y se pierde al recargar.</p>
      </section>
    </div>}
    <section style={{ ...card, marginTop: 24, textAlign: "center" }}>
      <h2>¿Te serviría en tu inmobiliaria?</h2><p>Estamos validando qué problemas vale la pena resolver primero.</p>
      <button type="button" className="button button-primary" onClick={() => { setRequest(true); metric("prototype_activation_intent", product); }}> {isChat ? "Quiero activar Consultas IA" : "Quiero probar el CRM"} <ArrowRight size={17}/></button>
      {request && <p role="status" style={{ marginTop: 16 }}>¡Gracias! Registramos tu interés en esta funcionalidad. Todavía no está disponible para activación real.</p>}
    </section>
  </main></>;
}
const card: React.CSSProperties = { padding: 22, border: "1px solid #e2e6e1", borderRadius: 18, background: "#fff", color: "#202c25" };
const heading: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, fontSize: 20, margin: "0 0 16px" };

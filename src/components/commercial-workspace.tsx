"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, BarChart3, Bell, Bot, CalendarDays, Check, CheckCircle2,
  ChevronRight, Clock3, Filter, Inbox, ListTodo, MessageCircle, MoreHorizontal,
  PauseCircle, PlayCircle, Plus, RotateCcw, Search, Send, Settings2, ShieldCheck,
  Sparkles, UserRound, UsersRound, WandSparkles, Zap
} from "lucide-react";
import { PanelNav } from "@/components/panel-shell";
import { cta } from "@/lib/interaction-tracking";
import { track } from "@/lib/analytics";
import {
  detectIntent, examples, formatMoney, initialLeads, initialTasks,
  propertyOf, properties, replyFor, seedMessages, stages,
  type Lead, type Message, type Stage, type Task
} from "@/lib/habita-commercial-sandbox";
import s from "./commercial-workspace.module.css";

type Product = "consultas_ia" | "crm_inteligente";
const log = (event: string, product: Product, extra: Record<string, string | number | boolean> = {}) =>
  track(event, { feature_key: product, demo_data: true, ...extra });

function FeatureHeader({ product, onRequest }: { product: Product; onRequest: () => void }) {
  const chat = product === "consultas_ia";
  return <header className={s.header}>
    <div>
      <Link className={s.back} href="/panel" {...cta("commercial_back_to_panel", "commercial_header", "panel", "navigation")}><ArrowLeft size={16}/> Volver a Inicio</Link>
      <div className={s.eyebrow}><span className={s.liveDot}/> HABITA / OPERACIÓN COMERCIAL</div>
      <h1>{chat ? "Consultas IA" : "CRM Inteligente"}</h1>
      <p>{chat ? "De la primera consulta a una visita, con cada conversación en contexto." : "Tu embudo, los interesados y la próxima mejor acción en un solo lugar."}</p>
    </div>
    <div className={s.headerActions}>
      <span className={s.examplePill}><ShieldCheck size={14}/> Entorno de demostración</span>
      <button className={s.primary} type="button" onClick={onRequest} {...cta("commercial_request_activation_header", "commercial_header", product)}><Zap size={16}/> Quiero usarlo <ArrowRight size={16}/></button>
    </div>
  </header>;
}
function Stat({ label, value, hint, icon: Icon }: { label: string; value: string | number; hint: string; icon: typeof BarChart3 }) {
  return <div className={s.stat}><div className={s.statTop}><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><small>{hint}</small></div>;
}
function MessageBubble({ message }: { message: Message }) {
  return <div className={message.from==="visitor" ? s.messageVisitor : message.from==="advisor" ? s.messageAdvisor : s.messageBot}>
    {message.from !== "visitor" && <span className={s.messageBy}>{message.from==="assistant" ? "Asistente Habita" : "Asesor"}</span>}
    <p>{message.body}</p><time>{message.time}</time>
  </div>;
}
function ActivationPanel({ product, onClose }: { product: Product; onClose: () => void }) {
  const [volume, setVolume] = useState("11-30");
  const [pain, setPain] = useState(product==="consultas_ia"?"responder_fuera_de_horario":"seguimiento");
  const [readiness, setReadiness] = useState("este_mes");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/panel/interes-comercial", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product, volumeBand: volume, primaryPain: pain, readiness }),
      });
      if (!res.ok) throw new Error("No pudimos guardar tu solicitud. Probá nuevamente.");
      log("commercial_activation_request_submitted",product,{volume_band:volume,primary_pain:pain,readiness});
      setDone(true);
    } catch {
      setError("No pudimos registrar tu solicitud. Revisá tu conexión e intentá nuevamente.");
      log("commercial_activation_request_failed",product);
    } finally { setBusy(false); }
  }
  return <div className={s.overlay} role="presentation" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose();}}>
    <section role="dialog" aria-modal="true" aria-label="Solicitar acceso a Habita" className={s.modal}>
      <button className={s.close} type="button" onClick={onClose} aria-label="Cerrar formulario">×</button>
      {!done ? <>
        <div className={s.modalIcon}><Zap size={22}/></div>
        <div className={s.eyebrow}>ACCESO A HABITA</div>
        <h2>¿Lo activarías en tu inmobiliaria?</h2>
        <p>Contanos cómo trabajás hoy. Nos ayuda a priorizar la implementación para quienes más lo necesitan.</p>
        <form onSubmit={submit}>
          <label>¿Cuántas consultas o leads gestionás por semana?
            <select value={volume} onChange={(e)=>setVolume(e.target.value)} {...cta("commercial_intent_volume", "activation_form", product)}>
              <option value="1-10">1 a 10</option><option value="11-30">11 a 30</option><option value="31-100">31 a 100</option><option value="100+">Más de 100</option>
            </select>
          </label>
          <label>¿Qué problema te gustaría resolver primero?
            <select value={pain} onChange={(e)=>setPain(e.target.value)} {...cta("commercial_intent_pain", "activation_form", product)}>
              <option value="responder_fuera_de_horario">Responder consultas fuera de horario</option>
              <option value="calificar_leads">Calificar interesados</option>
              <option value="agendar_visitas">Coordinar visitas</option>
              <option value="seguimiento">No perder seguimientos</option>
              <option value="priorizar_oportunidades">Saber a quién contactar primero</option>
              <option value="medir_conversion">Medir conversión del equipo</option>
            </select>
          </label>
          <label>¿Cuándo lo probarías con tus clientes?
            <select value={readiness} onChange={(e)=>setReadiness(e.target.value)} {...cta("commercial_intent_readiness", "activation_form", product)}>
              <option value="esta_semana">Esta semana</option>
              <option value="este_mes">Este mes</option>
              <option value="mas_adelante">Más adelante</option>
            </select>
          </label>
          <button className={s.primary} type="submit" disabled={busy} {...cta("commercial_activation_request_submit", "activation_form", product)}>{busy?"Registrando…":"Solicitar acceso"} <ArrowRight size={16}/></button>{error&&<p role="alert" className={s.formError}>{error}</p>}
        </form>
        <small>Esta solicitud registra interés; no activa mensajes ni conecta cuentas de WhatsApp.</small>
      </> : <div className={s.done}><CheckCircle2 size={36}/><h2>¡Solicitud registrada!</h2><p>Gracias. Tomamos nota del problema que querés resolver. Todavía no se activó ningún servicio ni se enviaron mensajes.</p><button type="button" className={s.secondary} onClick={onClose} {...cta("commercial_activation_close", "activation_confirmation", product)}>Seguir explorando</button></div>}
    </section>
  </div>;
}
const intentLabel: Record<string,string> = {availability:"Disponibilidad",price:"Precio",viewing:"Visita",financing:"Financiación",search:"Búsqueda",greeting:"Saludo",unknown:"Consulta"};

function ConsultasWorkspace() {
  const product: Product="consultas_ia";
  const [tab,setTab]=useState<"inbox"|"flows"|"analytics"|"settings">("inbox");
  const [leads,setLeads]=useState<Lead[]>(initialLeads);
  const [selected,setSelected]=useState("martina");
  const [messages,setMessages]=useState<Record<string,Message[]>>(seedMessages);
  const [query,setQuery]=useState("");
  const [reply,setReply]=useState("");
  const [search,setSearch]=useState("");
  const [auto,setAuto]=useState(true);
  const [handoff,setHandoff]=useState<string[]>([]);
  const [appointment,setAppointment]=useState<Record<string,string>>({});
  const [flowEnabled,setFlowEnabled]=useState<Record<string,boolean>>({welcome:true,qualification:true,booking:true,followup:false});
  const [request,setRequest]=useState(false);
  useEffect(()=>{log("commercial_workspace_viewed",product,{entry:"page"});},[]);
  const selectedLead=leads.find(l=>l.id===selected)??leads[0];
  const selectedMessages=messages[selected]??[];
  const filtered=leads.filter(l=>!search || (l.name+" "+propertyOf(l.propertyId).location).toLowerCase().includes(search.toLowerCase()));
  const totalUnread=leads.reduce((v,l)=>v+l.unread,0);
  const currentIntent=selectedMessages.slice().reverse().find(m=>m.from==="visitor");
  function choose(id:string) {setSelected(id);setLeads(ls=>ls.map(l=>l.id===id?{...l,unread:0}:l));log("commercial_conversation_opened",product,{source:leads.find(l=>l.id===id)?.source??"unknown"});}
  function simulateSend(value=reply) {
    const text=value.trim().slice(0,500);if(!text)return;
    const l=selectedLead;const result=replyFor(text,l);const stamp="Ahora";
    setMessages(m=>({...m,[selected]:[...(m[selected]??[]),{id:"v"+Date.now(),from:"visitor",body:text,time:stamp},...(auto&&!handoff.includes(selected)?[{id:"a"+Date.now(),from:"assistant" as const,body:result.text,time:stamp}]:[])]}));
    setLeads(ls=>ls.map(x=>x.id===selected?{...x,stage:result.suggestedStage,nextAction:result.action,lastReply:text,unread:0,activity:"Ahora"}:x));
    log("commercial_conversation_tested",product,{intent:result.intent,automated:auto&&!handoff.includes(selected)});
    setReply("");
  }
  function assignHuman() {setHandoff(xs=>xs.includes(selected)?xs.filter(x=>x!==selected):[...xs,selected]);log("commercial_handoff_toggled",product,{enabled:!handoff.includes(selected)});}
  function book(slot:string) {setAppointment(v=>({...v,[selected]:slot}));setLeads(ls=>ls.map(x=>x.id===selected?{...x,stage:"Visita",nextAction:"Confirmar visita con asesor"}:x));log("commercial_visit_requested",product,{slot_id:slot.replace(/\W+/g,"_")});}
  function chooseTab(next:typeof tab) {setTab(next);log("commercial_section_opened",product,{section:next});}
  return <><PanelNav section="consultas_ia"/><main className={"account-page container ap-page "+s.page}>
    <FeatureHeader product={product} onRequest={()=>{setRequest(true);log("commercial_activation_request_opened",product,{entry:"header"});}}/>
    <div className={s.stats}>
      <Stat label="Conversaciones" value={leads.length} hint="Contactos de ejemplo" icon={MessageCircle}/>
      <Stat label="Para responder" value={totalUnread} hint="Mensajes pendientes" icon={Bell}/>
      <Stat label="Calificados" value={leads.filter(l=>["Calificado","Visita","Negociación","Cerrado"].includes(l.stage)).length} hint="Interés identificado" icon={CheckCircle2}/>
      <Stat label="Visitas" value={leads.filter(l=>l.stage==="Visita").length} hint="En coordinación" icon={CalendarDays}/>
    </div>
    <div className={s.demoNotice}><ShieldCheck size={16}/><span>Explorá con datos de ejemplo. Las acciones funcionan en esta demostración, sin enviar WhatsApps ni modificar clientes reales.</span><button type="button" onClick={()=>{setLeads(initialLeads);setMessages(seedMessages);setAppointment({});setHandoff([]);log("commercial_example_reset",product);}} {...cta("commercial_chat_reset", "commercial_notice", product)}><RotateCcw size={14}/> Reiniciar</button></div>
    <nav className={s.tabs} aria-label="Secciones de consultas">
      {([{id:"inbox",label:"Bandeja",icon:Inbox},{id:"flows",label:"Flujos automáticos",icon:Zap},{id:"analytics",label:"Rendimiento",icon:BarChart3},{id:"settings",label:"Configuración",icon:Settings2}] as const).map(x=><button key={x.id} type="button" className={tab===x.id?s.tabActive:s.tab} onClick={()=>chooseTab(x.id)} {...cta("commercial_chat_tab_"+x.id,"commercial_tabs",x.id)}><x.icon size={17}/>{x.label}</button>)}
    </nav>
    {tab==="inbox"? <div className={s.inboxGrid}>
      <section className={s.contactList} aria-label="Conversaciones">
        <div className={s.boxHeading}><strong>Conversaciones</strong><span className={s.count}>{leads.length}</span></div>
        <label className={s.search}><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar interesados..." aria-label="Buscar conversaciones"/></label>
        <div className={s.contactScroll}>{filtered.map(l=><button type="button" key={l.id} onClick={()=>choose(l.id)} className={l.id===selected?s.contactActive:s.contact} {...cta("commercial_chat_open_lead","commercial_inbox","conversation","content")}>
          <span className={s.avatar}>{l.initials}</span><span className={s.contactMain}><span className={s.contactTop}><strong>{l.name}</strong><small>{l.activity}</small></span><span className={s.contactPreview}>{l.lastReply}</span><span className={s.contactMeta}><span>{l.source}</span><span>·</span><span>{l.stage}</span></span></span>{l.unread>0&&<span className={s.unread}>{l.unread}</span>}
        </button>)}</div>
      </section>
      <section className={s.conversation}>
        <div className={s.conversationHeader}><span className={s.avatar}>{selectedLead.initials}</span><div><strong>{selectedLead.name}</strong><small>{propertyOf(selectedLead.propertyId).title}</small></div><span className={s.statusChip}>{handoff.includes(selected)?"Con asesor":auto?"Respuesta automática":"Pausado"}</span></div>
        <div className={s.thread} aria-live="polite">
          <span className={s.threadDate}>CONVERSACIÓN · EJEMPLO</span>
          {selectedMessages.map(m=><MessageBubble key={m.id} message={m}/>)}
        </div>
        <div className={s.composer}>
          <div className={s.promptTitle}><WandSparkles size={15}/> Probá una consulta como si fueras un cliente</div>
          <form onSubmit={e=>{e.preventDefault();simulateSend();}} className={s.composeLine}><input value={reply} onChange={e=>setReply(e.target.value)} maxLength={500} placeholder="Escribí: ¿Podemos visitarlo mañana?" aria-label="Consulta para simular"/><button type="submit" aria-label="Enviar consulta de prueba" disabled={!reply.trim()} {...cta("commercial_chat_send_test","commercial_chat_composer","conversation")}><Send size={19}/></button></form>
          <div className={s.quickPrompts}>{examples.slice(0,3).map((x,i)=><button type="button" key={x} onClick={()=>simulateSend(x)} {...cta("commercial_chat_prompt_"+i,"commercial_chat_composer","conversation")}>{x}</button>)}</div>
        </div>
      </section>
      <aside className={s.inspector} aria-label="Ficha de consulta">
        <div className={s.boxHeading}><strong>Contexto del interesado</strong><Sparkles size={18}/></div>
        <div className={s.scoreBlock}><span>Prioridad comercial</span><strong>{selectedLead.score}<small>/100</small></strong><div className={s.progress}><i style={{width:selectedLead.score+"%"}}/></div><small>Estimación ilustrativa con datos de ejemplo.</small></div>
        <dl className={s.details}><dt>Etapa</dt><dd>{selectedLead.stage}</dd><dt>Presupuesto</dt><dd>{selectedLead.budget?formatMoney(selectedLead.budget):"Por confirmar"}</dd><dt>Objetivo</dt><dd>{selectedLead.purpose}</dd><dt>Plazo</dt><dd>{selectedLead.timing}</dd><dt>Última intención</dt><dd>{intentLabel[detectIntent(currentIntent?.body??"")]}</dd></dl>
        <div className={s.inspectorSection}><strong>Siguiente paso recomendado</strong><p>{selectedLead.nextAction}</p><button className={s.secondary} type="button" onClick={assignHuman} {...cta("commercial_chat_handoff","commercial_inspector","handoff")}>{handoff.includes(selected)?"Volver a respuesta automática":"Pasar a un asesor"}<ChevronRight size={15}/></button></div>
        <div className={s.inspectorSection}><strong><CalendarDays size={16}/> Coordinar visita</strong><div className={s.slotButtons}>{["Mañana 11:00","Mañana 16:00","Viernes 10:00"].map(slot=><button key={slot} type="button" onClick={()=>book(slot)} className={appointment[selected]===slot?s.slotActive:s.slot} {...cta("commercial_chat_visit_slot","commercial_inspector","visit_request")}>{slot}</button>)}</div>{appointment[selected]&&<p className={s.success}><CheckCircle2 size={15}/> Solicitud de {appointment[selected]} anotada en el ejemplo.</p>}</div>
      </aside>
    </div> : tab==="flows"? <section className={s.card}>
      <div className={s.sectionIntro}><div><div className={s.eyebrow}>AUTOMATIZACIÓN</div><h2>Flujos que mantienen viva cada oportunidad</h2><p>Configurá cuándo interviene el asistente y cuándo pasa la conversación a tu equipo.</p></div><span className={s.examplePill}>Configuración de ejemplo</span></div>
      <div className={s.ruleGrid}>{[
        {id:"welcome",title:"Respuesta inicial 24/7",description:"Primer contacto cuando alguien pregunta por una propiedad.",icon:MessageCircle,steps:["Detecta nueva consulta","Verifica propiedad","Responde con contexto"]},
        {id:"qualification",title:"Calificación inteligente",description:"Identifica zona, presupuesto, uso y urgencia.",icon:Filter,steps:["Pregunta intención","Completa datos faltantes","Prioriza al interesado"]},
        {id:"booking",title:"Coordinación de visitas",description:"Solicita horarios y deja una tarea al asesor.",icon:CalendarDays,steps:["Sugiere horarios","Prepara reserva","Pide confirmación humana"]},
        {id:"followup",title:"Seguimiento de interesados",description:"Secuencia con pausa cuando el prospecto responde.",icon:Clock3,steps:["Espera respuesta","Recuerda seguimiento","Se pausa al responder"]}
      ].map(x=><article className={s.ruleCard} key={x.id}><div className={s.ruleTop}><span className={s.ruleIcon}><x.icon size={21}/></span><label className={s.switchLabel}><input type="checkbox" checked={flowEnabled[x.id]} onChange={e=>{setFlowEnabled(v=>({...v,[x.id]:e.target.checked}));log("commercial_rule_toggled",product,{rule_id:x.id,enabled:e.target.checked});}} {...cta("commercial_chat_rule_"+x.id,"commercial_rules","toggle")}/>{flowEnabled[x.id]?"Activado":"Pausado"}</label></div><h3>{x.title}</h3><p>{x.description}</p><div className={s.ruleSteps}>{x.steps.map((step,i)=><div key={step}><span>{i+1}</span>{step}</div>)}</div></article>)}</div>
    </section> : tab==="analytics"? <section className={s.card}><div className={s.sectionIntro}><div><div className={s.eyebrow}>RENDIMIENTO</div><h2>Del mensaje a la visita</h2><p>Etapas calculadas sobre las conversaciones de ejemplo de esta pantalla.</p></div></div><div className={s.funnel}>{[{name:"Consultas recibidas",n:leads.length},{name:"En calificación o más",n:leads.filter(l=>l.stage!=="Nuevo").length},{name:"Calificados",n:leads.filter(l=>["Calificado","Visita","Negociación","Cerrado"].includes(l.stage)).length},{name:"Visitas y negociación",n:leads.filter(l=>["Visita","Negociación","Cerrado"].includes(l.stage)).length}].map(x=><div key={x.name}><span>{x.name}</span><div><i style={{width:((x.n/leads.length)*100)+"%"}}/></div><strong>{x.n}</strong></div>)}</div><p className={s.footnote}>Este embudo describe exclusivamente el conjunto de ejemplo; no representa resultados de tu inmobiliaria.</p></section> : <section className={s.card}><div className={s.sectionIntro}><div><div className={s.eyebrow}>ASISTENTE</div><h2>Controlá la experiencia de respuesta</h2><p>La conexión real de WhatsApp requiere una configuración y autorización separadas.</p></div></div><div className={s.setting}><div><strong>Respuestas del asistente</strong><p>Probá la diferencia entre respuesta automática y revisión humana.</p></div><label className={s.switchLabel}><input type="checkbox" checked={auto} onChange={e=>{setAuto(e.target.checked);log("commercial_auto_reply_toggled",product,{enabled:e.target.checked});}} {...cta("commercial_chat_auto_reply","commercial_settings","toggle")}/>{auto?"Habilitadas":"Pausadas"}</label></div><div className={s.setting}><div><strong>Regla de seguridad</strong><p>No confirmar financiación, disponibilidad en tiempo real ni visitas sin validación humana.</p></div><ShieldCheck size={21}/></div><div className={s.setting}><div><strong>Canales</strong><p>WhatsApp, sitio web y portales podrán conectarse cuando exista una integración autorizada.</p></div><span className={s.statusChip}>Sin conexión</span></div></section>}
    <section className={s.bottomCta}><div><span className={s.eyebrow}>PARA TU INMOBILIARIA</span><h2>¿Cuántas consultas estás dejando sin responder?</h2><p>Contanos dónde se pierde tiempo en tu operación y qué te gustaría automatizar.</p></div><button type="button" className={s.primary} onClick={()=>{setRequest(true);log("commercial_activation_request_opened",product,{entry:"footer"});}} {...cta("commercial_request_activation_footer","commercial_footer",product)}>Quiero activarlo <ArrowRight size={17}/></button></section>
  </main>{request&&<ActivationPanel product={product} onClose={()=>setRequest(false)}/>}</>;
}

function CrmWorkspace() {
  const product: Product="crm_inteligente";
  const [leads,setLeads]=useState<Lead[]>(initialLeads);
  const [tasks,setTasks]=useState<Task[]>(initialTasks);
  const [selected,setSelected]=useState("martina");
  const [tab,setTab]=useState<"pipeline"|"tasks"|"automations"|"reports">("pipeline");
  const [q,setQ]=useState("");
  const [stageFilter,setStageFilter]=useState<Stage|"Todos">("Todos");
  const [request,setRequest]=useState(false);
  const [draft,setDraft]=useState("");
  const [note,setNote]=useState("");
  const [auto,setAuto]=useState<Record<string,boolean>>({instant:true,followup:true,reengage:false});
  useEffect(()=>{log("commercial_workspace_viewed",product,{entry:"page"});},[]);
  const current=leads.find(l=>l.id===selected)??leads[0];
  const filtered=leads.filter(l=>(stageFilter==="Todos"||l.stage===stageFilter)&&(!q||(l.name+" "+l.purpose+" "+propertyOf(l.propertyId).title).toLowerCase().includes(q.toLowerCase())));
  const openTasks=tasks.filter(t=>!t.done);
  function openLead(id:string){setSelected(id);setDraft("");setNote("");log("commercial_lead_opened",product,{stage:leads.find(l=>l.id===id)?.stage??"unknown"});}
  function changeStage(stage:Stage){setLeads(xs=>xs.map(x=>x.id===selected?{...x,stage,nextAction:stage==="Visita"?"Confirmar visita":stage==="Cerrado"?"Sin acción pendiente":x.nextAction}:x));log("commercial_lead_stage_changed",product,{from_stage:current.stage,to_stage:stage});}
  function addTask(){const item:Task={id:"new"+Date.now(),leadId:selected,title:"Contactar a "+current.name,due:"Hoy",done:false};setTasks(ts=>[item,...ts]);log("commercial_task_created",product,{source:"lead_detail"});}
  function markTask(id:string){setTasks(ts=>ts.map(t=>t.id===id?{...t,done:!t.done}:t));log("commercial_task_toggled",product,{is_done:!tasks.find(t=>t.id===id)?.done});}
  function makeDraft(){setDraft("Hola, "+current.name.split(" ")[0]+". Soy del equipo de la inmobiliaria. Te escribo por "+propertyOf(current.propertyId).title+". ¿Te gustaría que coordinemos el próximo paso?");log("commercial_followup_drafted",product,{stage:current.stage});}
  function saveNote(){if(!note.trim())return;setLeads(xs=>xs.map(x=>x.id===selected?{...x,note:note.slice(0,300)}:x));setNote("");log("commercial_note_added",product);}
  function chooseTab(x:typeof tab){setTab(x);log("commercial_section_opened",product,{section:x});}
  return <><PanelNav section="crm_inteligente"/><main className={"account-page container ap-page "+s.page}>
    <FeatureHeader product={product} onRequest={()=>{setRequest(true);log("commercial_activation_request_opened",product,{entry:"header"});}}/>
    <div className={s.stats}>
      <Stat label="Oportunidades" value={leads.length} hint="Contactos de ejemplo" icon={UsersRound}/>
      <Stat label="Prioridad alta" value={leads.filter(l=>l.score>=85&&l.stage!=="Cerrado").length} hint="Score ≥ 85" icon={Sparkles}/>
      <Stat label="Tareas pendientes" value={openTasks.length} hint="Próximas acciones" icon={ListTodo}/>
      <Stat label="En negociación" value={leads.filter(l=>l.stage==="Negociación").length} hint="Oportunidades activas" icon={BarChart3}/>
    </div>
    <div className={s.demoNotice}><ShieldCheck size={16}/><span>Trabajá con contactos de ejemplo. El avance de etapas, las notas y las tareas se prueban acá, sin cambiar tus datos reales.</span><button type="button" onClick={()=>{setLeads(initialLeads);setTasks(initialTasks);setDraft("");log("commercial_example_reset",product);}} {...cta("commercial_crm_reset","commercial_notice",product)}><RotateCcw size={14}/> Reiniciar</button></div>
    <nav className={s.tabs} aria-label="Secciones del CRM">{([{id:"pipeline",label:"Embudo comercial",icon:BarChart3},{id:"tasks",label:"Mis tareas",icon:ListTodo},{id:"automations",label:"Automatizaciones",icon:Zap},{id:"reports",label:"Resultados",icon:BarChart3}] as const).map(x=><button key={x.id} type="button" className={tab===x.id?s.tabActive:s.tab} onClick={()=>chooseTab(x.id)} {...cta("commercial_crm_tab_"+x.id,"commercial_tabs",x.id)}><x.icon size={17}/>{x.label}</button>)}</nav>
    {tab==="pipeline"? <div className={s.crmGrid}>
      <section className={s.pipeline}>
        <div className={s.pipelineHead}><div><strong>Pipeline de oportunidades</strong><span>{filtered.length} interesados</span></div><label className={s.search}><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} aria-label="Buscar leads" placeholder="Buscar..." /></label></div>
        <div className={s.filterPills}>{(["Todos",...stages] as const).map(f=><button type="button" key={f} className={stageFilter===f?s.filterActive:s.filter} onClick={()=>{setStageFilter(f);log("commercial_crm_filter_changed",product,{stage:f});}} {...cta("commercial_crm_stage_filter","commercial_pipeline","stage_filter")}>{f}</button>)}</div>
        <div className={s.kanban}>
          {stages.map(stage=>{const items=filtered.filter(l=>l.stage===stage);return <div className={s.column} key={stage}><div className={s.columnHead}><strong>{stage}</strong><span>{items.length}</span></div>{items.map(l=><button type="button" key={l.id} className={selected===l.id?s.leadActive:s.leadCard} onClick={()=>openLead(l.id)} {...cta("commercial_crm_open_lead","commercial_pipeline","lead_detail","content")}><div className={s.leadTop}><span className={s.miniAvatar}>{l.initials}</span><strong>{l.name}</strong><span className={s.leadScore}>{l.score}</span></div><p>{propertyOf(l.propertyId).title}</p><div className={s.leadBottom}><span>{l.source}</span><span><Clock3 size={12}/>{l.activity}</span></div></button>)}{items.length===0&&<div className={s.emptyStage}>Sin interesados</div>}</div>})}
        </div>
      </section>
      <aside className={s.crmDetail}>
        <div className={s.boxHeading}><strong>Ficha del interesado</strong><UserRound size={18}/></div>
        <div className={s.profileHead}><span className={s.avatarLarge}>{current.initials}</span><div><h2>{current.name}</h2><p>{current.source} · {current.advisor}</p></div></div>
        <div className={s.scoreBlock}><span>Prioridad estimada</span><strong>{current.score}<small>/100</small></strong><div className={s.progress}><i style={{width:current.score+"%"}}/></div><small>{current.score>=85?"Alta intención y señales comerciales positivas.":current.score>=65?"Interés activo: todavía faltan datos.":"Interés por verificar antes de priorizar."} Score ilustrativo.</small></div>
        <label className={s.field}>Etapa comercial
          <select value={current.stage} onChange={e=>changeStage(e.target.value as Stage)} {...cta("commercial_crm_change_stage","commercial_lead_detail","stage_change")}>{stages.map(st=><option key={st}>{st}</option>)}</select>
        </label>
        <dl className={s.details}><dt>Propiedad</dt><dd>{propertyOf(current.propertyId).title}</dd><dt>Presupuesto</dt><dd>{current.budget?formatMoney(current.budget):"Sin definir"}</dd><dt>Intención</dt><dd>{current.purpose}</dd><dt>Plazo</dt><dd>{current.timing}</dd></dl>
        <div className={s.inspectorSection}><strong><Sparkles size={16}/> Próxima acción sugerida</strong><p>{current.nextAction}</p><div className={s.stackButtons}><button className={s.primary} type="button" onClick={makeDraft} {...cta("commercial_crm_draft_followup","commercial_lead_detail","followup")}>Preparar seguimiento <ArrowRight size={16}/></button><button className={s.secondary} type="button" onClick={addTask} {...cta("commercial_crm_create_task","commercial_lead_detail","task_create")}><Plus size={16}/> Crear tarea</button></div>{draft&&<div className={s.draft}><small>Mensaje sugerido · no enviado</small><p>{draft}</p><button type="button" onClick={()=>{void navigator.clipboard?.writeText(draft).catch(()=>undefined);log("commercial_followup_copied",product);}} {...cta("commercial_crm_copy_draft","commercial_lead_detail","followup_copy")}>Copiar texto</button></div>}</div>
        <div className={s.inspectorSection}><strong>Notas de la relación</strong><p>{current.note||"Todavía no hay notas para este contacto."}</p><textarea rows={2} maxLength={300} placeholder="Agregá una nota al ejemplo..." value={note} onChange={e=>setNote(e.target.value)}/><button type="button" className={s.secondary} onClick={saveNote} disabled={!note.trim()} {...cta("commercial_crm_save_note","commercial_lead_detail","note_save")}>Guardar nota</button></div>
      </aside>
    </div> : tab==="tasks"? <section className={s.card}><div className={s.sectionIntro}><div><div className={s.eyebrow}>GESTIÓN DEL DÍA</div><h2>Próximas tareas</h2><p>Ejecutá o completá acciones sin perder el contexto de cada contacto.</p></div></div><div className={s.taskList}>{tasks.map(t=><div className={s.taskRow} key={t.id}><button type="button" className={t.done?s.taskDone:s.taskCheck} onClick={()=>markTask(t.id)} aria-label={t.done?"Reabrir tarea":"Completar tarea"} {...cta("commercial_crm_task_complete","commercial_tasks","task_toggle")}>{t.done?<Check size={16}/>:null}</button><div><strong className={t.done?s.struck:""}>{t.title}</strong><p>{leads.find(l=>l.id===t.leadId)?.name} · {t.due}</p></div><button className={s.iconButton} type="button" onClick={()=>{openLead(t.leadId);chooseTab("pipeline");}} {...cta("commercial_crm_task_open_lead","commercial_tasks","lead_detail")}><ChevronRight size={19}/></button></div>)}</div></section> : tab==="automations"? <section className={s.card}><div className={s.sectionIntro}><div><div className={s.eyebrow}>SMART WORKFLOWS</div><h2>Seguimientos que no se olvidan</h2><p>Reglas inspiradas en CRM inmobiliarios especializados: activación por comportamiento, tareas y pausa al recibir respuesta.</p></div></div><div className={s.ruleGrid}>{[{id:"instant",name:"Nuevo lead → respuesta inicial",desc:"Califica la consulta y prepara la ficha comercial.",steps:["Ingreso","Calificación","Asignación"]},{id:"followup",name:"Interesado sin respuesta",desc:"Recomienda seguimiento después de un período sin actividad.",steps:["Sin respuesta","Nueva tarea","Pausa si responde"]},{id:"reengage",name:"Reactivación de interesados",desc:"Identifica contactos antiguos con señales de interés.",steps:["Contacto inactivo","Segmentación","Revisión humana"]}].map(rule=><article className={s.ruleCard} key={rule.id}><div className={s.ruleTop}><span className={s.ruleIcon}><Zap size={21}/></span><label className={s.switchLabel}><input type="checkbox" checked={auto[rule.id]} onChange={e=>{setAuto(v=>({...v,[rule.id]:e.target.checked}));log("commercial_rule_toggled",product,{rule_id:rule.id,enabled:e.target.checked});}} {...cta("commercial_crm_rule_"+rule.id,"commercial_automations","toggle")}/>{auto[rule.id]?"Activada":"Pausada"}</label></div><h3>{rule.name}</h3><p>{rule.desc}</p><div className={s.ruleSteps}>{rule.steps.map((t,i)=><div key={t}><span>{i+1}</span>{t}</div>)}</div></article>)}</div></section> : <section className={s.card}><div className={s.sectionIntro}><div><div className={s.eyebrow}>RESULTADOS COMERCIALES</div><h2>Visibilidad de punta a punta</h2><p>Distribución de los contactos del ejemplo, actualizada cuando movés un lead de etapa.</p></div></div><div className={s.funnel}>{stages.map(stage=>({name:stage,n:leads.filter(l=>stages.indexOf(l.stage)>=stages.indexOf(stage)).length})).map(x=><div key={x.name}><span>{x.name}</span><div><i style={{width:x.n/leads.length*100+"%"}}/></div><strong>{x.n}</strong></div>)}</div><p className={s.footnote}>Estos números son ejemplos generados para explorar la experiencia. No representan conversiones reales.</p></section>}
    <section className={s.bottomCta}><div><span className={s.eyebrow}>HACÉ CRECER TU OPERACIÓN</span><h2>Tu cartera de interesados merece un seguimiento real.</h2><p>Contanos cuál es el cuello de botella de tu inmobiliaria y ayudanos a priorizarlo.</p></div><button type="button" className={s.primary} onClick={()=>{setRequest(true);log("commercial_activation_request_opened",product,{entry:"footer"});}} {...cta("commercial_request_activation_footer","commercial_footer",product)}>Quiero usar el CRM <ArrowRight size={17}/></button></section>
  </main>{request&&<ActivationPanel product={product} onClose={()=>setRequest(false)}/>}</>;
}
export function CommercialWorkspace({ product }: { product: Product }) { return product==="consultas_ia"?<ConsultasWorkspace/>:<CrmWorkspace/>; }

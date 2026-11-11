/**
 * Isolated commercial workspace examples. Never write these contacts or messages
 * to production tables: the real WhatsApp/CRM integration is deliberately absent.
 * Keep user text out of PostHog (only typed enums and counts are reported).
 */
export type Stage = "Nuevo" | "Calificando" | "Calificado" | "Visita" | "Negociación" | "Cerrado";
export type LeadSource = "WhatsApp" | "Web" | "Portal";
export type Lead = {
  id: string; name: string; initials: string; stage: Stage; source: LeadSource;
  score: number; propertyId: string; budget: number | null; purpose: string;
  timing: string; activity: string; advisor: string; lastReply: string;
  tags: string[]; note: string; nextAction: string; unread: number;
};
export type Message = { id: string; from: "visitor" | "assistant" | "advisor"; body: string; time: string };
export type Task = { id: string; leadId: string; title: string; due: string; done: boolean };
export const stages: Stage[] = ["Nuevo", "Calificando", "Calificado", "Visita", "Negociación", "Cerrado"];
export const properties = [
  { id: "guemes", title: "Departamento luminoso en Güemes", location: "Güemes · Mar del Plata", rooms: 2, size: 58, price: 95000, kind: "Venta", image: "/ejemplos/living-scandinavian.webp" },
  { id: "centro", title: "Departamento reciclado en el Centro", location: "Centro · Mar del Plata", rooms: 2, size: 49, price: 78000, kind: "Venta", image: "/ejemplos/living-modern.webp" },
  { id: "playa", title: "Departamento en Playa Grande", location: "Playa Grande · Mar del Plata", rooms: 3, size: 86, price: 145000, kind: "Venta", image: "/ejemplos/living-before.webp" },
] as const;
export const initialLeads: Lead[] = [
  { id:"martina", name:"Martina G.", initials:"MG", stage:"Calificado", source:"WhatsApp", score:92, propertyId:"guemes", budget:100000, purpose:"Vivienda propia", timing:"Este mes", activity:"Hace 4 min", advisor:"Equipo comercial", lastReply:"¿Lo podemos ver mañana a la tarde?", tags:["Visita solicitada","Presupuesto confirmado"],note:"Busca mudarse antes de fin de año.",nextAction:"Confirmar disponibilidad para visita",unread:1 },
  { id:"lucas", name:"Lucas R.", initials:"LR", stage:"Calificando", source:"Web", score:76, propertyId:"playa", budget:150000, purpose:"Inversión", timing:"1–3 meses", activity:"Hace 17 min", advisor:"Equipo comercial", lastReply:"¿Aceptan financiación?", tags:["Financiación","Interés activo"],note:"Necesita información adicional sobre financiación.",nextAction:"Responder condiciones de financiación",unread:1 },
  { id:"sofia", name:"Sofía M.", initials:"SM", stage:"Nuevo", source:"Portal", score:46, propertyId:"centro", budget:null, purpose:"Por definir", timing:"Sin definir", activity:"Hace 1 h", advisor:"Sin asignar", lastReply:"Hola, ¿sigue disponible?", tags:["Consulta nueva"],note:"",nextAction:"Calificar presupuesto y plazo",unread:1 },
  { id:"diego", name:"Diego A.", initials:"DA", stage:"Visita", source:"WhatsApp", score:88, propertyId:"guemes", budget:110000, purpose:"Vivienda propia", timing:"Este mes", activity:"Ayer", advisor:"Equipo comercial", lastReply:"Confirmo para el viernes.", tags:["Visita coordinada"],note:"Llevar plano y expensas.",nextAction:"Preparar visita",unread:0 },
  { id:"valeria", name:"Valeria P.", initials:"VP", stage:"Negociación", source:"Web", score:95, propertyId:"centro", budget:82000, purpose:"Inversión", timing:"Inmediato", activity:"Ayer", advisor:"Equipo comercial", lastReply:"Podría hacer una oferta.", tags:["Oferta"],note:"Solicitó documentación de la propiedad.",nextAction:"Consultar condiciones de oferta",unread:0 },
  { id:"ramiro", name:"Ramiro L.", initials:"RL", stage:"Cerrado", source:"Portal", score:100, propertyId:"guemes", budget:97000, purpose:"Vivienda propia", timing:"Finalizado", activity:"La semana pasada", advisor:"Equipo comercial", lastReply:"Muchas gracias.", tags:["Operación cerrada"],note:"Caso de ejemplo.",nextAction:"Sin acción pendiente",unread:0 },
];
export const initialTasks: Task[] = [
  { id:"t1",leadId:"martina",title:"Confirmar horario de visita",due:"Hoy",done:false },
  { id:"t2",leadId:"lucas",title:"Verificar condiciones de financiación",due:"Hoy",done:false },
  { id:"t3",leadId:"sofia",title:"Preguntar presupuesto y zona",due:"Mañana",done:false },
  { id:"t4",leadId:"diego",title:"Preparar documentación para la visita",due:"Viernes",done:false },
];
export const seedMessages: Record<string, Message[]> = {
  martina:[
    {id:"m1",from:"visitor",body:"¡Hola! Vi el departamento de Güemes, ¿sigue disponible?",time:"10:12"},
    {id:"m2",from:"assistant",body:"¡Hola! Sí, figura disponible en nuestro catálogo. Es un 2 ambientes de 58 m² publicado en USD 95.000. ¿Lo buscás para vivir o invertir?",time:"10:12"},
    {id:"m3",from:"visitor",body:"Para vivir. Tengo hasta USD 100.000.",time:"10:15"},
    {id:"m4",from:"assistant",body:"Perfecto, está dentro de tu presupuesto. ¿En qué plazo te gustaría mudarte?",time:"10:15"},
    {id:"m5",from:"visitor",body:"Este mes. ¿Lo podemos ver mañana a la tarde?",time:"10:19"}
  ],
  lucas:[{id:"l1",from:"visitor",body:"Estoy buscando 3 ambientes en Playa Grande.",time:"09:42"},{id:"l2",from:"assistant",body:"Tenemos uno de 86 m² publicado a USD 145.000. ¿Lo buscás para vivir o invertir?",time:"09:43"},{id:"l3",from:"visitor",body:"Para invertir, ¿aceptan financiación?",time:"09:46"}],
  sofia:[{id:"s1",from:"visitor",body:"Hola, ¿sigue disponible el departamento del Centro?",time:"09:10"}],
  diego:[{id:"d1",from:"assistant",body:"La visita queda pendiente de confirmación por el equipo para el viernes.",time:"Ayer"},{id:"d2",from:"visitor",body:"Confirmo para el viernes.",time:"Ayer"}],
  valeria:[{id:"v1",from:"visitor",body:"Podría hacer una oferta por el departamento del Centro.",time:"Ayer"}],
  ramiro:[{id:"r1",from:"visitor",body:"Muchas gracias.",time:"La semana pasada"}]
};
export const examples = [
  "¿Sigue disponible el de Güemes?",
  "Busco 2 ambientes hasta USD 100.000",
  "¿Podría visitarlo mañana?",
  "¿Ofrecen financiación?",
];
export type Intent = "availability" | "price" | "viewing" | "financing" | "search" | "greeting" | "unknown";
export function detectIntent(input: string): Intent {
  const t = input.toLowerCase();
  if (/visita|visitar|conocer|recorrer|turno|verlo|pasar a ver|mañana|horario/.test(t)) return "viewing";
  if (/financia|hipoteca|pr[eé]stamo|cuota|cr[eé]dito/.test(t)) return "financing";
  if (/precio|cu[aá]nto|valor|costo/.test(t)) return "price";
  if (/disponible|sigue|reservado|vendido/.test(t)) return "availability";
  if (/busco|ambientes|presupuesto|zona|hasta|d[oó]lares|usd|u\$s/.test(t)) return "search";
  if (/hola|buenas|buen d[ií]a/.test(t)) return "greeting";
  return "unknown";
}
export function propertyOf(id: string) { return properties.find(p=>p.id===id) ?? properties[0]; }
function budgetOf(input: string) {
  const t = input.replace(/\./g,"");
  const hit = t.match(/(?:usd|u\$s|d[oó]lares?|hasta)\s*([\d,]+)/i) ?? t.match(/([\d,]+)\s*(?:usd|u\$s)/i);
  if(!hit) return null;
  const n = Number(hit[1].replace(",",""));
  return Number.isFinite(n) && n > 30000 && n < 3000000 ? n : null;
}
export function replyFor(input: string, lead: Lead): { text: string; intent: Intent; suggestedStage: Stage; action: string } {
  const intent = detectIntent(input);
  const p = propertyOf(lead.propertyId);
  const zoneMatch = properties.find(x=>input.toLowerCase().includes(x.location.split(" · ")[0].toLowerCase()));
  const relevant = zoneMatch ?? p;
  if(intent==="viewing") return {text:"¡Genial! Podemos avanzar con una visita. ¿Preferís mañana por la mañana o por la tarde? El asesor confirmará el horario y la disponibilidad antes de reservar.",intent,suggestedStage:"Visita",action:"Confirmar horario con un asesor"};
  if(intent==="financing") return {text:"Gracias por consultar. No tengo información verificada sobre financiación para esta propiedad. Voy a dejar tu consulta lista para que la responda el equipo. ¿La buscás para vivir o invertir?",intent,suggestedStage:"Calificando",action:"Consultar financiación con el equipo"};
  if(intent==="price") return {text:"El precio publicado de "+relevant.title+" es USD "+relevant.price.toLocaleString("es-AR")+". Las condiciones finales deben confirmarse con el asesor. ¿Querés coordinar una visita?",intent,suggestedStage:"Calificando",action:"Proponer una visita"};
  if(intent==="availability") return {text:"En nuestro catálogo de ejemplo, "+relevant.title+" figura disponible. El equipo debe confirmar su estado antes de concretar una visita. ¿Qué día te serviría?",intent,suggestedStage:"Calificando",action:"Validar disponibilidad"};
  if(intent==="search") {
    const budget=budgetOf(input);
    const rooms=/3\s*amb/.test(input)?3:/2\s*amb/.test(input)?2:null;
    const matches=properties.filter(x=>(!budget||x.price<=budget)&&(!rooms||x.rooms===rooms));
    const options=matches.length?matches.map(x=>x.title+" (USD "+x.price.toLocaleString("es-AR")+")").join("; "):"ninguna propiedad con esos filtros";
    return {text:"En el catálogo de ejemplo encontré "+options+". ¿La buscás para vivir o como inversión? Así te recomiendo mejor.",intent,suggestedStage:"Calificando",action:"Completar calificación"};
  }
  return {text:intent==="greeting"?"¡Hola! Soy el asistente de Habita. ¿Qué tipo de propiedad estás buscando y en qué zona?":"Puedo ayudarte a buscar propiedades del catálogo, consultar precios publicados o coordinar una visita. ¿Qué necesitás?",intent,suggestedStage:lead.stage,action:"Continuar conversación"};
}
export const formatMoney=(n:number)=>"USD "+n.toLocaleString("es-AR");

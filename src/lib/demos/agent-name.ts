// The agent's name as a listing shows it, or nothing: contact buttons and
// links ("Contáctenos", "Enviar consulta", "WhatsApp") are often the heading
// of the contact block, and they are not a person's name.

/** Words of contact buttons and links; a "name" made only of them is not a name. */
const CTA_WORDS = new Set(
  (
    "contacto contactos contactenos contactanos contactame contactate contactar contactarnos contactese contactarse " +
    "consulta consultas consultar consultanos consultenos consulte consultame " +
    "escribinos escribenos escribanos escribime escribir escribi escriba escribe " +
    "enviar envia envianos envie enviame envio " +
    "llamar llamanos llamenos llamame llame llama llamada " +
    "whatsapp whats wsp wpp wa app telefono telefonos tel cel celular movil mail email e-mail correo " +
    "chat chatear chatea chatee mensaje mensajes hablar hablemos hable " +
    "info informacion informes mas pedir pedi solicitar solicita solicite agendar agenda visita visitas coordinar " +
    "ver mostrar click clic aqui aca ahora ya hace haz " +
    "anunciante agente agentes asesor asesora asesores vendedor vendedora corredor inmobiliaria responsable " +
    "formulario datos interesado interesada me interesa esta propiedad " +
    "por al a la el los las de del con un una nos me te le su sus y o para en"
  ).split(" "),
);

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Whether a text read as the agent's name is a contact button or link
 * ("Contáctenos", "Enviar consulta", "Consultar por WhatsApp", "Llamar")
 * rather than a person's name.
 */
export function isGenericAgentName(name: string | null | undefined) {
  const words = norm(name ?? "")
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
  // Phone numbers and e-mails are contacts, not names either.
  if (!words.length || words.every((w) => /^[\d-]+$/.test(w))) return true;
  if (/@/.test(name ?? "")) return true;
  return words.every((w) => CTA_WORDS.has(w));
}

/** The agent's name, or null when what was read is not a person's name. */
export const agentName = (name: string | null | undefined) => {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  return clean && !isGenericAgentName(clean) ? clean : null;
};

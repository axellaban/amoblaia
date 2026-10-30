// Miguel Ángel, the assistant of habita.: a chat at hand in the agency's panel and in
// its demo ("modo demostración"). Client-safe and pure: the persona, the
// limits of a conversation and the validation of what the browser sends.

/** Its name and title: a nod to the Renaissance masters. */
export const ASSISTANT_NAME = "Miguel Ángel";
export const ASSISTANT_TITLE = "Tu genio del diseño";

/** How much of the conversation travels on each question. */
export const MAX_MESSAGES = 16;
export const MAX_MESSAGE_CHARS = 1500;
export const MAX_TOTAL_CHARS = 12000;

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** Where the chat is open: the panel (a signed-in account) or an agency's demo (its private link). */
export type AssistantPlace = { kind: "panel" } | { kind: "demo"; token: string; code: string };

/** conversation: the browser's id for this chat, so the team sees it as one conversation. */
export type AssistantInput = { messages: ChatMessage[]; place: AssistantPlace; path: string; conversation: string | null };

export class AssistantInputError extends Error {}

const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;
const CODE = /^[A-Za-z0-9_-]{20,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page the question comes from, without query or invitation code: only for context. */
export function cleanPath(path: unknown) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return "/";
  // The agency's invitation code may sit in the path (/demo/<token>/presentacion/<codigo>).
  return path
    .split(/[?#]/)[0]
    .replace(/(\/presentacion\/)[^/]+/, "$1[oculto]")
    .slice(0, 160);
}

/** What the browser sends, checked: a short conversation that ends with the user's question. */
export function assistantInput(body: unknown): AssistantInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = b.messages;
  if (!Array.isArray(raw) || raw.length === 0) throw new AssistantInputError("Escribí tu consulta.");
  const messages: ChatMessage[] = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    const { role, content } = (m ?? {}) as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string")
      throw new AssistantInputError("La conversación no es válida.");
    const text = content.trim();
    if (!text) continue;
    if (text.length > MAX_MESSAGE_CHARS) throw new AssistantInputError("El mensaje es demasiado largo.");
    messages.push({ role, content: text });
  }
  // The model reads a conversation that starts and ends with the user.
  while (messages[0]?.role === "assistant") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new AssistantInputError("Escribí tu consulta.");
  if (messages.reduce((n, m) => n + m.content.length, 0) > MAX_TOTAL_CHARS)
    throw new AssistantInputError("La conversación es demasiado larga. Empezá una nueva.");
  const p = (b.place ?? {}) as Record<string, unknown>;
  let place: AssistantPlace;
  if (p.kind === "panel") place = { kind: "panel" };
  else if (p.kind === "demo" && typeof p.token === "string" && TOKEN.test(p.token) && typeof p.code === "string" && CODE.test(p.code))
    place = { kind: "demo", token: p.token, code: p.code };
  else throw new AssistantInputError("No pudimos abrir el asistente aquí.");
  const conversation = typeof b.conversation === "string" && UUID.test(b.conversation) ? b.conversation.toLowerCase() : null;
  return { messages, place, path: cleanPath(b.path), conversation };
}

/** Quick questions under the greeting, by place. */
export const SUGGESTIONS: Record<AssistantPlace["kind"], string[]> = {
  panel: [
    "¿Cómo cargo una propiedad?",
    "¿Cómo funcionan los créditos?",
    "¿Cómo publico mi catálogo?",
    "Tips para fotos que luzcan mejor",
  ],
  demo: [
    "¿Qué es este modo demostración?",
    "¿Cómo genero otro estilo?",
    "¿Cómo guardo mi panel?",
    "¿Cuánto cuesta?",
  ],
};

export const greeting = (kind: AssistantPlace["kind"]) =>
  kind === "demo"
    ? `¡Hola! Soy ${ASSISTANT_NAME}, el genio del diseño de habita. Te acompaño en esta demo: preguntame cómo generar estilos, descargar fotos o guardar tu panel.`
    : `¡Hola! Soy ${ASSISTANT_NAME}, el genio del diseño de habita. Preguntame lo que necesites sobre tu panel, tus propiedades, los créditos o cómo lograr ambientaciones que vendan.`;

// Template rendering and channel links. Shared by the panel (preview) and the
// server (which decides whether a text is the template or a custom message).

export const PLACEHOLDERS = {
  inmobiliaria: "Nombre de la inmobiliaria",
  decisor: "Quién decide",
  sdr: "Quien envía",
  demo: "Enlace a la demo publicada",
} as const;
export type RenderContext = Partial<Record<keyof typeof PLACEHOLDERS, string | null>>;

/** Fills {{placeholders}}; unknown or empty ones stay visible so nobody sends them by mistake. */
export function render(text: string, ctx: RenderContext) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => {
    const v = ctx[key as keyof RenderContext];
    return v && v.trim() ? v.trim() : m;
  });
}
export const unresolved = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);

/** wa.me with the exact text. Opening it proves nothing about delivery. */
export function whatsappUrl(recipient: string, body: string) {
  return `https://wa.me/${recipient.replace(/\D/g, "")}?text=${encodeURIComponent(body)}`;
}
/** mailto with subject and body. The mail client may change or not send it: confirmation is explicit. */
export function mailtoUrl(recipient: string, subject: string | null, body: string) {
  const q = new URLSearchParams();
  if (subject) q.set("subject", subject);
  q.set("body", body);
  return `mailto:${encodeURIComponent(recipient).replace("%40", "@")}?${q.toString().replace(/\+/g, "%20")}`;
}
export function channelUrl(a: { channel: string; recipient: string | null; subject: string | null; body: string | null }) {
  if (!a.recipient || !a.body) return null;
  if (a.channel === "whatsapp") return whatsappUrl(a.recipient, a.body);
  if (a.channel === "email") return mailtoUrl(a.recipient, a.subject, a.body);
  return null;
}

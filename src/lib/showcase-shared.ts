import { styles } from "./catalog";

/** What a buyer receives: no owner, account, file name or storage path. */
export type PublicProposal = { id: string; style: string; mode: string };
export type PublicRoom = { id: string; label: string; proposals: PublicProposal[] };
export type PublicShowcase = {
  id: string;
  title: string;
  agencyName: string | null;
  hasLogo: boolean;
  whatsapp: string | null;
  rooms: PublicRoom[];
};
export type ShowcaseOrigin = "enlace" | "embed";

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Digits only, with country and area code: 10 to 15 digits. */
export function normalizeWhatsapp(input: unknown) {
  if (typeof input !== "string") return null;
  const digits = input.replace(/\D/g, "");
  return /^[0-9]{10,15}$/.test(digits) ? digits : null;
}

export function showcasePath(token: string) {
  return `/ficha/${token}`;
}
export function embedPath(token: string) {
  return `/embed/ficha/${token}`;
}
export type ImageRef =
  | { kind: "logo" }
  | { kind: "original" | "proposal"; id: string };
export function imagePath(token: string, ref: ImageRef) {
  const name =
    ref.kind === "logo"
      ? "logo"
      : `${ref.kind === "original" ? "o" : "p"}-${ref.id}`;
  return `/ficha/${token}/imagen/${name}`;
}
export function parseImageRef(value: string): ImageRef | null {
  if (value === "logo") return { kind: "logo" };
  const match = /^(o|p)-(.+)$/.exec(value);
  if (!match || !UUID.test(match[2])) return null;
  return { kind: match[1] === "o" ? "original" : "proposal", id: match[2] };
}

/** Styles with at least one reviewed proposal, in catalog order. */
export function styleOptions(proposals: PublicProposal[]) {
  const known = styles.map((s) => s.id as string);
  const groups = new Map<string, string[]>();
  for (const p of proposals) {
    const style = known.includes(p.style) ? p.style : "modern";
    groups.set(style, [...(groups.get(style) || []), p.id]);
  }
  return [...groups.entries()]
    .sort((a, b) => known.indexOf(a[0]) - known.indexOf(b[0]))
    .map(([style, ids]) => ({
      style,
      name: styles.find((s) => s.id === style)?.name || "Estilo",
      ids,
    }));
}

export type ContactIntent = "consulta" | "visita";
/**
 * A wa.me link that only opens the chat with a suggested text: the buyer
 * decides whether to send it. Nothing is sent automatically.
 */
export function whatsappLink({
  phone,
  title,
  url,
  intent,
  room,
  style,
}: {
  phone: string;
  title: string;
  url: string;
  intent: ContactIntent;
  room?: string;
  style?: string;
}) {
  const digits = normalizeWhatsapp(phone);
  if (!digits) return null;
  const seen =
    room && style
      ? ` Vi la propuesta ${style} del ambiente «${room}».`
      : room
        ? ` Me interesa el ambiente «${room}».`
        : "";
  const text =
    intent === "visita"
      ? `Hola, quiero coordinar una visita a la propiedad «${title}».${seen}\n${url}`
      : `Hola, quiero consultar por la propiedad «${title}».${seen}\n${url}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
/**
 * Code to paste in the agency's site. The iframe works alone; the short
 * script only adjusts its height to the content where scripts are allowed.
 */
export function embedCode(origin: string, token: string, title: string) {
  const src = `${origin}${embedPath(token)}`;
  const id = `amoblaia-${token.slice(0, 8)}`;
  return `<iframe id="${id}" src="${src}" title="${escapeAttr(title)} · ambientación virtual" loading="lazy" style="width:100%;max-width:960px;height:760px;border:0;border-radius:12px"></iframe>
<script>addEventListener("message",function(e){if(e.origin==="${origin}"&&e.data&&e.data.type==="amoblaia:height"){var f=document.getElementById("${id}");if(f&&e.source===f.contentWindow)f.style.height=Math.min(4000,Math.max(320,+e.data.height||0))+"px"}});</script>`;
}

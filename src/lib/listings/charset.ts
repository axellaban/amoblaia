// Turns the bytes of a page into text with the charset the page declares:
// the Content-Type header first, then a byte order mark, then <meta charset>
// or <meta http-equiv="Content-Type"> in the first bytes, then UTF-8 unless
// the bytes are not valid UTF-8 (old Spanish sites in windows-1252).
// Pure: no network.

const ALIASES: Record<string, string> = {
  utf8: "utf-8",
  "utf-8": "utf-8",
  latin1: "windows-1252",
  "iso-8859-1": "windows-1252",
  "iso8859-1": "windows-1252",
  "iso_8859-1": "windows-1252",
  "us-ascii": "windows-1252",
  ascii: "windows-1252",
  "windows-1252": "windows-1252",
  cp1252: "windows-1252",
  "iso-8859-15": "iso-8859-15",
};

/** A charset label as TextDecoder knows it, or null when it is not one we read. */
export function normalizeCharset(label: string | null | undefined): string | null {
  if (!label) return null;
  const key = label.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  try {
    return new TextDecoder(key).encoding;
  } catch {
    return null;
  }
}

/** The charset of a Content-Type header ("text/html; charset=utf8"). */
export const headerCharset = (contentType: string | null | undefined) =>
  normalizeCharset(/charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "")?.[1]);

/** The charset a document declares in its first 4 KB. */
export function metaCharset(head: string) {
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  return normalizeCharset(meta);
}

function bom(bytes: Uint8Array) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

/** Text of a page and the charset used, never throwing on bad bytes. */
export function decodeHtml(bytes: Uint8Array, contentType?: string | null): { text: string; charset: string } {
  const declared =
    headerCharset(contentType) ??
    bom(bytes) ??
    // ASCII-compatible preview, enough to read the <meta> tag.
    metaCharset(new TextDecoder("windows-1252").decode(bytes.subarray(0, 4096)));
  if (declared) {
    try {
      return { text: new TextDecoder(declared, { ignoreBOM: false }).decode(bytes), charset: declared };
    } catch {
      // An unsupported label: the detection below decides.
    }
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), charset: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), charset: "windows-1252" };
  }
}

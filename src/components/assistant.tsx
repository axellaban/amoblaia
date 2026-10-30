"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Send, X } from "lucide-react";
import { track } from "@/lib/analytics";
import {
  ASSISTANT_NAME,
  ASSISTANT_TITLE,
  greeting,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
  SUGGESTIONS,
  type AssistantPlace,
  type ChatMessage,
} from "@/lib/assistant/shared";

/** Pablo's portrait: a cubist painter with beret, mustache and two different eyes. Original drawing. */
export function PabloAvatar({ size = 44 }: { size?: number }) {
  return (
    <svg className="pb-avatar" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="32" fill="#e9dfd0" />
      <path d="M14 30 L32 16 L50 26 L48 50 L30 58 L16 48 Z" fill="#f2c9a0" />
      <path d="M32 16 L50 26 L48 50 L32 54 Z" fill="#dfa77a" />
      <path d="M10 24 C14 10 46 6 54 20 C46 18 22 18 10 24 Z" fill="#24382e" />
      <rect x="30" y="4" width="4" height="7" rx="2" fill="#24382e" />
      <circle cx="24" cy="32" r="4.2" fill="#fff" />
      <circle cx="24.6" cy="32.4" r="2.2" fill="#242824" />
      <path d="M37 29 L46 33 L37 36 Z" fill="#fff" />
      <circle cx="40" cy="32.6" r="1.8" fill="#242824" />
      <path d="M31 33 L27 44 L32 44" fill="none" stroke="#9a5b34" strokeWidth="2" strokeLinejoin="round" />
      <path d="M22 47 C26 44 30 46 32 46 C34 46 38 44 43 47 C38 49 34 48 32 48 C30 48 26 49 22 47 Z" fill="#242824" />
      <path d="M19 26 L29 25" stroke="#242824" strokeWidth="2" strokeLinecap="round" />
      <path d="M36 24 L45 27" stroke="#242824" strokeWidth="2" strokeLinecap="round" />
      <circle cx="52" cy="46" r="5" fill="#c4572e" />
      <circle cx="49" cy="53" r="3.4" fill="#e3b23c" />
      <circle cx="56" cy="53" r="3" fill="#3f6fa0" />
    </svg>
  );
}

/** **bold** and [text](/internal) links: the little markdown Pablo uses. Anything else stays text. */
function inline(text: string) {
  const parts: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<strong key={m.index}>{m[1]}</strong>);
    else
      parts.push(
        <a key={m.index} href={m[3].startsWith("//") ? "/" : m[3]}>
          {m[2]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Paragraphs and lists of an answer, rendered without HTML injection. */
export function AnswerText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length}>
        {list.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^[-•*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ""))}</p>);
  }
  flush();
  return <Fragment>{blocks}</Fragment>;
}

const storageKey = (place: AssistantPlace) => `habita-pablo:${place.kind === "demo" ? place.token : "panel"}`;

function saved(key: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    return Array.isArray(list) ? list.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Pablo, the chat at hand: a round button at the bottom right that opens a
 * conversation about habita., the panel and the design of each property.
 */
export function Assistant({ place }: { place: AssistantPlace }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const area = place.kind;
  const key = storageKey(place);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    // Restored after mount, so the server render and the first client render match.
    setMessages(saved(key));
    setRestored(true);
  }, [key]);

  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(messages.slice(-MAX_MESSAGES * 2)));
    } catch {
      /* The conversation just won't survive a reload. */
    }
  }, [messages, key, restored]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    // On a phone, focusing would open the keyboard over the suggestions.
    if (window.matchMedia("(pointer: fine)").matches) field.current?.focus();
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  useEffect(() => () => abort.current?.abort(), []);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim().slice(0, MAX_MESSAGE_CHARS);
      if (!q || busy) return;
      setError(null);
      setText("");
      const history: ChatMessage[] = [...messages, { role: "user", content: q }];
      setMessages([...history, { role: "assistant", content: "" }]);
      setBusy(true);
      track("asistente_pregunta", { area, mensajes: history.length });
      const controller = new AbortController();
      abort.current = controller;
      let answer = "";
      try {
        const response = await fetch("/api/asistente", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history.slice(-MAX_MESSAGES), place, path: window.location.pathname }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          throw new Error(typeof data.error === "string" ? data.error : "No pude responder ahora. Probá de nuevo.");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          answer += decoder.decode(value, { stream: true });
          const shown = answer;
          setMessages([...history, { role: "assistant", content: shown }]);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "No pude responder ahora. Probá de nuevo.");
        // The question goes back to the field, so it can be sent again.
        setMessages(messages);
        setText(q);
      } finally {
        if (abort.current === controller) abort.current = null;
        setBusy(false);
      }
    },
    [area, busy, messages, place],
  );

  const restart = () => {
    abort.current?.abort();
    setMessages([]);
    setError(null);
    setBusy(false);
    track("asistente_reiniciar", { area });
  };

  return (
    <div className={`pb-root is-${area}`}>
      {open && (
        <section className="pb-panel" role="dialog" aria-modal="false" aria-labelledby="pb-title">
          <header className="pb-head">
            <PabloAvatar size={42} />
            <div className="pb-who">
              <strong id="pb-title">{ASSISTANT_NAME}</strong>
              <small>{ASSISTANT_TITLE}</small>
            </div>
            {messages.length > 0 && (
              <button type="button" className="pb-icon" onClick={restart} aria-label="Empezar una conversación nueva" title="Nueva conversación">
                <RotateCcw size={17} aria-hidden="true" />
              </button>
            )}
            <button type="button" className="pb-icon" onClick={() => setOpen(false)} aria-label={`Cerrar el chat con ${ASSISTANT_NAME}`}>
              <X size={19} aria-hidden="true" />
            </button>
          </header>
          <div className="pb-messages" ref={list} aria-live="polite">
            <div className="pb-msg is-assistant">
              <AnswerText text={greeting(area)} />
            </div>
            {messages.length === 0 && (
              <ul className="pb-suggestions" aria-label="Preguntas frecuentes">
                {SUGGESTIONS[area].map((s) => (
                  <li key={s}>
                    <button type="button" onClick={() => void ask(s)}>
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="pb-msg is-user">
                  <p>{m.content}</p>
                </div>
              ) : (
                <div key={i} className="pb-msg is-assistant">
                  {m.content ? (
                    <AnswerText text={m.content} />
                  ) : (
                    <p className="pb-typing" role="status">
                      <span className="sr-only">{ASSISTANT_NAME} está escribiendo…</span>
                      <i aria-hidden="true" />
                      <i aria-hidden="true" />
                      <i aria-hidden="true" />
                    </p>
                  )}
                </div>
              ),
            )}
            {error && (
              <p className="pb-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <form
            className="pb-form"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(text);
            }}
          >
            <textarea
              ref={field}
              rows={1}
              value={text}
              maxLength={MAX_MESSAGE_CHARS}
              placeholder={`Preguntale a ${ASSISTANT_NAME}…`}
              aria-label={`Tu pregunta para ${ASSISTANT_NAME}`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void ask(text);
                }
              }}
            />
            <button type="submit" className="pb-send" disabled={busy || !text.trim()} aria-label="Enviar">
              <Send size={18} aria-hidden="true" />
            </button>
          </form>
          <p className="pb-note">Respuestas generadas con IA: pueden tener errores.</p>
        </section>
      )}
      <button
        type="button"
        className={`pb-launcher ${open ? "is-open" : ""}`}
        aria-expanded={open}
        aria-label={open ? `Cerrar el chat con ${ASSISTANT_NAME}` : `Abrir el chat con ${ASSISTANT_NAME}, ${ASSISTANT_TITLE.toLowerCase()}`}
        onClick={() => {
          setOpen(!open);
          if (!open) track("asistente_abierto", { area });
        }}
      >
        <PabloAvatar size={56} />
        {!open && <span className="pb-launcher-label">¿Te ayudo?</span>}
      </button>
    </div>
  );
}

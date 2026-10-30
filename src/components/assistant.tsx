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

/** Miguel Ángel's portrait: a Renaissance master with curls, beard and a chisel. Original drawing. */
export function MiguelAvatar({ size = 44 }: { size?: number }) {
  return (
    <svg className="pb-avatar" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="32" fill="#e9dfd0" />
      <path d="M17 30 C17 18 47 18 47 30 L46 42 C44 50 20 50 18 42 Z" fill="#f0c7a0" />
      <path d="M14 32 C10 18 20 8 32 8 C44 8 54 18 50 32 C48 26 46 22 42 21 C36 24 28 24 22 21 C18 22 16 26 14 32 Z" fill="#3b2a1e" />
      <circle cx="18" cy="16" r="5" fill="#3b2a1e" />
      <circle cx="27" cy="10" r="5" fill="#3b2a1e" />
      <circle cx="38" cy="10" r="5" fill="#3b2a1e" />
      <circle cx="47" cy="16" r="5" fill="#3b2a1e" />
      <path d="M18 40 C20 50 26 57 32 57 C38 57 44 50 46 40 C42 46 38 47 32 47 C26 47 22 46 18 40 Z" fill="#3b2a1e" />
      <path d="M27 42 C30 45 34 45 37 42" fill="none" stroke="#f0c7a0" strokeWidth="2" strokeLinecap="round" />
      <path d="M21 29 L28 28" stroke="#2a1d14" strokeWidth="2" strokeLinecap="round" />
      <path d="M36 28 L43 29" stroke="#2a1d14" strokeWidth="2" strokeLinecap="round" />
      <circle cx="25" cy="33" r="2" fill="#242824" />
      <circle cx="39" cy="33" r="2" fill="#242824" />
      <path d="M32 33 L30 39 L33 39" fill="none" stroke="#b27a52" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M48 44 L58 54" stroke="#8a6a44" strokeWidth="4" strokeLinecap="round" />
      <path d="M45 41 L50 46" stroke="#9aa3a8" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/** **bold** and [text](/internal) links: the little markdown Miguel Ángel uses. Anything else stays text. */
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

/** How long the chat waits for the next words before giving up. */
const WAIT_MS = 45_000;

const storageKey = (place: AssistantPlace) => `habita-miguel:${place.kind === "demo" ? place.token : "panel"}`;

function saved(key: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    // An answer cut by a reload is not restored as a bubble that never fills.
    return Array.isArray(list) ? list.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()) : [];
  } catch {
    return [];
  }
}

/**
 * Miguel Ángel, the chat at hand: a round button at the bottom right that opens a
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
      sessionStorage.setItem(key, JSON.stringify(messages.filter((m) => m.content.trim()).slice(-MAX_MESSAGES * 2)));
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
      let stalled = false;
      // No word for a while: stop waiting and say so, never dots forever.
      let watchdog = 0;
      const watch = () => {
        window.clearTimeout(watchdog);
        watchdog = window.setTimeout(() => {
          stalled = true;
          controller.abort();
        }, WAIT_MS);
      };
      watch();
      try {
        const response = await fetch("/api/asistente", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history.slice(-MAX_MESSAGES), place, path: window.location.pathname }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          throw new Error(typeof data.error === "string" ? data.error : `No pude responder ahora (error ${response.status}). Probá de nuevo.`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          watch();
          answer += decoder.decode(value, { stream: true });
          const shown = answer;
          setMessages([...history, { role: "assistant", content: shown }]);
        }
        if (!answer.trim()) throw new Error("No pude responder ahora. Probá de nuevo.");
      } catch (e) {
        if (controller.signal.aborted && !stalled) return;
        setError(stalled ? "La respuesta está tardando demasiado. Probá de nuevo." : e instanceof Error ? e.message : "No pude responder ahora. Probá de nuevo.");
        // The question goes back to the field, so it can be sent again.
        setMessages(messages);
        setText(q);
      } finally {
        window.clearTimeout(watchdog);
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
            <MiguelAvatar size={42} />
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
        <MiguelAvatar size={56} />
        {!open && <span className="pb-launcher-label">¿Te ayudo?</span>}
      </button>
    </div>
  );
}

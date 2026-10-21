"use client";
import { useEffect, useRef } from "react";
declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: Record<string, unknown>,
      ) => string;
      remove: (id: string) => void;
      reset: (id: string) => void;
    };
  }
}
/** Cloudflare Turnstile, when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set (it must
 * match the CAPTCHA configured in Supabase Auth). */
export function Captcha({
  onToken,
  reset,
}: {
  onToken: (token: string) => void;
  reset: number;
}) {
  const ref = useRef<HTMLDivElement>(null),
    id = useRef<string | null>(null);
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (!key) return;
    let alive = true;
    function render() {
      if (alive && ref.current && window.turnstile && !id.current)
        id.current = window.turnstile.render(ref.current, {
          sitekey: key,
          theme: "light",
          callback: onToken,
          "expired-callback": () => onToken(""),
        });
    }
    let script = document.querySelector<HTMLScriptElement>(
      "script[data-amobla-captcha]",
    );
    if (!script) {
      script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.dataset.amoblaCaptcha = "true";
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    render();
    return () => {
      alive = false;
      script?.removeEventListener("load", render);
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
    };
  }, [key, onToken]);
  useEffect(() => {
    if (id.current) {
      window.turnstile?.reset(id.current);
      onToken("");
    }
  }, [reset, onToken]);
  return key ? <div className="captcha" ref={ref} /> : null;
}

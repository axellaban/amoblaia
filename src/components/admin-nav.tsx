"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { markInternal } from "@/lib/interaction-tracking";

const LINKS: [string, string][] = [
  ["/admin/prospeccion", "Adquisición"],
  ["/admin/demos", "Demos existentes"],
  ["/admin/inmobiliarias", "Inmobiliarias"],
];

/**
 * The team's side panel. It lives in the /admin layout, so moving between
 * sections only replaces the content on the right. The demo preview is the
 * public page as buyers see it, so it is shown without the panel.
 */
export function AdminNav() {
  const pathname = usePathname();
  // Only the team gets this panel: its device stays out of the commercial metrics.
  useEffect(() => markInternal("admin"), []);
  if (pathname.endsWith("/vista-previa")) return null;
  return (
    <aside className="pr-side" aria-label="Operación comercial">
      <div className="pr-side-brand">
        habita<span>.</span>
        <small>Operación comercial</small>
      </div>
      <nav>
        {LINKS.map(([href, label]) => {
          const on = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} className={on ? "is-on" : undefined} aria-current={on ? "page" : undefined}>
              {label}
            </Link>
          );
        })}
      </nav>
      <p className="pr-side-foot">Privado del equipo. Sin conexión automática a WhatsApp ni Gmail: cada envío y respuesta se registra.</p>
    </aside>
  );
}

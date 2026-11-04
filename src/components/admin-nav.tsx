"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Bot, Building2, Megaphone, ShieldCheck } from "lucide-react";
import { markInternal } from "@/lib/interaction-tracking";

/**
 * Three sections. Leads and demos live inside each agency now, so their
 * old addresses (and the demo editor under /admin/demos) light «Inmobiliarias».
 */
const LINKS: { href: string; label: string; icon: typeof Bot; also?: string[] }[] = [
  { href: "/admin/prospeccion", label: "Adquisición", icon: Megaphone },
  { href: "/admin/inmobiliarias", label: "Inmobiliarias", icon: Building2, also: ["/admin/demos", "/admin/leads"] },
  { href: "/admin/asistente", label: "Miguel Ángel", icon: Bot },
  { href: "/admin/internos", label: "Tráfico interno", icon: ShieldCheck },
];
const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

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
        <small>Administración</small>
      </div>
      <nav>
        {LINKS.map(({ href, label, icon: Icon, also }) => {
          const on = [href, ...(also ?? [])].some((h) => under(pathname, h));
          return (
            <Link key={href} href={href} className={on ? "is-on" : undefined} aria-current={on ? "page" : undefined}>
              <Icon size={19} aria-hidden="true" /> {label}
            </Link>
          );
        })}
      </nav>
      <p className="pr-side-foot" title="Privado del equipo. Sin conexión automática a WhatsApp ni Gmail: cada envío y respuesta se registra.">
        <span className="pr-side-avatar" aria-hidden="true">
          H
        </span>
        Equipo habita
      </p>
    </aside>
  );
}

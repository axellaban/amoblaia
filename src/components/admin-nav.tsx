import Link from "next/link";

/**
 * The team's sections. One list, so another section (for example
 * Prospección) is one more entry here and every admin page shows it.
 */
export const ADMIN_SECTIONS = [
  { id: "inmobiliarias", href: "/admin/inmobiliarias", label: "Inmobiliarias" },
  { id: "nueva", href: "/admin/inmobiliarias/nueva", label: "Nueva inmobiliaria" },
  { id: "demos", href: "/admin/demos", label: "Demos" },
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number]["id"];

export function AdminNav({ current }: { current: AdminSection }) {
  return (
    <nav className="ae-nav" aria-label="Administración">
      {ADMIN_SECTIONS.map((s) => (
        <Link key={s.id} href={s.href} aria-current={s.id === current ? "page" : undefined}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DemoAgencyChooser } from "@/components/admin-start-demo";
import { requireAdminPage } from "@/lib/demos/admin-page";
import { isUuid } from "@/lib/demos/shared";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Nueva demo",
  robots: { index: false, follow: false },
};

/**
 * «Nueva demo»: the agency first, then the panel's «Crear demostración
 * interactiva» flow for it (inside the team's edit context). From an agency's
 * row (?inmobiliaria=) it goes straight to that flow; the server checks it again.
 */
export default async function NewDemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("/admin/demos/nueva");
  const q = await searchParams;
  const agency = typeof q.inmobiliaria === "string" && isUuid(q.inmobiliaria) ? q.inmobiliaria : null;
  if (agency)
    redirect(`/admin/inmobiliarias/${agency}/propiedades/nueva?${new URLSearchParams({ volver: `/admin/inmobiliarias/${agency}/editar` })}`);
  return <DemoAgencyChooser />;
}

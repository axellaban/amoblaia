import type { Metadata } from "next";
import { ProspectingApp, type Tab } from "@/components/prospecting/app";
import { requireAdminPage } from "@/lib/demos/admin-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Adquisición",
  robots: { index: false, follow: false },
};

const TABS: Tab[] = ["resumen", "prospectos", "mensajes", "ejecucion"];
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The team's acquisition center. Data loads from the admin API, which checks the admin list on every request. */
export default async function ProspectingPage({ searchParams }: Props) {
  await requireAdminPage("/admin/prospeccion");
  const vista = (await searchParams).vista;
  const tab = TABS.find((t) => t === (Array.isArray(vista) ? vista[0] : vista)) ?? "resumen";
  return <ProspectingApp initialTab={tab} />;
}

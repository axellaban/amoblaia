import type { Metadata } from "next";
import { InternalDeviceStatus } from "@/components/internal-device";

export const metadata: Metadata = { title: "Dispositivo del equipo · habita", robots: { index: false, follow: false } };

/**
 * Whether this browser is counted as the team's (QA, and where a linked
 * phone or private window lands). Shows no personal data: only the verdict.
 */
export default async function InternalDevicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const estado = (await searchParams).estado;
  return <InternalDeviceStatus outcome={typeof estado === "string" ? estado : null} />;
}

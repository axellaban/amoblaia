import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/demos/admin-page";
import { isUuid } from "@/lib/demos/shared";
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * «Leads» is now part of «Inmobiliarias»: the lead score is a column there
 * and each agency's «Actividad» tab has its visitors. Old links still land
 * on the right place.
 */
export default async function LeadsPage({ searchParams }: Props) {
  await requireAdminPage("/admin/leads");
  const id = (await searchParams).inmobiliaria;
  const agency = Array.isArray(id) ? id[0] : id;
  redirect(agency && isUuid(agency) ? `/admin/inmobiliarias/${agency}?pestana=actividad` : "/admin/inmobiliarias?score=60");
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { WorkspaceRequest } from "@/components/workspace-request";
import { INVITE_CODE } from "@/lib/agency/demo-invite";
import { membershipOf } from "@/lib/agency/server";
import { myAccessRequest } from "@/lib/agency/workspace";
import { entrySpace } from "@/lib/agency/workspace-entry";
import { isAdmin } from "@/lib/commerce/http";
import { currentUser } from "@/lib/supabase/server";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Solicitar acceso", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

/**
 * Journey C: the space of the agency this person came from (?demo=<token>,
 * ?codigo=<code> or its visit) is not theirs. Its private data is never
 * shown here: only its name, the request and the way back to the public demo.
 * A member goes straight to its panel (or the demo's property in it).
 */
export default async function RequestAccessPage({ searchParams }: Props) {
  if (!cloudEnabled() || !cloudConfigured()) notFound();
  const q = await searchParams;
  const demoToken = one(q.demo);
  const rawCode = one(q.codigo);
  const code = rawCode && INVITE_CODE.test(rawCode) ? rawCode : null;
  const space = await entrySpace({ demoToken, code }).catch(() => null);
  if (!space)
    return (
      <div className="account-page container ap-start">
        <span className="eyebrow">habita para inmobiliarias</span>
        <h1>No encontramos la inmobiliaria</h1>
        <p>Abrí de nuevo el enlace que te enviaron, o pedile a la inmobiliaria que te invite desde «Equipo y accesos».</p>
        <div className="ap-start-actions">
          <Link href="/panel" className="button button-outline">
            Ir a mi panel
          </Link>
        </div>
      </div>
    );
  const user = await currentUser().catch(() => null);
  const verified = user && !user.is_anonymous && user.email_confirmed_at ? user : null;
  if (verified && isAdmin(verified.email)) redirect(`/admin/inmobiliarias/${space.agency.id}`);
  const own = verified ? await membershipOf(verified.id) : null;
  if (own && own.agency.id === space.agency.id) redirect(space.demo ? `/panel/propiedades/${space.demo.id}` : "/panel");
  const pending = verified && !own ? await myAccessRequest(verified.id, space.agency.id) : null;
  const here = `/panel/solicitar-acceso${demoToken || code ? `?${new URLSearchParams({ ...(demoToken ? { demo: demoToken } : {}), ...(code ? { codigo: code } : {}) })}` : ""}`;
  // The public demo stays reachable (entrySpace only names published ones): back to it.
  const demo = space.demo ?? null;
  return (
    <WorkspaceRequest
      agencyId={space.agency.id}
      agencyName={space.agency.name}
      hasSpace={Boolean(space.agency.ownerId)}
      demoToken={demoToken}
      demoId={demo?.id ?? null}
      code={code}
      backHref={demo ? `/demo/${demo.token}` : null}
      signedInEmail={verified?.email ?? null}
      otherAgency={own ? own.agency.name : null}
      pendingSince={pending?.createdAt ?? null}
      here={here}
    />
  );
}

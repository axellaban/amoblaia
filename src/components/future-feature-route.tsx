// The panel page of an upcoming tool: the sidebar and the shared page.
import { PanelNav, type PanelSection } from "@/components/panel-shell";
import { FutureFeaturePage } from "@/components/future-feature";
import { FUTURE_FEATURE_INFO, type FutureFeature } from "@/lib/agency/future-features";
import { requirePanelPage } from "@/lib/agency/page";

export async function FutureFeatureRoute({ feature }: { feature: FutureFeature }) {
  const info = FUTURE_FEATURE_INFO[feature];
  const { membership } = await requirePanelPage(`/panel/${info.slug}`);
  return (
    <>
      <PanelNav section={feature as PanelSection} agencyName={membership.agency.name} role={membership.role} />
      <div className="account-page container ap-page">
        <FutureFeaturePage feature={feature} agencyName={membership.agency.name} role={membership.role} readOnly={Boolean(membership.support)} />
      </div>
    </>
  );
}

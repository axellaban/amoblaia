/**
 * Which interaction design a person saw, on every PostHog event: the flow of
 * the page, that flow's UX version and the deployment that served it. Read at
 * capture time from the bundle in the browser, so a tab left open reports the
 * version it is really showing. Before this existed events have none of these
 * properties: an empty value means "before the versioning". See
 * docs/CRO_INSTRUMENTACION.md.
 */
export type FlowName =
  | "home"
  | "demo"
  | "studio"
  | "signup"
  | "panel"
  | "pricing"
  | "account"
  | "auth"
  | "agency_site"
  | "admin"
  | "other";

/** Raise a flow's number in the same PR that changes how that flow is used. */
export const UX_VERSIONS: Record<FlowName, number> = {
  home: 1,
  demo: 1,
  studio: 1,
  signup: 1,
  panel: 2,
  pricing: 1,
  account: 1,
  auth: 1,
  agency_site: 1,
  admin: 1,
  other: 1,
};

const within = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function flowOf(pathname: string): FlowName {
  if (pathname === "/" || within(pathname, "/inicio")) return "home";
  if (within(pathname, "/demo")) return "demo";
  if (within(pathname, "/estudio")) return "studio";
  if (within(pathname, "/panel/empezar")) return "signup";
  if (within(pathname, "/panel")) return "panel";
  if (within(pathname, "/precios")) return "pricing";
  if (within(pathname, "/cuenta")) return "account";
  if (within(pathname, "/acceso")) return "auth";
  if (within(pathname, "/inmobiliaria")) return "agency_site";
  if (within(pathname, "/admin")) return "admin";
  return "other";
}

/** Set at build time in next.config.ts. Falls back to the commit, then to "local". */
export function deploymentId() {
  return (
    process.env.NEXT_PUBLIC_HABITA_DEPLOYMENT_ID ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    "local"
  );
}

export function uxContext(pathname: string) {
  const flow = flowOf(pathname);
  return {
    flow_name: flow,
    ux_version: `v${UX_VERSIONS[flow]}`,
    deployment_id: deploymentId(),
  };
}

/**
 * Adds the context to one event. What the event already says wins, so a flow
 * can name itself (a modal inside another page) and nothing existing changes.
 * Recording chunks are not product events: they stay as they are.
 */
export function withUxContext<T extends Record<string, unknown>>(event: string, properties: T, pathname: string): T {
  if (event === "$snapshot") return properties;
  const raw = properties.$pathname;
  return { ...uxContext(typeof raw === "string" && raw ? raw : pathname), ...properties };
}

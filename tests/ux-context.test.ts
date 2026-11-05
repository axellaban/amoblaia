import { afterEach, describe, expect, it, vi } from "vitest";

const calls: { method: string; args: unknown[] }[] = [];
vi.mock("posthog-js", () => ({
  default: {
    __loaded: true,
    register: (...args: unknown[]) => calls.push({ method: "register", args }),
    unregister: (...args: unknown[]) => calls.push({ method: "unregister", args }),
  },
}));

import { setExperimentVariant } from "@/lib/analytics";
import { deploymentId, flowOf, UX_VERSIONS, uxContext, withUxContext } from "@/lib/ux-context";

afterEach(() => {
  vi.unstubAllEnvs();
  calls.length = 0;
});

describe("the flow of a page", () => {
  it.each([
    ["/", "home"],
    ["/inicio", "home"],
    ["/demo/tok", "demo"],
    ["/demo/tok/presentacion", "demo"],
    ["/estudio", "studio"],
    ["/panel/empezar", "signup"],
    ["/panel/propiedades/1", "panel"],
    ["/precios", "pricing"],
    ["/cuenta", "account"],
    ["/acceso", "auth"],
    ["/inmobiliaria/una", "agency_site"],
    ["/admin/inmobiliarias", "admin"],
    ["/blog/uno", "other"],
  ])("%s is %s", (path, flow) => expect(flowOf(path)).toBe(flow));

  it("does not take a page that only starts with the same letters", () => {
    expect(flowOf("/precios-virtual-staging")).toBe("other");
    expect(flowOf("/demostracion")).toBe("other");
    expect(flowOf("/panelista")).toBe("other");
  });

  it("every flow has a version", () => {
    for (const path of ["/", "/demo/a", "/estudio", "/panel", "/precios", "/x"])
      expect(UX_VERSIONS[flowOf(path)]).toBeGreaterThan(0);
  });
});

describe("the deployment", () => {
  it("prefers the deployment id, then the commit, then local", () => {
    vi.stubEnv("NEXT_PUBLIC_HABITA_DEPLOYMENT_ID", "dpl_abc");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "1234567890");
    expect(deploymentId()).toBe("dpl_abc");
    vi.stubEnv("NEXT_PUBLIC_HABITA_DEPLOYMENT_ID", "");
    expect(deploymentId()).toBe("1234567");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "");
    expect(deploymentId()).toBe("local");
  });
});

describe("the context on an event", () => {
  it("adds flow, version and deployment", () => {
    vi.stubEnv("NEXT_PUBLIC_HABITA_DEPLOYMENT_ID", "dpl_abc");
    expect(withUxContext("demo_vista", { demo_id: "d" }, "/demo/tok")).toEqual({
      demo_id: "d",
      flow_name: "demo",
      ux_version: `v${UX_VERSIONS.demo}`,
      deployment_id: "dpl_abc",
    });
  });

  it("reads the page of the event before the current one", () => {
    expect(withUxContext("$pageview", { $pathname: "/precios" }, "/panel")).toMatchObject({ flow_name: "pricing" });
  });

  it("never replaces what the event already says", () => {
    expect(withUxContext("x", { flow_name: "checkout", ux_version: "v9" }, "/panel")).toMatchObject({
      flow_name: "checkout",
      ux_version: "v9",
    });
  });

  it("leaves recording chunks alone", () => {
    const chunk = { $snapshot_data: [] };
    expect(withUxContext("$snapshot", chunk, "/panel")).toBe(chunk);
  });

  it("carries nothing from the address but the flow", () => {
    const context = uxContext("/demo/token-privado");
    expect(JSON.stringify(context)).not.toContain("token-privado");
  });
});

describe("the experiment variant", () => {
  it("travels on every later event while there is an experiment", () => {
    setExperimentVariant("precios_cta", "b");
    expect(calls).toEqual([{ method: "register", args: [{ experiment_variant: "precios_cta:b" }] }]);
  });

  it("is removed when the experiment ends", () => {
    setExperimentVariant(null);
    expect(calls).toEqual([{ method: "unregister", args: ["experiment_variant"] }]);
  });
});

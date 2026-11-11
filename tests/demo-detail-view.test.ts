import { describe, expect, it, vi } from "vitest";

// The property the panel's page now sends with its HTML (UX-005) is the same the API answers:
// for the agency, never the team's notes, contact or sending data.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/demos/server", () => ({
  demoDetail: async () => ({
    demo: { id: "d1", agencyWhatsapp: "+5491100000000", agencyContact: "Isabel", sentAt: "2026-11-01", messageTemplate: "Hola", title: "Casa" },
    agency: { id: "a1", name: "Inmo", notes: "nota del equipo", contact_name: "Isabel" },
    sendLog: [{ at: "2026-11-01" }],
    photos: [],
  }),
}));
vi.mock("@/lib/agency/server", () => ({
  stagingRule: (a: { visitor?: boolean }) => (a.visitor ? { payer: "agency", blocked: null } : { payer: "team", blocked: null }),
}));

import { demoDetailFor } from "../src/lib/demos/detail-view";

const access = (over: Record<string, unknown>) =>
  ({ actor: null, demo: { id: "d1" }, admin: false, role: "editor", billingUser: null, editContext: null, acting: false, ...over }) as never;

describe("the editor's property, as the page and the API send it", () => {
  it("hides the team's data from the agency and says whether it can only look", async () => {
    const d = await demoDetailFor(access({ role: "viewer" }));
    expect(d.demo).toMatchObject({ agencyWhatsapp: null, agencyContact: null, sentAt: null, messageTemplate: null, title: "Casa" });
    expect(d.agency).toMatchObject({ notes: null, contact_name: null, name: "Inmo" });
    expect(d.sendLog).toBeUndefined();
    expect(d.readOnly).toBe(true);
    // What the page passes to the editor survives being serialized the same way.
    expect(JSON.parse(JSON.stringify(d)).demo.title).toBe("Casa");
  });

  it("keeps everything for the team", async () => {
    const d = await demoDetailFor(access({ admin: true }));
    expect(d.agency.notes).toBe("nota del equipo");
    expect(d.readOnly).toBe(false);
    expect(d.staging).toEqual({ payer: "team", blocked: null });
  });
});

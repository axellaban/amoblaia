import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CommercialRow } from "@/lib/agency/commercial";
import type { DemoSummary } from "@/lib/demos/shared";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("@/lib/demos/admin-page", () => ({ requireAdminPage: async () => ({ id: "admin" }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => "/admin/inmobiliarias",
  useSearchParams: () => new URLSearchParams(),
}));

const ID = "11111111-1111-4111-8111-111111111111";
const recent = new Date(Date.now() - 2 * 3600000).toISOString();
const rows: CommercialRow[] = [
  { id: ID, name: "Demaio Estudio Inmobiliario", coverPhotoId: null, stage: "interacted", hasOwner: false, subscribed: false, prospect: true, properties: 3, published: 2, score: 72, lastActivity: { at: recent, text: "Vio una demo" }, createdAt: "2026-10-01T00:00:00Z", test: false, demos: [{ createdAt: "2026-10-30T15:00:00Z", step: 3 }] },
  { id: "22222222-2222-4222-8222-222222222222", name: "Del Mar Propiedades", coverPhotoId: null, stage: "client", hasOwner: true, subscribed: true, prospect: false, properties: 12, published: 12, score: 91, lastActivity: { at: recent, text: "Se editó una propiedad" }, createdAt: "2026-09-01T00:00:00Z", test: false, demos: [{ createdAt: "2026-09-02T15:00:00Z", step: 6 }] },
  { id: "33333333-3333-4333-8333-333333333333", name: "Bianchi Propiedades", coverPhotoId: null, stage: "prospect", hasOwner: false, subscribed: false, prospect: true, properties: 1, published: 0, score: 18, lastActivity: { at: "2026-10-28T00:00:00Z", text: "Creada en adquisición" }, createdAt: "2026-10-28T00:00:00Z", test: false, demos: [] },
];
const demo = (over: Partial<DemoSummary>): DemoSummary => ({
  id: "44444444-4444-4444-8444-444444444444",
  token: "tok_tok_tok_tok_tok_tok",
  status: "published",
  title: "Dúplex en Pompeya",
  agencyId: ID,
  agencyName: "Demaio Estudio Inmobiliario",
  agencyClaimed: false,
  agencyWhatsapp: "5492234567890",
  propertyTitle: "Dúplex en Pompeya",
  propertyLocation: "Pompeya, Mar del Plata",
  photos: 6,
  staged: 4,
  coverPhotoId: null,
  cover: null,
  createdAt: "2026-10-20T00:00:00Z",
  publishedAt: "2026-10-21T00:00:00Z",
  sentAt: "2026-10-22T00:00:00Z",
  activity: { level: 2, at: recent, visitors: 12 },
  credits: { available: null, reserved: 10 },
  ...over,
});
const demos = [
  demo({}),
  demo({ id: "55555555-5555-4555-8555-555555555555", title: "Casa en Güemes", propertyLocation: "Güemes, Mar del Plata", sentAt: null, activity: { level: 0, at: null, visitors: 0 } }),
  demo({ id: "66666666-6666-4666-8666-666666666666", title: "PH en La Perla", status: "draft", sentAt: null, activity: { level: 0, at: null, visitors: 0 } }),
];

vi.mock("@/lib/agency/commercial-server", () => ({
  commercialRows: async () => rows,
  commercialRow: async (id: string) => rows.find((r) => r.id === id) ?? null,
  demoScoresOf: async () => ({ [demos[0].id]: 78 }),
  agencyActivity: async () => ({
    score: 72,
    visits: 12,
    interactions: 6,
    generated: 2,
    signups: 0,
    recent: [{ text: "Vio la demo", demo: "Dúplex en Pompeya", at: recent }],
    byDemo: [{ id: demos[0].id, title: "Dúplex en Pompeya", score: 78 }],
    capped: false,
  }),
}));
vi.mock("@/lib/agency/admin", () => ({
  claimsToReview: async () => [],
  agencyClaimInfo: async () => null,
  adminAgency: async () => ({
    agency: { id: ID, name: "Demaio Estudio Inmobiliario", slug: null, website: "demaio.com", hasOwner: false, claimedAt: null, sitePublished: false, createdAt: "2026-10-01T00:00:00Z", contactName: "María Demaio", notes: "Llamar después de las 17." },
    counts: { total: 3, published: 2, staged: 2, review: 0 },
    credits: { balance: null, pending: 10 },
    claims: [],
    members: [],
    imports: [],
    properties: [],
    propertiesTotal: 3,
  }),
}));
vi.mock("@/lib/demos/server", () => ({ listDemos: async () => ({ demos, agencies: [] }) }));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { contact_whatsapp: "5492234567890", claim_email: null }, error: null }) }) }) }),
  }),
}));

const List = (await import("@/app/admin/inmobiliarias/page")).default;
const Detail = (await import("@/app/admin/inmobiliarias/[id]/page")).default;
const detail = async (pestana?: string) =>
  renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(pestana ? { pestana } : {}) }));

describe("«Inmobiliarias», the team's single list", () => {
  it("shows the demos funnel, one tab per stage and each agency's row", async () => {
    const html = renderToStaticMarkup(await List({ searchParams: Promise.resolve({}) }));
    for (const text of ["Funnel de demos", "1. Demos creadas", "7. Suscripciones", "Con demo creada (2)", "Todas (3)", "Prospectos (1)", "Interactuaron (1)", "Clientes (1)", "Demaio Estudio Inmobiliario", "72 / 100", "Hace 2 horas", "Vio una demo", "Sin cuenta", "Activa", `/admin/inmobiliarias/${ID}`])
      expect(html).toContain(text);
  });
  it("filters by the stage in the URL", async () => {
    const html = renderToStaticMarkup(await List({ searchParams: Promise.resolve({ etapa: "clientes" }) }));
    expect(html).toContain("Del Mar Propiedades");
    expect(html).not.toContain("Bianchi Propiedades");
  });
  it("narrows the funnel and the list by the demo's creation date and step", async () => {
    const html = renderToStaticMarkup(await List({ searchParams: Promise.resolve({ desde: "2026-10-01", hasta: "2026-10-31", paso: "3" }) }));
    // Only Demaio's demo was created in October: one demo, and it reached «Con interacción».
    expect(html).toMatch(/<strong>1<\/strong><small>Base del período<\/small>/);
    expect(html).toContain("Demaio Estudio Inmobiliario");
    expect(html).not.toContain("Del Mar Propiedades");
    expect(html).not.toContain("Bianchi Propiedades");
  });
  it("splits each bar in who went on and who stayed, and filters by who stayed", async () => {
    const all = renderToStaticMarkup(await List({ searchParams: Promise.resolve({}) }));
    // Two demos: one stayed at «Con interacción», the other reached «Suscripciones».
    expect(all).toContain("1 interactuaron, sin cuenta");
    expect(all).toContain("paso=3&amp;quedo=1");
    const html = renderToStaticMarkup(await List({ searchParams: Promise.resolve({ paso: "3", quedo: "1" }) }));
    expect(html).toContain("Demaio Estudio Inmobiliario");
    expect(html).not.toContain("Del Mar Propiedades");
    expect(html).toContain("sin pasar a «Cuenta creada»");
  });
  it("offers to write each agency on WhatsApp with «¡Buenas!»", async () => {
    rows[0].whatsapp = "5492234567890";
    const html = renderToStaticMarkup(await List({ searchParams: Promise.resolve({}) }));
    rows[0].whatsapp = undefined;
    expect(html).toContain(`https://wa.me/5492234567890?text=${encodeURIComponent("¡Buenas!")}`);
    expect(html).toContain("Contactar por WhatsApp");
  });
  it("lists only agencies with a demo in the «Con demo creada» tab", async () => {
    const html = renderToStaticMarkup(await List({ searchParams: Promise.resolve({ etapa: "con-demo" }) }));
    expect(html).toContain("Demaio Estudio Inmobiliario");
    expect(html).toContain("Del Mar Propiedades");
    expect(html).not.toContain("Bianchi Propiedades");
  });
});

describe("one agency", () => {
  it("opens on its summary: stage, score, funnel and the next action", async () => {
    const html = await detail();
    for (const text of ["Resumen comercial", "Funnel de la inmobiliaria", "Próxima acción recomendada", "Contactar para impulsar la creación de su panel.", "Enviar demo", "Ver enlaces", "Llamar después de las 17."]) expect(html).toContain(text);
  });
  it("lists its properties and demos with their stage, visits and score", async () => {
    const html = await detail("propiedades");
    for (const text of ["Propiedades (3)", "Dúplex en Pompeya", "12 visitas", "Demo enviada", "Interactuó", "Borrador", "Nueva propiedad", `/admin/inmobiliarias/${ID}/propiedades/${demos[0].id}`]) expect(html).toContain(text);
  });
  it("has its four links, its activity and its account", async () => {
    const links = await detail("enlaces");
    for (const text of ["Demo para inmobiliaria", "Vista comprador", "Acceso al panel", "Página de precios"]) expect(links).toContain(text);
    const activity = await detail("actividad");
    for (const text of ["Actividad y engagement", "Visitas totales", "Imágenes generadas", "Por propiedad", "Detalle por visitante"]) expect(activity).toContain(text);
    const account = await detail("cuenta");
    for (const text of ["Cuenta y acceso", "Contactos", "María Demaio", "+5492234567890", "Invitaciones", "Créditos"]) expect(account).toContain(text);
  });
});

describe("old addresses", () => {
  it("lead to «Inmobiliarias»", async () => {
    const Leads = (await import("@/app/admin/leads/page")).default;
    await expect(Leads({ searchParams: Promise.resolve({ inmobiliaria: ID }) })).rejects.toThrow(`REDIRECT:/admin/inmobiliarias/${ID}?pestana=actividad`);
    const Demos = (await import("@/app/admin/demos/page")).default;
    await expect(Demos()).rejects.toThrow("REDIRECT:/admin/inmobiliarias");
  });
});

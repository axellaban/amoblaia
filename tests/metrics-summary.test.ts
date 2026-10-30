import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoMetrics, prospectingMetrics, revenueMetrics } from "@/lib/metrics/summary";
import type { Dataset, OutreachAttempt, ProspectAccount, ProspectEvent } from "@/lib/prospecting/types";

// Metrics for the Chapa Labs dashboard. Synthetic, clearly fictitious data.
const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, rpcs: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  adminClient: () => ({
    rpc: async (name: string) => {
      state.rpcs.push(name);
      if (name === "habita_prospect_dataset")
        return { data: { now: "2026-11-30T15:00:00-03:00", settings: { version: 1, message_window_days: 7, account_window_days: 30, small_sample: 30 }, accounts: [], attempts: [], events: [], templates: [], last_import: null }, error: null };
      return { data: 0, error: null };
    },
    from: (table: string) => ({
      select: () => ({
        order: () => ({ range: async () => ({ data: state.tables[table] ?? [], error: null }) }),
        in: async () => ({ data: [], error: null }),
      }),
    }),
  }),
}));
import { GET } from "../src/app/api/metricas/route";

let n = 0;
const uid = () => `id-${++n}`;
const account = (over: Partial<ProspectAccount> = {}): ProspectAccount => ({
  id: uid(), agency_id: uid(), name: `Cuenta sintética ${n}`, website: null, linked: false, campaign: "c1", sdr: "SDR A",
  priority: null, score: 50, score_components: {}, scoring_version: null, zone: null, decision_maker: null,
  decision_maker_role: null, stage: "sent", lost_reason: null, next_action: null, due_at: null, due_precision: "time",
  version: 1, created_at: "2026-10-01T10:00:00-03:00", imported: false, demos: 0, suppressed: false, contacts: [], ...over,
});
const send = (acc: ProspectAccount, at: string, over: Partial<OutreachAttempt> = {}): OutreachAttempt => ({
  id: uid(), account_id: acc.id, contact_id: null, campaign: "c1", step: 1, ordinal: 1, template_version_id: "v1",
  template_id: "t1", is_custom: false, variant_label: null, channel: "whatsapp", recipient: null, sender: null,
  subject: null, body: "x", status: "sent", status_reason: null, prepared_at: at, opened_at: at, lock_holder: null,
  lock_expires_at: null, sent_at: at, sent_precision: "time", verification_method: "manual", legacy: false, version: 1, ...over,
});
const event = (acc: ProspectAccount, type: ProspectEvent["type"], at: string, over: Partial<ProspectEvent> = {}): ProspectEvent => ({
  id: uid(), account_id: acc.id, attempt_id: null, type, occurred_at: at, precision: "time", channel: "whatsapp",
  human: type === "reply" ? true : null, source: "manual", details: {}, corrected: false, ...over,
});
const ds = (accounts: ProspectAccount[], attempts: OutreachAttempt[], events: ProspectEvent[] = []): Dataset => ({
  now: "2026-11-30T15:00:00-03:00", settings: { version: 1, message_window_days: 7, account_window_days: 30, small_sample: 30 },
  accounts, attempts, events, templates: [], last_import: null,
});

describe("prospecting", () => {
  it("uses the panel's funnel and splits it by SDR, channel and day", () => {
    const a = account({ stage: "interested" }), b = account({ sdr: "SDR B" }), c = account({ stage: "pending" });
    const m = prospectingMetrics(
      ds([a, b, c], [
        send(a, "2026-10-02T10:00:00-03:00"),
        send(a, "2026-10-05T10:00:00-03:00", { step: 2 }),
        send(b, "2026-10-02T23:30:00-03:00", { channel: "email" }),
        send(c, "2026-10-02T10:00:00-03:00", { status: "opened", sent_at: null }),
      ], [
        event(a, "reply", "2026-10-03T10:00:00-03:00"),
        event(a, "interest", "2026-10-03T11:00:00-03:00"),
        event(b, "reply", "2026-10-04T10:00:00-03:00", { corrected: true }),
      ]),
      {},
    );
    expect([m.prospectados, m.contactados, m.mensajes, m.respondieron, m.interesados]).toEqual([3, 2, 3, 1, 1]);
    expect(m.porSdr.map((s) => [s.sdr, s.contactados])).toEqual([["SDR A", 1], ["SDR B", 1]]);
    expect(m.porCanal.map((s) => [s.canal, s.contactados])).toEqual([["email", 1], ["whatsapp", 1]]);
    expect(m.etapas).toEqual({ interested: 1, sent: 1, pending: 1 });
    // 23:30 in Buenos Aires is still the 2nd; a corrected reply is left out.
    expect(m.diario).toEqual([
      { date: "2026-10-02", envios: 2, nuevos: 2, respuestas: 0, interesados: 0, reuniones: 0 },
      { date: "2026-10-03", envios: 0, nuevos: 0, respuestas: 1, interesados: 1, reuniones: 0 },
      { date: "2026-10-05", envios: 1, nuevos: 0, respuestas: 0, interesados: 0, reuniones: 0 },
    ]);
  });

  it("a range keeps the cohort of first sends in it", () => {
    const a = account(), b = account();
    const m = prospectingMetrics(ds([a, b], [send(a, "2026-10-02T10:00:00-03:00"), send(b, "2026-10-10T10:00:00-03:00")]), { from: "2026-10-05", to: "2026-10-31" });
    expect([m.prospectados, m.contactados]).toEqual([2, 1]);
    expect(m.diario.map((d) => d.date)).toEqual(["2026-10-10"]);
  });
});

describe("demos", () => {
  it("counts the highest step of each demo and its activity per day", () => {
    const demo = (level: number, status = "published") => ({ status, activity_level: level, activity_visitors: level ? 2 : 0, created_at: "2026-10-20T10:00:00-03:00", published_at: status === "published" ? "2026-10-21T10:00:00-03:00" : null });
    const m = demoMetrics([demo(0, "draft"), demo(1), demo(3), demo(5)], [
      { kind: "visita", created_at: "2026-10-22T10:00:00-03:00" },
      { kind: "generacion", created_at: "2026-10-22T11:00:00-03:00" },
      { kind: "otra", created_at: "2026-10-22T11:00:00-03:00" },
    ], {});
    expect([m.creadas, m.publicadas, m.ingresaron, m.interactuaron, m.generaron, m.panel, m.suscribieron, m.visitantes]).toEqual([4, 3, 3, 2, 2, 1, 1, 6]);
    expect(m.diario.find((d) => d.date === "2026-10-21")?.publicadas).toBe(3);
    expect(m.diario.find((d) => d.date === "2026-10-22")).toMatchObject({ visita: 1, generacion: 1 });
  });
});

describe("revenue", () => {
  it("adds approved payments and counts a buyer as new on its first one", () => {
    const pay = (user: string, at: string, status = "approved", cents = 3890000) => ({ user_id: user, status, amount_cents: cents, paid_at: at, created_at: at });
    const m = revenueMetrics([
      pay("u1", "2026-10-01T10:00:00-03:00"),
      pay("u1", "2026-11-01T10:00:00-03:00"),
      pay("u2", "2026-11-02T10:00:00-03:00", "partially_refunded"),
      pay("u3", "2026-11-03T10:00:00-03:00", "rejected"),
    ], { from: "2026-11-01" });
    expect([m.pagos, m.ingresos, m.nuevos, m.clientes]).toEqual([2, 77800, 1, 2]);
  });
});

describe("GET /api/metricas", () => {
  const SECRET = "s".repeat(40);
  const req = (auth?: string, q = "") => new Request(`https://habita.test/api/metricas${q}`, { headers: auth ? { authorization: auth } : {} });
  beforeEach(() => {
    vi.stubEnv("SAAS_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
    vi.stubEnv("METRICS_SECRET", SECRET);
    state.tables = {};
    state.rpcs = [];
  });

  it("refuses without the secret, with a wrong one or when it is not set", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer otra"))).status).toBe(401);
    vi.stubEnv("METRICS_SECRET", "");
    expect((await GET(req(`Bearer ${SECRET}`))).status).toBe(401);
    expect(state.rpcs).toEqual([]);
  });

  it("validates the dates", async () => {
    expect((await GET(req(`Bearer ${SECRET}`, "?desde=ayer"))).status).toBe(400);
  });

  it("returns only aggregates", async () => {
    state.tables.payments = [{ user_id: "u1", status: "approved", amount_cents: 100, paid_at: "2026-10-01T10:00:00Z", created_at: "2026-10-01T10:00:00Z" }];
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.producto).toBe("habita");
    expect(body.ingresos).toMatchObject({ pagos: 1, ingresos: 1, nuevos: 1 });
    expect(JSON.stringify(body)).not.toContain("u1");
  });
});

import { sameSecret } from "@/lib/session";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { adminClient } from "@/lib/supabase/server";
import { prospectDataset } from "@/lib/prospecting/server";
import { isDate } from "@/lib/prospecting/time";
import { demoMetrics, prospectingMetrics, revenueMetrics, type ActivityRow, type DemoRow, type PaymentRow } from "@/lib/metrics/summary";
export const runtime = "nodejs";

const PAGE = 1000;

/** Every row of a table, paging past PostgREST's row limit. */
async function all<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await adminClient().from(table).select(columns).order("created_at").range(from, from + PAGE - 1);
    if (error) throw new Error(`DATABASE_${error.code}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * Aggregated metrics for the Chapa Labs dashboard: prospecting, demos and
 * revenue, as totals and daily series. No personal data. Server to server:
 * `Authorization: Bearer $METRICS_SECRET`. Optional `?desde=&hasta=`
 * (YYYY-MM-DD, Buenos Aires).
 */
export async function GET(request: Request) {
  const secret = process.env.METRICS_SECRET;
  if (!secret || secret.length < 32 || !sameSecret(request.headers.get("authorization") || "", `Bearer ${secret}`))
    return new Response("Unauthorized", { status: 401 });
  if (!cloudEnabled() || !cloudConfigured()) return Response.json({ error: "Supabase no está configurado." }, { status: 503 });
  const url = new URL(request.url);
  const from = url.searchParams.get("desde");
  const to = url.searchParams.get("hasta");
  if ((from && !isDate(from)) || (to && !isDate(to))) return Response.json({ error: "Fechas inválidas (AAAA-MM-DD)." }, { status: 400 });
  const range = { from, to };
  try {
    const [ds, demos, activity, payments] = await Promise.all([
      prospectDataset(),
      all<DemoRow>("demos", "status,activity_level,activity_visitors,created_at,published_at"),
      all<ActivityRow>("demo_activity", "kind,created_at"),
      all<PaymentRow>("payments", "user_id,status,amount_cents,paid_at,created_at"),
    ]);
    return Response.json(
      {
        producto: "habita",
        generadoEn: new Date().toISOString(),
        desde: from,
        hasta: to,
        prospeccion: prospectingMetrics(ds, range),
        demos: demoMetrics(demos, activity, range),
        ingresos: revenueMetrics(payments, range),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("metrics_error", e instanceof Error ? e.message.slice(0, 120) : "unknown");
    return Response.json({ error: "No pudimos calcular las métricas." }, { status: 500 });
  }
}

import { createHash, timingSafeEqual } from "node:crypto";
import { failure, HttpError } from "@/lib/commerce/http";
import { readListing } from "@/lib/demos/listing";
import { QA_LISTING_URLS } from "@/lib/listings/qa-urls";
export const runtime = "nodejs";
export const maxDuration = 60;

const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/**
 * Importer QA from a Vercel preview (its outbound IP is what sites block):
 * GET ?i=<index in the QA list> with the x-qa-token header. Off in
 * production and without IMPORTER_QA_TOKEN; only reads the pages of the QA
 * list (never an arbitrary URL), saves nothing and answers a summary.
 */
export async function GET(request: Request) {
  try {
    const token = process.env.IMPORTER_QA_TOKEN;
    if (process.env.VERCEL_ENV === "production" || !token || token.length < 24) return new Response(null, { status: 404 });
    if (!same(request.headers.get("x-qa-token") ?? "", token)) return new Response(null, { status: 404 });
    const raw = new URL(request.url).searchParams.get("i") ?? "";
    const index = /^\d{1,3}$/.test(raw) ? Number(raw) : -1;
    const url = QA_LISTING_URLS[index];
    if (!url) throw new HttpError(400, `i: 0..${QA_LISTING_URLS.length - 1}`);
    const started = Date.now();
    try {
      const { imported: d } = await readListing(url);
      return Response.json(
        {
          url,
          ok: true,
          ms: Date.now() - started,
          diagnostics: d.diagnostics,
          title: d.title,
          location: d.location,
          price: d.price,
          operation: d.operation,
          facts: d.facts.map((f) => `${f.value} ${f.label}`),
          descriptionChars: d.description?.length ?? 0,
          photos: d.images.length,
          firstPhoto: d.images[0] ?? null,
          agency: d.agency.name,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (e) {
      const err = e as HttpError & { code?: string; upstreamStatus?: number | null };
      return Response.json(
        { url, ok: false, ms: Date.now() - started, status: err.status ?? 500, code: err.code ?? null, upstreamStatus: err.upstreamStatus ?? null, error: err.message },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch (e) {
    return failure(e);
  }
}

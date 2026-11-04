import { readJson } from "@/lib/demos/input";
import { publishedDemo } from "@/lib/demos/server";
import { recordDemoActivity, validVisitor, VISITOR_KINDS, type VisitorKind } from "@/lib/demos/activity";
import { internalRequest } from "@/lib/internal/server";
import { cloudConfigured } from "@/lib/supabase/config";
export const runtime = "nodejs";

const noContent = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

/**
 * One step of a visitor of a published demo: { visitor, kind, internal? }.
 * The public page sends it. The team (its account, a device it marked, or
 * the browser's own mark) is stored flagged and never counted. Answers the
 * same way whatever happens, so nothing about the demo leaks.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!cloudConfigured()) return noContent(404);
    const { token } = await params;
    const body = await readJson(request, 512);
    const kind = VISITOR_KINDS.find((k) => k === body.kind) as VisitorKind | undefined;
    if (!kind || !validVisitor(body.visitor)) return noContent(400);
    const demo = await publishedDemo(token);
    if (!demo) return noContent(404);
    await recordDemoActivity(demo.id, body.visitor, kind, await internalRequest(body.internal === true));
    return noContent();
  } catch {
    console.error("demo_activity_request_failed");
    return noContent(400);
  }
}

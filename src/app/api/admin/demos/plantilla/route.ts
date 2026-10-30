import { failure, HttpError, requireAdmin, rpc } from "@/lib/commerce/http";
import { readJson } from "@/lib/demos/input";
import { DEFAULT_MESSAGE_TEMPLATE } from "@/lib/demos/send";
import { cleanText } from "@/lib/demos/shared";
import { adminClient } from "@/lib/supabase/server";

const PRIVATE = { "Cache-Control": "private, no-store" };

/** The global WhatsApp message for sending demos; each demo may override it. */
export async function GET() {
  try {
    await requireAdmin();
    const { data, error } = await adminClient().from("demo_message_settings").select("template").eq("id", 1).maybeSingle();
    // Before the migration (or when unset) the default text applies.
    const template = !error && data ? (data as { template: string }).template : DEFAULT_MESSAGE_TEMPLATE;
    return Response.json({ template, defaultTemplate: DEFAULT_MESSAGE_TEMPLATE }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const body = await readJson(request);
    const template = cleanText(body.template, 1000, true);
    if (!template) throw new HttpError(400, "El mensaje no puede estar vacío.");
    await rpc("amobla_account", { p_user: actor.id, p_trial: false });
    const { error } = await adminClient()
      .from("demo_message_settings")
      .upsert({ id: 1, template, updated_at: new Date().toISOString() });
    if (error) throw new Error("DEMO_MESSAGE_SAVE_FAILED");
    await adminClient().from("admin_audit").insert({ actor_id: actor.id, action: "demo_message_template", subject_id: null, details: {} });
    return Response.json({ template, defaultTemplate: DEFAULT_MESSAGE_TEMPLATE }, { headers: PRIVATE });
  } catch (e) {
    return failure(e);
  }
}

import { requireUser, failure, HttpError, rpc } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
export async function GET() {
  try {
    const user = await requireUser();
    const r = await adminClient()
      .from("folders")
      .select("id,name")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("created_at");
    if (r.error) throw new Error("FOLDERS_READ_FAILED");
    return Response.json(
      { folders: r.data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    await rpc("amobla_account", { p_user: user.id, p_trial: false });
    if (Number(request.headers.get("content-length") || 0) > 1024)
      throw new HttpError(413, "Solicitud inválida.");
    const { name, id, action } = await request.json();
    const db = adminClient();
    if (action === "archive") {
      if (typeof id !== "string") throw new HttpError(400, "Carpeta inválida.");
      const r = await db
        .from("folders")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id)
        .select("id")
        .single();
      if (r.error) throw new HttpError(404, "No encontramos la carpeta.");
      return Response.json({ saved: true });
    }
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
      throw new HttpError(400, "El nombre debe tener entre 1 y 80 caracteres.");
    if (id) {
      const r = await db
        .from("folders")
        .update({ name: name.trim() })
        .eq("id", id)
        .eq("user_id", user.id)
        .is("archived_at", null)
        .select("id,name")
        .single();
      if (r.error) throw new HttpError(404, "No encontramos la carpeta.");
      return Response.json({ folder: r.data });
    }
    const count = await db
      .from("folders")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", user.id)
      .is("archived_at", null);
    if (count.error) throw new Error("FOLDER_COUNT_FAILED");
    if ((count.count || 0) >= 100)
      throw new HttpError(409, "Llegaste al límite de carpetas.");
    const r = await db
      .from("folders")
      .insert({ user_id: user.id, name: name.trim() })
      .select("id,name")
      .single();
    if (r.error) throw new Error("FOLDER_CREATE_FAILED");
    return Response.json({ folder: r.data }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

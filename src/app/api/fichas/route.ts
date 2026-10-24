import { requireUser, failure, HttpError } from "@/lib/commerce/http";
import { adminClient } from "@/lib/supabase/server";
import { signPath } from "@/lib/commerce/jobs";
import { newShowcaseToken } from "@/lib/showcase";
import { readShowcaseFields } from "@/lib/showcase-fields";
import { isStagingMode } from "@/lib/disclosure";
import { rooms as catalogRooms } from "@/lib/catalog";
const MAX_SHOWCASES = 100;
/** The agent's showcases and the photos that can go into them. */
export async function GET() {
  try {
    const user = await requireUser();
    const db = adminClient();
    const [showcases, projects] = await Promise.all([
      db
        .from("showcases")
        .select(
          "id,token,title,agency_name,agency_logo_path,whatsapp,active,created_at,updated_at,showcase_rooms(project_id,label,position)",
        )
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(MAX_SHOWCASES),
      db
        .from("projects")
        .select(
          "id,name,original_path,created_at,generations(id,room,mode,status,result_path,reviewed_at,discarded_at,created_at)",
        )
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .is("trashed_at", null)
        .order("created_at", { ascending: false })
        .limit(150),
    ]);
    if (showcases.error || projects.error) throw new Error("SHOWCASE_LIST_FAILED");
    const sign = (path: string) => signPath(path).catch(() => "");
    const candidates = (
      await Promise.all(
        (projects.data || []).map(async (p) => {
          const staged = p.generations.filter(
            (g) =>
              g.status === "succeeded" &&
              g.result_path &&
              !g.discarded_at &&
              isStagingMode(g.mode),
          );
          if (!staged.length) return null;
          const latest = [...staged].sort((a, b) =>
            b.created_at.localeCompare(a.created_at),
          )[0];
          return {
            projectId: p.id,
            name: p.name,
            roomName:
              catalogRooms.find((r) => r.id === latest.room)?.name || "Ambiente",
            original: await sign(p.original_path),
            proposals: staged.length,
            reviewed: staged.filter((g) => g.reviewed_at).length,
          };
        }),
      )
    ).filter((c) => c !== null);
    const fichas = await Promise.all(
      (showcases.data || []).map(async (s) => ({
        id: s.id,
        token: s.token,
        title: s.title,
        agencyName: s.agency_name,
        logo: s.agency_logo_path ? await sign(s.agency_logo_path) : null,
        whatsapp: s.whatsapp,
        active: s.active,
        createdAt: s.created_at,
        rooms: [...s.showcase_rooms]
          .sort((a, b) => a.position - b.position)
          .map((r) => ({ projectId: r.project_id, label: r.label })),
      })),
    );
    return Response.json(
      { fichas, candidates },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (Number(request.headers.get("content-length") || 0) > 4096)
      throw new HttpError(413, "Solicitud inválida.");
    const body = await request.json().catch(() => ({}));
    const fields = readShowcaseFields(body, false);
    const db = adminClient();
    const { count, error: countError } = await db
      .from("showcases")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("deleted_at", null);
    if (countError) throw new Error("SHOWCASE_COUNT_FAILED");
    if ((count || 0) >= MAX_SHOWCASES)
      throw new HttpError(409, "Llegaste al máximo de fichas. Borrá alguna para crear otra.");
    const { data, error } = await db
      .from("showcases")
      .insert({ ...fields, user_id: user.id, token: newShowcaseToken() })
      .select("id,token")
      .single();
    if (error || !data) throw new Error("SHOWCASE_CREATE_FAILED");
    return Response.json(data, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

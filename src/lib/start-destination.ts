import { isAdmin } from "@/lib/commerce/http";

export type StartLookup = "agency" | "none" | "failed";
type StartUser = { email?: string | null; is_anonymous?: boolean | null } | null;

/**
 * Where /inicio sends a sign-in that was not heading anywhere: the team to
 * its agencies, an agency's account to its panel, any other account to create
 * its agency. With `images` («Crear un diseño», «Subir mi foto») an agency
 * opens its image studio and anyone else /estudio, which still serves accounts
 * without an agency and the free trial. A failed lookup is not a reason to
 * hide the photos: it goes to them.
 */
export function startDestination(user: StartUser, lookup: StartLookup, images = false) {
  if (images) return lookup === "agency" ? "/panel/imagenes" : "/estudio";
  if (!user || user.is_anonymous || lookup === "failed") return "/proyectos";
  if (isAdmin(user.email ?? undefined)) return "/admin/inmobiliarias";
  return lookup === "agency" ? "/panel" : "/panel/empezar";
}

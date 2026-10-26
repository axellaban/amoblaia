import "server-only";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { isAdmin } from "@/lib/commerce/http";

/**
 * Server-side gate of the admin pages, with the same rule as the admin API
 * (requireAdmin with the "demos" scope): a verified account whose email is
 * in ADMIN_EMAILS or in the demo editors list. Signed
 * out visitors go to sign in; other accounts get a plain 404, so the panel
 * is not even revealed. The API checks again on every request.
 */
export async function requireAdminPage(next: string) {
  if (!cloudEnabled() || !cloudConfigured()) notFound();
  const user = await currentUser().catch(() => null);
  if (!user || user.is_anonymous || !user.email_confirmed_at)
    redirect(`/acceso?next=${encodeURIComponent(next)}`);
  if (!isAdmin(user.email, "demos")) notFound();
  return user;
}

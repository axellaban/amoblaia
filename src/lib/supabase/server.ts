import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicSupabaseConfig } from "./config";

export async function userClient() {
  const config = publicSupabaseConfig();
  if (!config) throw new Error("SUPABASE_NOT_CONFIGURED");
  const jar = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        for (const { name, value, options } of values) {
          try {
            jar.set(name, value, options);
          } catch {
            /* Proxy refreshes cookies for Server Components. */
          }
        }
      },
    },
  });
}
export function adminClient() {
  const config = publicSupabaseConfig();
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!config || !secret) throw new Error("SUPABASE_NOT_CONFIGURED");
  return createClient(config.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function currentUser() {
  if (!publicSupabaseConfig()) return null;
  const supabase = await userClient();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
}

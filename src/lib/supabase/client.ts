"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseConfig } from "./config";
export function browserClient() {
  const config = publicSupabaseConfig();
  if (!config) return null;
  return createBrowserClient(config.url, config.key);
}

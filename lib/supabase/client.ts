"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return { url, anonKey, ready: Boolean(url && anonKey) };
}

export function getSupabaseBrowserClient(): SupabaseClient {
  const { url, anonKey, ready } = getSupabasePublicConfig();
  if (!ready) {
    throw new Error("Supabase public env is not configured.");
  }
  if (!browserClient) {
    browserClient = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return browserClient;
}

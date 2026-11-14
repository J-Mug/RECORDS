import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return { url, anonKey, ready: Boolean(url && anonKey) };
}

export function createPublicSupabaseClient(): SupabaseClient {
  const { url, anonKey, ready } = getSupabasePublicConfig();
  if (!ready) {
    throw new Error("Supabase public env is not configured.");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
